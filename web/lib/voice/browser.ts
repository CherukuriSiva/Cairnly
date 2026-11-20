// The browser side of a call: the microphone, the connection (a WebSocket with PCM audio, or a
// WebRTC peer connection) and Web Audio for playback and levels. Everything the browser
// provides is injected, so tests can pass fakes.
//
// Echo: the microphone asks for echo cancellation and noise suppression, and the bot's audio is
// played through an <audio> element (a MediaStream from Web Audio, or the WebRTC track), which
// is the path browsers' echo cancellers listen to. That is what lets the caller talk over the
// bot without the bot hearing itself (what still leaks through, the server drops: flow.py).
//
// Hang-up: the bot goes silent at once (stopAudio), then close() waits up to 2 s for the
// server's call.closed before closing the connection.

import { MicError, parseVoiceEvent, type ConnectOptions, type VoiceAdapter, type VoiceLink } from "@/lib/voice/adapter";

const IN_RATE = 16_000;
const OUT_RATE = 24_000;
const CHUNK_SAMPLES = 320; // 20 ms at 16 kHz
const PLAYBACK_LEAD_S = 0.06; // a little buffer against network jitter
// After a hang-up, how long to wait for the server's call.closed (or its own close) before
// closing our side. The server frees the call the moment the hang-up arrives; this only lets
// the event come back, and never holds the page longer.
export const CLOSE_WAIT_MS = 2_000;
const OPEN_TIMEOUT_MS = 20_000;
const PING_MS = 1_000; // the WebRTC server treats a silent data channel as gone after 3 s

// Runs in the audio thread: averages the microphone down to 16 kHz 16-bit PCM and posts 20 ms
// chunks. Plain JavaScript, loaded from a Blob URL.
const CAPTURE_WORKLET = `
class CairnlyCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${IN_RATE};
    this.phase = 0; this.sum = 0; this.count = 0;
    this.out = new Int16Array(${CHUNK_SAMPLES}); this.n = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]; this.count++; this.phase += 1;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        const v = Math.max(-1, Math.min(1, this.sum / this.count));
        this.out[this.n++] = v < 0 ? v * 32768 : v * 32767;
        this.sum = 0; this.count = 0;
        if (this.n === ${CHUNK_SAMPLES}) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(${CHUNK_SAMPLES}); this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("cairnly-capture", CairnlyCapture);
`;

export interface BrowserDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  createSocket: (url: string) => WebSocket;
  createPeer: (config: RTCConfiguration) => RTCPeerConnection;
  createAudioElement: () => HTMLAudioElement;
  workletUrl: () => string;
  revokeUrl: (url: string) => void;
  createWorklet: (context: AudioContext, name: string) => AudioWorkletNode;
}

function defaultDeps(): BrowserDeps {
  return {
    getUserMedia: (c) => {
      if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new MicError("no-mic"));
      return navigator.mediaDevices.getUserMedia(c);
    },
    createAudioContext: () => new AudioContext({ latencyHint: "interactive" }),
    createSocket: (url) => new WebSocket(url),
    createPeer: (config) => new RTCPeerConnection(config),
    createAudioElement: () => {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      return audio;
    },
    workletUrl: () => URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    createWorklet: (context, name) => new AudioWorkletNode(context, name),
  };
}

