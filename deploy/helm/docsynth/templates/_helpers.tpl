{{/*
Expand the name of the chart.
*/}}
{{- define "docsynth.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "docsynth.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "docsynth.labels" -}}
helm.sh/chart: {{ include "docsynth.name" . }}-{{ .Chart.Version }}
{{ include "docsynth.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "docsynth.selectorLabels" -}}
app.kubernetes.io/name: {{ include "docsynth.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Database URL helper
*/}}
{{- define "docsynth.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgresql://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ include "docsynth.fullname" . }}-postgresql:5432/{{ .Values.postgresql.auth.database }}
{{- else -}}
postgresql://{{ .Values.postgresql.externalDatabase.user }}:{{ .Values.postgresql.externalDatabase.password }}@{{ .Values.postgresql.externalDatabase.host }}:{{ .Values.postgresql.externalDatabase.port }}/{{ .Values.postgresql.externalDatabase.database }}
{{- end -}}
{{- end }}

{{/*
Redis URL helper
*/}}
{{- define "docsynth.redisUrl" -}}
{{- if .Values.redis.enabled -}}
redis://{{ include "docsynth.fullname" . }}-redis-master:6379
{{- else -}}
redis://{{ .Values.redis.externalRedis.host }}:{{ .Values.redis.externalRedis.port }}
{{- end -}}
{{- end }}
