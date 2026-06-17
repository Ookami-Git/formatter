variable "env" {
  type        = string
  default     = "dev"
  description = "Environnement cible."

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "L'environnement doit être 'dev' ou 'prod'."
  }
}

variable "database" {
  type = object({
    use_ssl  = bool
    ssl_port = number
  })
  default = {
    use_ssl  = false
    ssl_port = 5432
  }
  description = "Configuration de la base de données. @condition(ssl_port = use_ssl == true && ../../env == 'prod')"
}