function rms(analyser: AnalyserNode | null, buffer: Float32Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

function waitFor(check: (done: () => void) => void, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    check(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function browserVoiceAdapter(overrides: Partial<BrowserDeps> = {}): VoiceAdapter {
  const deps = { ...defaultDeps(), ...overrides };
  let ctx: AudioContext | null = null;
  let audio: HTMLAudioElement | null = null;
  let output: MediaStreamAudioDestinationNode | null = null;
  let mic: MediaStream | null = null;
  let worklet: Promise<void> | null = null; // the capture module, added once per audio context

  function release() {
    mic?.getTracks().forEach((t) => t.stop());
    mic = null;
  }

  /** Add the capture module to the context once; its Blob URL is revoked once it has loaded. */
  function loadWorklet(context: AudioContext): Promise<void> {
    if (!worklet) {
      const url = deps.workletUrl();
      const loading = context.audioWorklet.addModule(url).finally(() => deps.revokeUrl(url));
      loading.catch(() => {
        if (worklet === loading) worklet = null; // a failed load is tried again next call
      });
      worklet = loading;
    }
    return worklet;
  }

  return {
    prepare() {
      // Synchronous, inside the click: no await before these two lines.
      ctx ??= deps.createAudioContext();
      void ctx.resume().catch(() => {});
      audio ??= deps.createAudioElement();
      output ??= ctx.createMediaStreamDestination();
      audio.srcObject = output.stream;
      void audio.play()?.catch(() => {});
    },

    async openMic() {
      try {
        mic = await deps.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (err) {
        if (err instanceof MicError) throw err;
        const name = (err as { name?: string })?.name;
        throw new MicError(name === "NotAllowedError" || name === "SecurityError" ? "mic-denied" : "no-mic");
      }
    },

    release,

    dispose() {
      release();
      worklet = null;
      if (audio) audio.srcObject = null;
      void ctx?.close().catch(() => {});
      ctx = null;
      audio = null;
      output = null;
    },

    async connect(options: ConnectOptions): Promise<VoiceLink> {
      if (!ctx || !audio || !output || !mic) throw new Error("prepare() and openMic() come first");
      const context = ctx;
      const element = audio;
      const toSpeaker = output;
      const stream = mic;
      const track = stream.getAudioTracks()[0];
      const micSource = context.createMediaStreamSource(stream);
      const userAnalyser = context.createAnalyser();
      userAnalyser.fftSize = 1024;
      micSource.connect(userAnalyser);
      const botAnalyser = context.createAnalyser();
      botAnalyser.fftSize = 1024;
      const samples = new Float32Array(1024);
      let muted = false;
      let closed = false;
      let closedResolve: (() => void) | null = null; // the server said call.closed, or closed
      element.muted = false; // a previous call's hang-up muted it
      const cleanups: (() => void)[] = [() => micSource.disconnect(), () => release()];

      const finish = () => {
        if (closed) return;
        closed = true;
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch {
            // already gone
          }
        });
        closedResolve?.();
        options.handlers.onClosed();
      };
      const deliver = (data: unknown) => {
        const event = parseVoiceEvent(data);
        if (event) options.handlers.onEvent(event);
        if (event?.kind === "call.closed") closedResolve?.(); // the server has let the call go
        return event;
      };
      /** Wait for the server to acknowledge the hang-up, CLOSE_WAIT_MS at most, then close. */
      const closeGracefully = async () => {
        if (closed) return;
        await waitFor((resolve) => (closedResolve = resolve), CLOSE_WAIT_MS);
        finish();
      };

      // Anything that fails before the call is up releases what was opened so far.
      const open = async (): Promise<VoiceLink> => {
        if (options.transport === "webrtc") {
          const peer = deps.createPeer({ iceServers: (options.iceServers ?? []).map((urls) => ({ urls })) });
          peer.addTransceiver(track, { direction: "sendrecv" });
          const channel = peer.createDataChannel("events", { ordered: true });
          peer.ontrack = (e) => {
            const remote = e.streams[0] ?? new MediaStream([e.track]);
            element.srcObject = remote;
            void element.play()?.catch(() => {});
            const source = context.createMediaStreamSource(remote);
            source.connect(botAnalyser);
            cleanups.push(() => source.disconnect());
          };
          channel.onmessage = (e) => deliver(e.data);
          channel.onclose = finish;
          peer.onconnectionstatechange = () => {
            if (["failed", "closed"].includes(peer.connectionState)) finish();
          };
          const ping = setInterval(() => {
            if (channel.readyState === "open") channel.send(`ping: ${Date.now()}`);
          }, PING_MS);
          cleanups.push(() => clearInterval(ping), () => peer.close());

          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          // Send the offer with every ICE candidate in it (no trickle): at most 2 s of gathering.
          await waitFor((done) => {
            if (peer.iceGatheringState === "complete") return done();
            peer.onicegatheringstatechange = () => peer.iceGatheringState === "complete" && done();
          }, 2_000);
          const reply = await options.start({ sdp: peer.localDescription?.sdp ?? offer.sdp ?? "", type: "offer" });
          if (!reply.answer) throw new Error("no answer");
          await peer.setRemoteDescription(reply.answer);
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout")), OPEN_TIMEOUT_MS);
            if (channel.readyState === "open") return resolve();
            channel.onopen = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          return {
            send: (message) => channel.readyState === "open" && channel.send(JSON.stringify(message)),
            setMuted: (value) => {
              muted = value;
              track.enabled = !value;
            },
            levels: () => ({ user: muted ? 0 : rms(userAnalyser, samples), bot: rms(botAnalyser, samples) }),
            stopAudio: () => {
              element.muted = true; // the bot's track keeps arriving until the peer closes
            },
            close: closeGracefully,
          };
        }

        // WebSocket: the microphone through the capture worklet, the bot's PCM through Web Audio.
        await loadWorklet(context);
        const capture = deps.createWorklet(context, "cairnly-capture");
        const sink = context.createGain();
        sink.gain.value = 0; // keeps the worklet running without playing the microphone back
        micSource.connect(capture).connect(sink).connect(context.destination);
        const playback = context.createGain();
        playback.connect(botAnalyser);
        playback.connect(toSpeaker);
        const sources = new Set<AudioBufferSourceNode>();
        let playhead = 0;
        let silenced = false; // hung up: the bot's audio is no longer played
        const clear = () => {
          sources.forEach((s) => {
            try {
              s.stop();
            } catch {
              // never started
            }
          });
          sources.clear();
          playhead = 0;
        };
        cleanups.push(clear, () => capture.disconnect(), () => sink.disconnect(), () => playback.disconnect());

        const reply = await options.start();
        const socketUrl = `${options.baseUrl.replace(/^http/, "ws")}${reply.socket_path ?? ""}`;
        const socket = deps.createSocket(socketUrl);
        socket.binaryType = "arraybuffer";
        cleanups.push(() => socket.readyState <= 1 && socket.close());
        capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (!muted && socket.readyState === 1) socket.send(e.data);
        };
        socket.onmessage = (e: MessageEvent) => {
          if (e.data instanceof ArrayBuffer) {
            const pcm = new Int16Array(e.data);
            if (!pcm.length || silenced) return;
            const buffer = context.createBuffer(1, pcm.length, OUT_RATE);
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(playback);
            const at = Math.max(playhead, context.currentTime + PLAYBACK_LEAD_S);
            source.start(at);
            playhead = at + buffer.duration;
            sources.add(source);
            source.onended = () => sources.delete(source);
            return;
          }
          const event = deliver(e.data);
          if (event?.kind === "audio.clear") clear();
        };
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout")), OPEN_TIMEOUT_MS);
          socket.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
          socket.onerror = () => {
            clearTimeout(timer);
            reject(new Error("socket"));
          };
        });
        socket.onclose = finish;
        socket.onerror = null;
        return {
          send: (message) => socket.readyState === 1 && socket.send(JSON.stringify(message)),
          setMuted: (value) => {
            muted = value;
          },
          levels: () => ({ user: muted ? 0 : rms(userAnalyser, samples), bot: rms(botAnalyser, samples) }),
          stopAudio: () => {
            silenced = true; // audio still on its way is dropped as it arrives
            clear();
            element.muted = true;
          },
          close: closeGracefully,
        };
      };
      try {
        return await open();
      } catch (err) {
        closed = true;
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch {
            // already gone
          }
        });
        throw err;
      }
    },
  };
}
