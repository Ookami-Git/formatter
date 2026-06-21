# Directives de Génération de Schémas YAML pour le "Dynamic Form Formatter"

Ce document contient les spécifications complètes et les règles de syntaxe pour générer des schémas de configuration YAML compatibles avec l'application **Dynamic Form Formatter**. Vous pouvez fournir ce fichier à n'importe quel modèle d'IA pour lui apprendre à générer des schémas YAML valides (avec ou sans template de transformation).

---

## 📌 1. Concepts de base

L'application génère un formulaire dynamique (Interface Utilisateur) à partir d'un schéma YAML, puis produit un document final en sortie (au format YAML, JSON ou HCL/tfvars).

Il existe deux modes de fonctionnement :
1. **Mode Sans Template (Input = Output) :** Le document généré en sortie a exactement la même structure que les valeurs saisies dans le formulaire.
2. **Mode Avec Template (Structure Découplée) :** La racine du schéma contient une propriété `outputTemplate`. Le document généré est construit en appliquant ce template aux valeurs saisies dans le formulaire, permettant des transformations de données (boucles, conditions, renommages, calculs).

---

## ⚙️ 2. Structure Générale d'un Schéma

Un schéma YAML comporte une structure racine avec les propriétés suivantes :

| Propriété | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | **Requis**. Le titre principal affiché en haut du formulaire. |
| `description` | `string` | Optionnel. Texte explicatif affiché sous le titre (supporte le HTML de base). |
| `outputFormat` | `string` | Optionnel. Format présélectionné par défaut (`yaml`, `json`, `hcl`). |
| `outputTemplate` | `object` | Optionnel. Gabarit de transformation (voir Section 4). |
| `fields` | `array` | **Requis**. Liste des champs qui composent le formulaire. |

---

## 🧩 3. Spécifications des Champs (`fields`)

Chaque élément du tableau `fields` peut avoir les propriétés suivantes :

