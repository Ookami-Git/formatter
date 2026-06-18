variable "subnets" {
  type        = list(string)
  description = "A global list of tools."
  default     = ["a", "b", "c"]
}

variable "virtual_machines" {
  type = map(object({
    add_volumes = optional(map(object({
      block_device_mapping = bool
      size                 = number
    })))
    ip_address = string
    subnet_name = string
    vgs = optional(map(object({
      disks = list(string)
      lvs = list(object({
        name       = string
        size       = number
        mountpoint = string
        fstype     = string
      }))
    })))
    vm_type = string
  }))
  description = "Dynamic VMs mapping where disks are referenced from add_volumes keys. @optionsFrom(vgs.disks = ../../add_volumes) @optionsFrom(subnet_name = /subnets)"
  default = {
    "my-example-vm" = {
      add_volumes = {
        "disk1" = {
          block_device_mapping = true
          size                 = 20
        }
      }
      ip_address = ""
      subnet_name = "a"
      vgs = {
        "my-vg" = {
          disks = ["disk1"]
          lvs = [
            {
              fstype     = "ext4"
              mountpoint = "/data"
              name       = "data"
              size       = 20
            }
          ]
        }
      }
      vm_type = "t3.medium"
    }
  }
}
