###############################################################################
# PRISM Cloud Trial — AWS module
#
# A reference Terraform module for deploying PRISM on AWS for cloud-trial
# customers. The module is intentionally narrow: it provisions exactly
# the AWS resources PRISM needs at v1 and assumes the caller already has
# a VPC + an EKS cluster they want to deploy into.
#
# What this module owns
#   - An EBS gp3 PersistentVolume claim seed (via Helm release; not Terraform).
#   - An IAM role for the PRISM ServiceAccount (IRSA) so the dashboard
#     can read/write its S3 backup bucket without baking AWS keys.
#   - An S3 bucket for nightly workspace tarballs (versioning + lifecycle).
#   - A Helm release of the official chart at deploy/helm/prism.
#
# What this module does NOT own (caller responsibility):
#   - The VPC, subnets, EKS cluster, OIDC provider.
#   - DNS records / ACM certs / WAF.
#   - Customer LLM API keys (mount as a Secret named in `helm_secret_refs`).
#
# Tag candidate: v0.13.0-cloud-trial.
###############################################################################

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.25.0"
    }
  }
}

# ── Locals ────────────────────────────────────────────────────────────────────
locals {
  name_prefix = var.name_prefix
  common_tags = merge({
    "app.kubernetes.io/name"       = "prism"
    "app.kubernetes.io/managed-by" = "terraform"
    "prism.io/cloud-trial"         = "true"
  }, var.tags)
}

# ── S3 backup bucket ──────────────────────────────────────────────────────────
resource "aws_s3_bucket" "backups" {
  bucket = "${local.name_prefix}-prism-backups"
  tags   = local.common_tags
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    noncurrent_version_expiration { noncurrent_days = var.backup_retention_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# ── IRSA role: PRISM SA → S3 backup bucket ────────────────────────────────────
data "aws_iam_policy_document" "prism_irsa_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.eks_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.eks_oidc_provider_url}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.service_account_name}"]
    }
  }
}

resource "aws_iam_role" "prism" {
  name               = "${local.name_prefix}-prism"
  assume_role_policy = data.aws_iam_policy_document.prism_irsa_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "prism_inline" {
  statement {
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.backups.arn]
  }
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "prism" {
  name   = "${local.name_prefix}-prism-s3"
  role   = aws_iam_role.prism.id
  policy = data.aws_iam_policy_document.prism_inline.json
}

# ── Helm release ──────────────────────────────────────────────────────────────
resource "helm_release" "prism" {
  name      = var.release_name
  namespace = var.namespace
  chart     = var.chart_path
  version   = var.chart_version

  create_namespace = true

  values = [
    yamlencode({
      image = {
        repository = var.image_repository
        tag        = var.image_tag
      }
      replicaCount = 1

      serviceAccount = {
        create = true
        name   = var.service_account_name
        annotations = {
          "eks.amazonaws.com/role-arn" = aws_iam_role.prism.arn
        }
      }

      persistence = {
        enabled      = true
        size         = var.workspace_size
        storageClass = var.workspace_storage_class
      }

      ingress = var.ingress_enabled ? {
        enabled    = true
        className  = var.ingress_class_name
        annotations = var.ingress_annotations
        hosts = [{
          host  = var.ingress_host
          paths = [{ path = "/", pathType = "Prefix" }]
        }]
        tls = var.ingress_tls_secret_name != "" ? [{
          secretName = var.ingress_tls_secret_name
          hosts      = [var.ingress_host]
        }] : []
      } : { enabled = false }

      env = merge({
        PRISM_ENV_PROFILE   = "prod"
        PRISM_AWS_S3_BUCKET = aws_s3_bucket.backups.bucket
      }, var.extra_env)

      envFromSecrets = var.helm_secret_refs

      resources = var.resources
    })
  ]

  depends_on = [
    aws_iam_role_policy.prism,
  ]
}