### Propriétés Communes
*   `name` (`string`, **Requis**) : Identifiant technique du champ (clé de l'objet de données).
*   `type` (`string`, **Requis**) : Le type de donnée. Valeurs possibles : `string`, `integer`, `number`, `boolean`, `select`, `object`, `array`.
*   `label` (`string`, Optionnel) : Libellé lisible pour l'utilisateur. Si absent, le `name` est converti en Title Case.
*   `icon` (`string`, Optionnel) : Classes Font Awesome Free affichées dans les modes formulaire et graphique, par exemple `fa-solid fa-server`. Les fichiers Font Awesome sont servis localement, sans CDN. Les noms d'icônes peuvent être consultés sur fontawesome.com.
*   `description` (`string`, Optionnel) : Tooltip ou texte d'aide affiché sous le champ.
*   `required` (`boolean`, Optionnel) : Rend le champ obligatoire (bloque la soumission si vide).
*   `default` (`any`, Optionnel) : Valeur par défaut pré-remplie.
*   `condition` (`string`, Optionnel) : Expression JavaScript évaluant la visibilité du champ (ex: `enable_ssl == true`). Supporte les chemins relatifs/absolus :
    *   `enable_ssl` ou `./enable_ssl` : fait référence à un champ frère (même niveau).
    *   `../enable_ssl` : monte d'un niveau (parent).
    *   `/env` : cible la variable `env` située à la racine du formulaire.
*   `min` (`number`, Optionnel) :
    *   Pour `string` : longueur minimale du texte.
    *   Pour `integer`/`number` : valeur numérique minimale.
    *   Pour `array` : nombre minimum d'éléments.
    *   Pour un `object` dynamique : nombre minimum d'entrées.
*   `max` (`number`, Optionnel) :
    *   Pour `string` : longueur maximale du texte.
    *   Pour `integer`/`number` : valeur numérique maximale.
    *   Pour `array` : nombre maximum d'éléments.
    *   Pour un `object` dynamique : nombre maximum d'entrées.

---

### Propriétés Spécifiques par Type

#### 1. Type `string`
*   `validation` (`object`, Optionnel) :
    *   `regex` (`string`) : Expression régulière pour valider le texte. **Important** : Doubler les antislashs (ex: `"^[a-z0-9-]+$"` ou `"^\\d+$"`).
    *   `message` (`string`, Optionnel) : Message d'erreur personnalisé à afficher en rouge si la regex échoue.

#### 2. Type `select`
*   `options` (`array`, Optionnel) : Liste des choix possibles. Soit un tableau simple : `["dev", "prod"]`, soit des objets clés-valeurs : `[{"value": "dev", "label": "Développement"}]`.
*   `optionsFrom` (`string`, Optionnel) : Chemin absolu (ex: `/subnets`) ou relatif (ex: `../my_list`) vers un autre champ de type tableau existant dans le formulaire pour en extraire dynamiquement les options.
*   `optionsUrl` (`object` ou `string`, Optionnel) : Charge les options à partir d'une API externe. Structure :
    *   `url` (`string`, **Requis**) : URL HTTP(S) de l'API à appeler.
    *   `path` (`string`, Optionnel) : Notation pointée pour cibler un tableau dans un JSON complexe (ex: `project.all.networks`).
    *   `ignoreSsl` (`boolean`, Optionnel) : Désactive la validation SSL.
    *   `auth` (`object`, Optionnel) : Configuration de sécurité :
        *   `type` (`string`) : `"bearer"` ou `"basic"`.
        *   `token` ou `username` / `password` (`string`) : Valeurs statiques.
        *   `tokenEnv` ou `passwordEnv` (`string`) : Nom d'une variable d'environnement du serveur à lire.
        *   `tokenFile` ou `passwordFile` (`string`) : Chemin absolu vers un fichier contenant le secret.

#### 3. Type `array`
*   `itemType` (`string`, **Requis**) : Le type des éléments du tableau (`string`, `integer`, `number`, `boolean`, `object`).
*   `fields` (`array`, **Requis** si `itemType` est `object`) : Schéma récursif des champs composant l'objet à l'intérieur du tableau.
*   *Note sur le rendu dynamique* : Si vous spécifiez `optionsFrom` ou `optionsUrl` sur un champ de type `array` (au lieu de `select`), le champ sera rendu sous forme de **Checklist** (sélection multiple avec cases à cocher et barre de recherche intégrée).

#### 4. Type `object`
*   `fields` (`array`, **Requis** sauf si `dynamicKeys` est activé) : Liste récursive des sous-champs composant l'objet.
*   `dynamicKeys` (`boolean`, Optionnel) : Si `true`, l'objet n'a pas de sous-champs figés. L'utilisateur peut ajouter dynamiquement autant de propriétés libres qu'il le souhaite (ex: `vm1`, `vm2`).
*   `keyLabel` (`string`, Optionnel) : Le libellé du champ de saisie de la clé dynamique (ex: `"Nom de l'hôte"`).
*   `fields` (Optionnel si `dynamicKeys: true`) : Définit la structure de la valeur associée à chaque clé dynamique.

---

## 🔄 4. Le Moteur d'Abstraction (`outputTemplate`)

La présence de `outputTemplate` à la racine dissocie le formulaire d'entrée de la sortie générée. Le gabarit est évalué récursivement et supporte les directives suivantes :

### 1. Expressions et Interpolation : `${...}`
Toutes les chaînes contenant `${...}` sont évaluées comme du JavaScript en utilisant les valeurs saisies dans le formulaire :
*   Accès simple : `${project_name}`
*   Accès imbriqué : `${dns_config.primary_server}`
*   Calculs : `${worker_count * cpu_per_worker}`
*   Ternaires : `${_index === 0 ? 'primary' : 'replica'}`
*   *Note de préservation* : Si la valeur est exactement une expression (ex: `"${worker_count}"`), le type d'origine (nombre, booléen) est préservé dans la sortie finale au lieu d'être converti en texte.

### 2. Directive Conditionnelle : `$if`
Inclus ou exclut une structure selon une condition.
*   `$if` (`string` ou `boolean`) : Expression à évaluer.
*   `$then` (`any`) : Structure ou valeur à générer si la condition est vraie.
*   `$else` (`any`, Optionnel) : Structure ou valeur à générer si la condition est fausse (si non défini, la propriété parente est exclue du rendu final).

### 3. Directive de Répétition : `$repeat`
Génère une boucle d'objets ou de valeurs.
*   `$repeat` (`string` ou `number`) : Le nombre d'itérations, sous forme d'un nombre brut, d'un nom de champ ou d'une expression (ex: `worker_count` ou `"${worker_count + 1}"`).
*   `$item` (`any`, **Requis**) : Le modèle d'objet ou valeur à instancier à chaque itération.
*   `$key` (`string`, Optionnel) : Si fourni, l'itération produit un **dictionnaire/objet** au lieu d'un tableau. La clé est évaluée dynamiquement pour chaque élément (ex: `"server-${_index + 1}"`).

### Variables Spéciales de Boucle (accessibles dans `$item` et `$key`) :
*   `_index` : Index 0-based de l'itération courante (`0, 1, 2...`).
*   `_count` : Nombre total d'itérations programmées dans la boucle.

---

## 📑 5. Documents Multiples (Multi-documents YAML)

L'application supporte le partitionnement de configurations complexes en plusieurs onglets (onglets horizontaux dans l'interface).
Pour ce faire, séparez les documents YAML par un séparateur de document standard `---`.

Chaque sous-document doit commencer par un commentaire sous la forme :
`# formatter_name: Mon Nom d'Onglet`
Ce commentaire permet de donner un titre personnalisé à l'onglet dans l'interface utilisateur.

---

## 📝 6. Exemples Complets à Copier-Coller

