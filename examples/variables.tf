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

variable "app_name" {
  description = "Application name (lowercase letters, digits, hyphens)"
  type        = string
  default     = "my-service"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,}$", var.app_name))
    error_message = "app_name doit commencer par une lettre minuscule et ne contenir que des minuscules, chiffres et tirets (min. 3 caractères)."
  }
}

variable "image_tag" {
  description = "Docker image tag"
  type        = string
  default     = "latest"

  validation {
    condition     = can(regex("^[a-zA-Z0-9._-]+$", var.image_tag))
    error_message = "image_tag ne peut contenir que des lettres, chiffres, points, tirets et underscores."
  }
}

variable "admin_email" {
  description = "Administrator email address"
  type        = string
  default     = "admin@example.com"

  validation {
    condition     = can(regex("^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$", var.admin_email))
    error_message = "admin_email doit être une adresse email valide."
  }
}

variable "cidr_block" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = length(regexall("^([0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}$", var.cidr_block)) > 0
    error_message = "cidr_block doit être un bloc CIDR valide (ex: 10.0.0.0/16)."
  }
}
