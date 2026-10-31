variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "cairnly"
}

variable "image_tag" {
  description = "Tag of the api and web images in ECR (CI pushes the git SHA)."
  type        = string
  default     = "latest"
}

variable "ollama_url" {
  description = "The Modal Ollama URL printed by `modal deploy` (deploy/modal_ollama.py)."
  type        = string
}

variable "langfuse_host" {
  description = "Langfuse server for production traces, e.g. https://cloud.langfuse.com. Empty = tracing off."
  type        = string
  default     = ""
}

variable "db_instance_class" {
  description = "RDS instance size. db.t4g.micro is enough for a demo corpus."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Run a standby database in a second AZ (roughly doubles the database cost)."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS. Empty = HTTP only (fine for a first test, not for real users)."
  type        = string
  default     = ""
}

variable "api_min_tasks" {
  description = "Minimum API tasks; autoscaling adds more under load."
  type        = number
  default     = 1
}

variable "api_max_tasks" {
  description = "Maximum API tasks."
  type        = number
  default     = 4
}

variable "deletion_protection" {
  description = "Protect the database and load balancer from `terraform destroy`. Turn off for throwaway demos."
  type        = bool
  default     = true
}
