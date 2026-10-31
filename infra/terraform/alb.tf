# Load balancer: one public entry point. API paths go to the api service, everything else to
# the web UI, so the browser talks to a single origin (no CORS). The idle timeout is raised
# because answers stream for several seconds.

resource "aws_lb" "main" {
  name                       = var.project
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  idle_timeout               = 120
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project}-api"
  port        = 8010
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path    = "/health"
    matcher = "200"
  }
  deregistration_delay = 30
}

resource "aws_lb_target_group" "web" {
  name        = "${var.project}-web"
  port        = 3010
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path    = "/"
    matcher = "200"
  }
  deregistration_delay = 30
}

locals {
  https       = var.certificate_arn != ""
  api_paths   = ["/ask", "/search", "/kbs", "/health", "/livez", "/config"]
  listener_id = local.https ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

# HTTP: serves the app when there is no certificate, otherwise redirects to HTTPS.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = local.https ? "redirect" : "forward"
    target_group_arn = local.https ? null : aws_lb_target_group.web.arn

    dynamic "redirect" {
      for_each = local.https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# An ALB rule holds at most 5 path patterns, so the API paths are split across rules.
resource "aws_lb_listener_rule" "api" {
  count        = length(chunklist(local.api_paths, 5))
  listener_arn = local.listener_id
  priority     = 10 + count.index

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    path_pattern {
      values = chunklist(local.api_paths, 5)[count.index]
    }
  }
}

moved {
  from = aws_lb_listener_rule.api
  to   = aws_lb_listener_rule.api[0]
}
