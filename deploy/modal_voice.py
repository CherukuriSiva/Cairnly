"""Run the cairnly voice server on Modal, for the public deploy (voice mode, ADR 0019).

Deploy from the repo root, after deploy/modal_api.py is deployed (steps: infra/README.md):

    uvx modal secret create cairnly-voice LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \\
        LANGFUSE_HOST=https://us.cloud.langfuse.com
    uvx modal deploy deploy/modal_voice.py    # serves <workspace>--cairnly-voice-web.modal.run

Then set NEXT_PUBLIC_VOICE_URL on Vercel to that URL and redeploy the site; until then the
chat shows no microphone.

What it does:
- Builds a CUDA image (cuDNN 9 for faster-whisper on the GPU) with the voice extras and both
  speech models baked in: Whisper large-v3-turbo (CTranslate2) and Kokoro-82M (ONNX). A
  container downloads nothing when it starts.
- Serves the voice routes and the call WebSockets from ONE container on a T4 GPU
  (max_containers=1). Calls, budgets and end reasons live in that process's memory, and the
  daily voice-minute cap (VOICE_MINUTES_PER_DAY, 60) is what keeps the GPU inside the Modal
  spend limit. The container switches off after 2 idle minutes.
- Uses the WebSocket transport only: audio travels over the same HTTPS endpoint as the routes.
  Peer-to-peer WebRTC to a Modal container would need STUN hole-punching to work for every
  caller, and a TURN service for those behind carrier-grade NAT; see ADR 0019.
- Asks the deployed `cairnly-api` app's /ask for every answer (its URL is found at container
  start), so the API's guard, limits and saved conversations apply to voice too. It holds no
  database URL and no model token: the secret `cairnly-voice` has only the Langfuse keys, for
  the per-turn timings (no text).

Claude never runs here: the voice server has no LLM of its own, and CAIRNLY_ENV=production
makes the shared settings refuse ALLOW_ANTHROPIC.
"""

import os
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[1]
ROOT = "/app"
HF_HOME = f"{ROOT}/.cache/huggingface"
CUDA_IMAGE = "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04"  # CUDA 12 + cuDNN 9 (CTranslate2 4)
WHISPER = "deepdml/faster-whisper-large-v3-turbo-ct2"
BAKE_MODELS = (
    f"from faster_whisper.utils import download_model; download_model('{WHISPER}'); "
    "from cairnly.voice.models import kokoro_model; kokoro_model()"
)

# Settings that are not secret. Each one is read when the voice server starts.
VOICE_ENV = {
    "CAIRNLY_ENV": "production",  # the shared settings then refuse ALLOW_ANTHROPIC
    "CORS_ORIGINS": "https://cairnly-blond.vercel.app",  # the site; also checked on the socket
    "TRUST_PROXY": "0",  # Modal hands the app the caller's address
    "VOICE_TRANSPORTS": "websocket",
    "VOICE_STT_MODEL": WHISPER,
    "VOICE_STT_DEVICE": "cuda",
    "VOICE_STT_COMPUTE": "float16",
    "VOICE_MAX_CALLS": "1",
    "VOICE_MAX_CALL_S": "300",
    "VOICE_MINUTES_PER_DAY": "60",
    "VOICE_CALLS_PER_IP_PER_DAY": "10",
    "VOICE_HALF_DUPLEX": "0",  # 1: the caller cannot talk over the bot
    "LANGFUSE_TRACING_ENVIRONMENT": "production",
}

SECRETS = [modal.Secret.from_name("cairnly-voice")]

image = (
    modal.Image.from_registry(CUDA_IMAGE, add_python="3.12")
    .uv_sync(str(REPO), extras=["voice", "voice-models"], extra_options="--no-dev",
             uv_version="0.12.23")
    .add_local_file(REPO / "pyproject.toml", f"{ROOT}/pyproject.toml", copy=True)
    .add_local_file(REPO / "uv.lock", f"{ROOT}/uv.lock", copy=True)
    .add_local_file(REPO / "README.md", f"{ROOT}/README.md", copy=True)
    .add_local_file(REPO / "kbs.yaml", f"{ROOT}/kbs.yaml", copy=True)
    .add_local_dir(REPO / "src", f"{ROOT}/src", copy=True, ignore=["**/__pycache__"])
    .run_commands(f"/.uv/uv pip install --python /.uv/.venv/bin/python --no-deps -e {ROOT}")
    .env({"HF_HOME": HF_HOME, "PYTHONUNBUFFERED": "1"})
    .run_commands(f'python -c "{BAKE_MODELS}"')
    .env({"HF_HUB_OFFLINE": "1"})  # the models are in the image; never fetch at runtime
    .workdir(ROOT)
)

app = modal.App("cairnly-voice", image=image)


def use_production_settings() -> None:
    """Point the brain at the deployed API. Runs before the voice settings are read."""
    os.chdir(ROOT)
    api = modal.Function.from_name("cairnly-api", "web")
    os.environ["VOICE_API_URL"] = api.get_web_url()


# timeout: each WebSocket is one function call and lives as long as the call, so it must
# outlast VOICE_MAX_CALL_S (300 s) with room for the goodbye.
@app.function(gpu="T4", secrets=SECRETS, env=VOICE_ENV, max_containers=1,
              scaledown_window=120, timeout=600, cpu=4, memory=8192)
@modal.concurrent(max_inputs=8)  # one call at a time (the CallBook) plus its HTTP requests
@modal.asgi_app()
def web():
    """The public voice endpoint. No proxy auth: the browser calls it directly."""
    use_production_settings()
    from cairnly.voice.server import app as voice

    return voice
