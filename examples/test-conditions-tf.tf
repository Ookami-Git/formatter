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

###Instances
variable "vms" {
  description = "Map of the vms @optionsFrom(vgs.disks = ../../add_volumes) @condition(add_volumes.iops = ./type == 'io1') @optionsFrom(add_volumes.iops = [10, 100, 1000])"
  type = map(object({
    running       = optional(bool)
    ip_address    = string
    vm_type       = string
    subnet_name   = string
    role          = optional(string)
    tags_outscale = optional(map(string))
    labels_rke2   = optional(map(string))
    add_volumes   = optional(map(object({
      block_device_mapping  = bool
      fstype                = optional(string)
      mountpoint            = optional(string)
      size          = number
      type          = string
      iops          = optional(number)
    })))
    vgs            = optional(map(object({
      disks        = list(string)
      lvs          = optional(list(object({
        name          = string
        fstype        = optional(string)
        mountpoint    = optional(string)
        size          = number
      })))
    })))
    commands      = optional(list(string))
    sg_names      = optional(list(string))
    sg_ids        = optional(list(string))
  }))
  validation { 
    condition = alltrue([for vm in var.vms : alltrue([for volume in vm.add_volumes : volume.type != "io1" || (volume.iops != null && volume.size >= coalesce(volume.iops, 0) / 300)])]) 
    error_message = "Le ratio entre taille du disque et les IOPS pour les volumes de type 'io1' doit être d'au maximum de 300." 
  }
}
