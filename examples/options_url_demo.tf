variable "app_environment" {
  type        = string
  description = "L'environnement cible de déploiement. @optionsUrl(app_environment = {\"url\": \"http://localhost:3001/api/mock-options\", \"path\": \"simple_list\"})"
  default     = "dev"
}

variable "target_network" {
  type        = string
  description = "Réseau privé virtuel. @optionsUrl(target_network = {\"url\": \"http://localhost:3001/api/mock-options\", \"path\": \"project.all.networks\"})"
}

variable "infra_zones" {
  type        = list(string)
  description = "Les zones de disponibilité cibles. @optionsUrl(infra_zones = {\"url\": \"http://localhost:3001/api/mock-options\", \"path\": \"key_value_object\"})"
  default     = ["zone-1a"]
}
