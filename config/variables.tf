variable "aws_region" {
  type        = string
  description = "The AWS region to deploy the resources."
  default     = "eu-west-3"
}

variable "instance_count" {
  type        = number
  description = "Number of EC2 instances to start."
  default     = 2
}

variable "enable_monitoring" {
  type        = bool
  description = "Enable detailed CloudWatch monitoring."
  default     = true
}

variable "subnet_ids" {
  type        = list(string)
  description = "List of subnet IDs to deploy the instances into."
  default     = ["subnet-abc12345", "subnet-def67890"]
}

variable "tags" {
  type        = map(string)
  description = "Key-value tags to apply to all resources."
  default     = {
    Environment = "production"
    Owner       = "devops-team"
    Project     = "nebula"
  }
}

variable "app_settings" {
  type = object({
    admin_email = string
    backup_retention_days = number
  })
  description = "Application settings structure."
  default = {
    admin_email = "admin@company.com"
    backup_retention_days = 7
  }
}

variable "ingress_rules" {
  type = list(object({
    port        = number
    protocol    = string
    cidr_blocks = list(string)
  }))
  description = "Security group ingress rule list."
  default = [
    {
      port        = 80
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    },
    {
      port        = 443
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  ]
}

variable "backend_protocol" {
  description = "Backend protocol"
  type        = string
  default     = "HTTP"

  validation {
    condition     = contains(["HTTP", "HTTPS"], upper(var.backend_protocol))
    error_message = "backend_protocol doit être 'HTTP' ou 'HTTPS'."
  }
}
