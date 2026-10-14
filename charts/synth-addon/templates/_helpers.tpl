{{- define "synth-addon.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "synth-addon.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- .Values.nameOverride | default .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "synth-addon.labels" -}}
helm.sh/chart: {{ include "synth-addon.name" . }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "synth-addon.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "synth-addon.selectorLabels" -}}
app.kubernetes.io/name: {{ include "synth-addon.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Имя hook-Job'а авто-установки. */}}
{{- define "synth-addon.installJobName" -}}
{{- printf "%s-install" (include "synth-addon.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Имя ConfigMap со скиллами (аддон без образа). */}}
{{- define "synth-addon.skillsConfigMapName" -}}
{{- printf "%s-skills" (include "synth-addon.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Образ hook-Job'а: autoInstall.image, иначе образ чарта.
Обязателен — без образа Job выполнить нечего.
*/}}
{{- define "synth-addon.autoInstallImage" -}}
{{- if .Values.autoInstall.image -}}
{{- .Values.autoInstall.image -}}
{{- else if .Values.image.repository -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | toString) -}}
{{- else -}}
{{- required "autoInstall.image обязателен: у чарта не задан image.repository" "" -}}
{{- end -}}
{{- end }}

{{/*
Путь к инсталлятору внутри Job: из ConfigMap (scriptConfigMap) или из образа.
*/}}
{{- define "synth-addon.installerPath" -}}
{{- if .Values.autoInstall.scriptConfigMap -}}
/opt/synth-addon/install-into-synth.mjs
{{- else -}}
{{- .Values.autoInstall.scriptPath | default "scripts/install-into-synth.mjs" -}}
{{- end -}}
{{- end }}

{{/* In-cluster адрес сервиса аддона (для сборки URL MCP). */}}
{{- define "synth-addon.serviceHost" -}}
{{- printf "%s.%s.svc.cluster.local" (include "synth-addon.fullname" .) .Release.Namespace }}
{{- end }}