### Exemple 1 : Schéma SANS `outputTemplate` (Input = Output)
Le document de sortie correspondra exactement aux champs saisis.

```yaml
title: "Créateur de Namespace K8s"
description: "Configurez un namespace Kubernetes standard."
outputFormat: "yaml"

fields:
  - name: namespace_name
    label: "Nom du Namespace"
    type: "string"
    required: true
    default: "mon-projet"
    validation:
      regex: "^[a-z0-9-]{3,30}$"
      message: "Minuscules, chiffres et tirets uniquement (3 à 30 caractères)."

  - name: environment
    label: "Environnement"
    type: "select"
    default: "dev"
    options: ["dev", "staging", "prod"]

  - name: enable_quotas
    label: "Activer les quotas de ressources"
    type: "boolean"
    default: false

  - name: quotas_config
    label: "Limites de quotas"
    type: "object"
    condition: "enable_quotas == true"
    fields:
      - name: cpu_limit
        label: "CPU Limite globale"
        type: "string"
        default: "4"
      - name: memory_limit
        label: "Mémoire Limite globale"
        type: "string"
        default: "16Gi"

  - name: annotations
    label: "Annotations Personnalisées"
    type: "object"
    dynamicKeys: true
    keyLabel: "Clé de l'annotation"
    description: "Ajoutez des paires clé-valeur libres à attacher aux ressources."
    fields:
      - name: value
        label: "Valeur"
        type: "string"
        required: true
```

---

### Exemple 2 : Schéma AVEC `outputTemplate` (Structure Découplée)
Le formulaire demande quelques paramètres simples, mais la sortie finale est restructurée.

```yaml
title: "Déploiement de Grappe de VM"
description: "Génère l'infrastructure complète d'un cluster cloud."
outputFormat: "yaml"

# ============================================================
# OUTPUT TEMPLATE (Définit la structure de sortie finale)
# ============================================================
outputTemplate:
  cluster_identifier: "${env_type}-${cluster_name}"
  creation_metadata:
    environment: "${env_type}"
    total_cpu_allocated: "${nodes_count * cpu_per_node}"
  
  # Génération d'une liste de VMs
  virtual_machines:
    $repeat: nodes_count
    $item:
      hostname: "${env_type}-${cluster_name}-node-${_index + 1}"
      role: "${_index === 0 ? 'primary-controller' : 'worker-node'}"
      specs:
        cpu: "${cpu_per_node}"
        ram_gb: "${cpu_per_node * 4}" # RAM = CPU * 4
      
      # Réseau additionnel si sélectionné
      network_interfaces:
        - network_name: "default-subnet"
          ip_address: "auto"
        # Ajout conditionnel d'un réseau de backup
        - $if: add_backup_network
          $then:
            network_name: "backup-subnet"
            ip_address: "dhcp"

  # Génération d'une carte d'utilisateurs associés (indexé par leur nom)
  system_users:
    $repeat: nodes_count
    $key: "user-node-${_index + 1}"
    $item:
      username: "admin-node-${_index + 1}"
      ssh_keys:
        - "${ssh_key}"

# ============================================================
# FIELDS (Définit les éléments du formulaire saisis par l'utilisateur)
# ============================================================
fields:
  - name: cluster_name
    label: "Nom du cluster"
    type: "string"
    required: true
    default: "k8s-cluster"

  - name: env_type
    label: "Environnement"
    type: "select"
    default: "dev"
    options: ["dev", "staging", "prod"]

  - name: nodes_count
    label: "Nombre de noeuds"
    type: "integer"
    default: 3
    min: 1
    max: 10

  - name: cpu_per_node
    label: "vCPU par noeud"
    type: "integer"
    default: 2
    options: [2, 4, 8, 16]

  - name: add_backup_network
    label: "Réseau de backup isolé"
    type: "boolean"
    default: false

  - name: ssh_key
    label: "Clé SSH Publique"
    type: "string"
    required: true
    default: "ssh-rsa AAAAB3NzaC1yc..."
```

---

### Exemple 3 : Schéma Multi-documents (Séparé par `---`)
Permet de générer plusieurs fichiers / onglets indépendants avec un seul formulaire par onglet.

```yaml
# formatter_name: Service Kubernetes Deployment
title: "Déploiement de l'Application"
outputFormat: "yaml"
fields:
  - name: app_name
    label: "Nom de l'Application"
    type: "string"
    default: "web-server"
    required: true
  - name: replicas
    label: "Nombre de réplicas"
    type: "integer"
    default: 3
---
# formatter_name: Service Kubernetes Routeur
title: "Service d'exposition (LoadBalancer)"
outputFormat: "yaml"
fields:
  - name: service_port
    label: "Port du Service"
    type: "integer"
    default: 80
  - name: target_port
    label: "Port du Conteneur cible"
    type: "integer"
    default: 8080
```
