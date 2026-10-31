{{- define "cairnly.labels" -}}
app.kubernetes.io/name: cairnly
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{- define "cairnly.dbHost" -}}
{{- if .Values.database.host }}{{ .Values.database.host }}{{ else }}{{ .Release.Name }}-postgres{{ end }}
{{- end }}

{{- define "cairnly.dbSecret" -}}
{{- if .Values.database.existingSecret }}{{ .Values.database.existingSecret }}{{ else }}{{ .Release.Name }}-secrets{{ end }}
{{- end }}

{{- define "cairnly.ollamaUrl" -}}
{{- if .Values.ollama.enabled }}http://{{ .Release.Name }}-ollama:11434{{ else }}{{ .Values.ollama.externalUrl }}{{ end }}
{{- end }}

{{/* Environment shared by the API and the ingest job. */}}
{{- define "cairnly.apiEnv" -}}
- name: DB_HOST
  value: {{ include "cairnly.dbHost" . | quote }}
- name: DB_PORT
  value: {{ .Values.database.port | quote }}
- name: DB_NAME
  value: {{ .Values.database.name | quote }}
- name: DB_USER
  value: {{ .Values.database.user | quote }}
- name: DB_SSLMODE
  value: {{ .Values.database.sslmode | quote }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef: { name: {{ include "cairnly.dbSecret" . }}, key: password }
- name: OLLAMA_URL
  value: {{ include "cairnly.ollamaUrl" . | quote }}
- name: CAIRNLY_ENV
  value: {{ .Values.api.environment | quote }}
- name: TRUST_PROXY
  value: {{ .Values.api.trustProxy | quote }}
{{- with .Values.ollama.proxyTokenSecret }}
- name: MODAL_PROXY_TOKEN_ID
  valueFrom:
    secretKeyRef: { name: {{ . }}, key: token_id }
- name: MODAL_PROXY_TOKEN_SECRET
  valueFrom:
    secretKeyRef: { name: {{ . }}, key: token_secret }
{{- end }}
{{- if .Values.langfuse.host }}
- name: LANGFUSE_HOST
  value: {{ .Values.langfuse.host | quote }}
- name: LANGFUSE_TRACING_ENVIRONMENT
  value: {{ .Values.api.environment | quote }}
- name: LANGFUSE_RELEASE
  value: {{ splitList ":" .Values.image.api | last | quote }}
- name: LANGFUSE_PUBLIC_KEY
  valueFrom:
    secretKeyRef: { name: {{ required "langfuse.existingSecret is needed with langfuse.host" .Values.langfuse.existingSecret }}, key: public_key }
- name: LANGFUSE_SECRET_KEY
  valueFrom:
    secretKeyRef: { name: {{ .Values.langfuse.existingSecret }}, key: secret_key }
{{- end }}
{{- end }}
