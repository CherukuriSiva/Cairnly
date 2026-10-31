# Data tier: Postgres 17 on RDS (pgvector is a built-in RDS extension; `cairnly migrate`
# runs CREATE EXTENSION vector). RDS generates the master password and keeps it in Secrets
# Manager, so it never appears in Terraform state, code or CI logs.

resource "aws_db_subnet_group" "main" {
  name       = var.project
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = var.project
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  db_name                     = "cairnly"
  username                    = "cairnly"
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100 # grows automatically
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period   = 7 # daily snapshots + point-in-time restore for a week
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.project}-final" : null
}

# The Claude API key. Terraform creates the empty secret; you put the value in once:
#   aws secretsmanager put-secret-value --secret-id cairnly/anthropic-api-key --secret-string "$KEY"
# so the key is never in Terraform state or the repo.
resource "aws_secretsmanager_secret" "anthropic" {
  name                    = "${var.project}/anthropic-api-key"
  recovery_window_in_days = 7
}

# ECS will not start a task whose secret has no value, so seed a placeholder. Terraform never
# touches the value again (ignore_changes), so the real key you put in later stays.
resource "aws_secretsmanager_secret_version" "anthropic_placeholder" {
  secret_id     = aws_secretsmanager_secret.anthropic.id
  secret_string = "not-set"
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Container registries for the two images CI builds.
resource "aws_ecr_repository" "app" {
  for_each             = toset(["api", "web"])
  name                 = "${var.project}-${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = !var.deletion_protection

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}
