output "url" {
  description = "Where the app is served."
  value       = "${local.https ? "https" : "http"}://${aws_lb.main.dns_name}"
}

output "ecr_api" {
  value = aws_ecr_repository.app["api"].repository_url
}

output "ecr_web" {
  value = aws_ecr_repository.app["web"].repository_url
}

output "anthropic_secret_id" {
  description = "Put the Claude API key here once (see README)."
  value       = aws_secretsmanager_secret.anthropic.name
}

output "run_ingest" {
  description = "Command that migrates the database and ingests the lessons (run after each deploy)."
  value = join(" ", [
    "aws ecs run-task --region ${var.region} --cluster ${aws_ecs_cluster.main.name}",
    "--launch-type FARGATE --task-definition ${aws_ecs_task_definition.ingest.family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.app.id}]}'",
  ])
}
