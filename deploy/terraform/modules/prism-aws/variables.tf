###############################################################################
# Inputs for the prism-aws module.
###############################################################################

variable "name_prefix" {
  type        = string
  description = "Short prefix used for AWS resource naming (e.g. 'acme-prod')."
}

variable "release_name" {
  type        = string
  description = "Helm release name."
  default     = "prism"
}

variable "namespace" {
  type        = string
  description = "Kubernetes namespace to deploy into."
  default     = "prism"
}

variable "service_account_name" {
  type        = string
  description = "ServiceAccount name (also used in the IRSA assume-role condition)."
  default     = "prism"
}

variable "chart_path" {
  type        = string
  description = "Path to the prism Helm chart. Use deploy/helm/prism for in-tree, or an OCI/HTTPS URL when consuming the published chart."
  default     = "../../../helm/prism"
}

variable "chart_version" {
  type        = string
  description = "Chart version. Empty string ⇒ uses Chart.yaml's version."
  default     = ""
}

variable "image_repository" {
  type        = string
  description = "Container image repository."
  default     = "ghcr.io/kirklasalle/prism"
}

variable "image_tag" {
  type        = string
  description = "Container image tag. Empty ⇒ Chart.appVersion."
  default     = ""
}

variable "eks_oidc_provider_arn" {
  type        = string
  description = "ARN of the IAM OIDC identity provider for the EKS cluster."
}

variable "eks_oidc_provider_url" {
  type        = string
  description = "Hostname/path of the EKS OIDC issuer (no scheme), e.g. 'oidc.eks.us-east-1.amazonaws.com/id/ABCDEF...'."
}

variable "workspace_size" {
  type        = string
  description = "PVC size for the PRISM workspace."
  default     = "20Gi"
}

variable "workspace_storage_class" {
  type        = string
  description = "StorageClass for the PRISM workspace PVC."
  default     = "gp3"
}

variable "backup_retention_days" {
  type        = number
  description = "Days before non-current S3 backup versions are expired."
  default     = 30
}

variable "ingress_enabled" {
  type        = bool
  default     = false
}

variable "ingress_class_name" {
  type        = string
  default     = "alb"
}

variable "ingress_host" {
  type        = string
  default     = ""
}

variable "ingress_annotations" {
  type        = map(string)
  default     = {}
}

variable "ingress_tls_secret_name" {
  type        = string
  default     = ""
}

variable "extra_env" {
  type        = map(string)
  description = "Additional environment variables surfaced to the PRISM container."
  default     = {}
}

variable "helm_secret_refs" {
  type        = list(string)
  description = "Names of pre-existing Secrets (in the target namespace) to mount as envFrom on the PRISM container. Use this to inject LLM API keys, PRISM_SSO_SESSION_SECRET, etc."
  default     = []
}

variable "resources" {
  type = object({
    requests = map(string)
    limits   = map(string)
  })
  default = {
    requests = { cpu = "250m", memory = "512Mi" }
    limits   = { cpu = "2", memory = "2Gi" }
  }
}

variable "tags" {
  type        = map(string)
  description = "Extra AWS tags applied to all created resources."
  default     = {}
}
