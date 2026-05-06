# PRISM Cloud Trial — Terraform / `prism-aws`

Reference Terraform module that deploys PRISM into an existing EKS cluster using the in-tree Helm chart at [`deploy/helm/prism`](../../../helm/prism).

## Scope

What this module owns:

- An S3 bucket for nightly workspace backups (versioning + AES-256 SSE + lifecycle expiry of non-current versions).
- An IAM role bound to the PRISM ServiceAccount via IRSA, granting the bucket's `s3:Get/Put/Delete/AbortMultipart`.
- A Helm release of `deploy/helm/prism` configured with the IRSA SA, the backup bucket name surfaced as `PRISM_AWS_S3_BUCKET`, and any caller-supplied env / Secret references.

What this module does **not** own (caller's responsibility):

- The VPC, subnets, EKS cluster, OIDC provider.
- DNS records, ACM certificates, WAF, ALB controllers.
- Secrets containing LLM API keys, `PRISM_SSO_SESSION_SECRET`, etc. — pass them in via `helm_secret_refs`.

## Quick start

```hcl
module "prism" {
  source = "github.com/kirklasalle/Prism//deploy/terraform/modules/prism-aws?ref=v0.13.0-cloud-trial"

  name_prefix             = "acme-prod"
  eks_oidc_provider_arn   = data.aws_eks_cluster.this.identity[0].oidc[0].issuer_arn
  eks_oidc_provider_url   = replace(data.aws_eks_cluster.this.identity[0].oidc[0].issuer, "https://", "")

  ingress_enabled         = true
  ingress_class_name      = "alb"
  ingress_host            = "prism.acme.example.com"
  ingress_annotations     = {
    "alb.ingress.kubernetes.io/scheme"      = "internet-facing"
    "alb.ingress.kubernetes.io/target-type" = "ip"
  }

  helm_secret_refs = [
    "prism-llm-keys",      # OPENAI_API_KEY, ANTHROPIC_API_KEY, ...
    "prism-iam-secrets",   # PRISM_SSO_SESSION_SECRET
  ]
}
```

## Outputs

- `backup_bucket` / `backup_bucket_arn` — wire your DR runbooks to this.
- `irsa_role_arn` — the role attached to the PRISM ServiceAccount.
- `release_name` / `release_namespace` — for follow-on `helm upgrade` operations.

## Versioning + tags

This module ships under the `v0.13.0-cloud-trial` tag. Pin to a specific tag in production; `main` may carry breaking changes between releases.
