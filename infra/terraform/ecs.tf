# Compute: ECS on Fargate (no servers to patch). Four task definitions:
#   api     FastAPI, behind the load balancer, autoscaled on CPU
#   web     Next.js UI, behind the load balancer
#   ollama  embeddings server (CPU), reachable only inside the VPC at ollama.<project>.internal
#   ingest  one-off: `cairnly migrate && cairnly ingest --kb lessons` (run after each deploy)

locals {
  db_secret  = aws_db_instance.main.master_user_secret[0].secret_arn
  ollama_url = "http://ollama.${var.project}.internal:11434"

  api_environment = [
    { name = "DB_HOST", value = aws_db_instance.main.address },
    { name = "DB_NAME", value = "cairnly" },
    { name = "DB_SSLMODE", value = "require" },
    { name = "OLLAMA_URL", value = local.ollama_url },
    { name = "LLM_PROVIDER", value = var.llm_provider },
    { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
  ]
  api_secrets = [
    { name = "DB_USER", valueFrom = "${local.db_secret}:username::" },
    { name = "DB_PASSWORD", valueFrom = "${local.db_secret}:password::" },
    { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic.arn },
  ]
  api_image = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
  web_image = "${aws_ecr_repository.app["web"].repository_url}:${var.image_tag}"
}

resource "aws_ecs_cluster" "main" {
  name = var.project
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "web", "ollama", "ingest"])
  name              = "/ecs/${var.project}/${each.key}"
  retention_in_days = 14
}

# ---- IAM: the execution role pulls images and reads secrets; tasks get no AWS permissions.

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.project}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "read_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [local.db_secret, aws_secretsmanager_secret.anthropic.arn]
    }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${var.project}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ---- Task definitions

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "api"
    image        = local.api_image
    essential    = true
    portMappings = [{ containerPort = 8010 }]
    environment  = local.api_environment
    secrets      = local.api_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["api"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "ingest" {
  family                   = "${var.project}-ingest"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name        = "ingest"
    image       = local.api_image
    essential   = true
    command     = ["/bin/sh", "-c", "cairnly migrate && cairnly ingest --kb lessons"]
    environment = local.api_environment
    secrets     = local.api_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["ingest"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ingest"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "web"
    image        = local.web_image
    essential    = true
    portMappings = [{ containerPort = 3010 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["web"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "ollama" {
  family                   = "${var.project}-ollama"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 3072
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name         = "ollama"
    image        = "ollama/ollama:0.11.2"
    essential    = true
    portMappings = [{ containerPort = 11434 }]
    entryPoint   = ["/bin/sh", "-c"]
    # Start the server, pull the embedding model, keep serving.
    command = ["ollama serve & pid=$!; until ollama list >/dev/null 2>&1; do sleep 1; done; ollama pull nomic-embed-text; wait $pid"]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["ollama"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ollama"
      }
    }
  }])
}

# ---- Service discovery: the api finds Ollama by DNS name inside the VPC.

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.project}.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "ollama" {
  name = "ollama"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

# ---- Services

resource "aws_ecs_service" "ollama" {
  name            = "ollama"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ollama.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ollama.id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.ollama.arn
  }
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_min_tasks
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8010
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true # a deploy whose tasks never get healthy rolls back by itself
  }
  lifecycle {
    ignore_changes = [desired_count] # owned by autoscaling after the first apply
  }
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3010
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

# ---- Autoscaling: add API tasks when average CPU stays above 60%.

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_min_tasks
  max_capacity       = var.api_max_tasks
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.project}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
