{{/*
Nom complet de la release
*/}}
{{- define "dynamic-form.fullname" -}}
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
Nom du chart
*/}}
{{- define "dynamic-form.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Labels standards
*/}}
{{- define "dynamic-form.labels" -}}
helm.sh/chart: {{ include "dynamic-form.chart" . }}
{{ include "dynamic-form.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "dynamic-form.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dynamic-form.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Chart name + version
*/}}
{{- define "dynamic-form.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Image tag (fallback vers appVersion)
*/}}
{{- define "dynamic-form.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion }}
{{- end }}
