output "backup_bucket" {
  value       = aws_s3_bucket.backups.bucket
  description = "Name of the S3 bucket holding PRISM workspace backups."
}

output "backup_bucket_arn" {
  value       = aws_s3_bucket.backups.arn
  description = "ARN of the backup bucket."
}

output "irsa_role_arn" {
  value       = aws_iam_role.prism.arn
  description = "IAM role ARN attached to the PRISM ServiceAccount via IRSA."
}

output "release_name" {
  value       = helm_release.prism.name
  description = "Resolved Helm release name."
}

output "release_namespace" {
  value       = helm_release.prism.namespace
  description = "Namespace the release was deployed into."
}
