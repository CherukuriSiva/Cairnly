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
- name: LLM_PROVIDER
  value: {{ .Values.api.llmProvider | quote }}
- name: ANTHROPIC_MODEL
  value: {{ .Values.api.anthropicModel | quote }}
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef: { name: {{ .Release.Name }}-secrets, key: anthropicApiKey, optional: true }
{{- end }}
