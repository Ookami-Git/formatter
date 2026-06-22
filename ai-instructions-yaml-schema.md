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

La présence de `outputTemplate` à la racine dissocie le formulaire d'entrée de la sortie générée. Le gabarit est évalué récursivement et supporte les directives suivantes.

**Liste exhaustive des directives reconnues par le moteur :** `$repeat`, `$item`, `$key`, `$merge`, `$if`, `$then`, `$else`, `$value`.

Toute clé commençant par `$` qui ne fait pas partie de cette liste sera signalée comme une erreur.

---

### 4.1 Expressions et Interpolation : `${...}`
Toutes les chaînes contenant `${...}` sont évaluées comme du JavaScript en utilisant les valeurs saisies dans le formulaire :
*   Accès simple : `${project_name}`
*   Accès imbriqué : `${dns_config.primary_server}`
*   Calculs : `${worker_count * cpu_per_worker}`
*   Ternaires : `${_index === 0 ? 'primary' : 'replica'}`
*   Accès tableau : `${availability_zones[_index % availability_zones.length]}`
*   *Note de préservation de type* : Si la valeur entière est exactement une expression (ex: `"${worker_count}"`), le type d'origine (nombre, booléen, tableau) est préservé dans la sortie finale au lieu d'être converti en texte. Pour de l'interpolation mixte (ex: `"vm-${_index + 1}"`), le résultat est toujours une chaîne.

---

### 4.2 Directive Conditionnelle : `$if` / `$then` / `$else`

Inclut ou exclut une structure selon une condition.

*   `$if` (`string` ou `boolean`) : Expression à évaluer. Peut être :
    *   Un nom de champ simple (ex: `enable_ssl`) : évalué comme truthy/falsy.
    *   Une expression JS complète (ex: `"env === 'prod'"`, `"count > 3"`).
*   `$then` (`any`, **Requis** si `$if` est présent) : Structure ou valeur à générer si la condition est vraie.
*   `$else` (`any`, Optionnel) : Structure ou valeur à générer si la condition est fausse.

**Règles de comportement selon le contexte :**

#### `$if` utilisé comme **valeur d'une clé d'objet** :
Si la condition est fausse et qu'il n'y a pas de `$else`, la clé parente est **entièrement supprimée** de la sortie.

```yaml
# Exemple : la clé "backup_config" disparaît si enable_backup est falsy
outputTemplate:
  main_config:
    name: "${app_name}"
    backup_config:
      $if: enable_backup
      $then:
        enabled: true
        path: "/backup"
```

#### `$if` utilisé comme **élément d'un tableau** :
Si la condition est fausse et qu'il n'y a pas de `$else`, l'élément est **retiré du tableau** (pas de `null` inséré).

```yaml
# Exemple : l'élément backup-subnet n'apparaît dans le tableau QUE si add_backup est truthy
outputTemplate:
  network_interfaces:
    - network_name: "default-subnet"
      ip_address: "auto"
    - $if: add_backup
      $then:
        network_name: "backup-subnet"
        ip_address: "dhcp"
```

**Règle de truthy/falsy :** `null`, `undefined`, `false`, `0`, `""` (chaîne vide), `[]` (tableau vide), et `{}` (objet vide) sont tous considérés comme **falsy**. Tout le reste est **truthy**.

---

### 4.3 Directive de Répétition : `$repeat` / `$item` / `$key`

Génère une boucle d'objets ou de valeurs.

*   `$repeat` (`string` ou `number`, **Requis**) : Le nombre d'itérations, sous forme de :
    *   Un nombre brut : `$repeat: 3`
    *   Un nom de champ : `$repeat: worker_count`
    *   Un chemin imbriqué entre guillemets : `$repeat: "cp_template.quantite"`
    *   Une expression entre guillemets : `$repeat: "${worker_count + 1}"`
*   `$item` (`any`, **Requis** avec `$repeat`) : Le modèle d'objet ou valeur à instancier à chaque itération.
*   `$key` (`string`, Optionnel) : Si fourni, l'itération produit un **objet/dictionnaire** au lieu d'un tableau. La clé est évaluée dynamiquement pour chaque élément (ex: `"server-${_index + 1}"`).

**Résumé du comportement de sortie :**
*   `$repeat` + `$item` (sans `$key`) → produit un **tableau** `[item0, item1, ...]`
*   `$repeat` + `$item` + `$key` → produit un **objet/dictionnaire** `{ "clé0": item0, "clé1": item1, ... }`

#### Variables Spéciales de Boucle (accessibles dans `$item` et `$key`) :
*   `_index` : Index 0-based de l'itération courante (`0, 1, 2...`).
*   `_count` : Nombre total d'itérations programmées dans la boucle.

---

### 4.4 Directive de Fusion : `$merge`

**Cas d'usage critique :** Quand vous devez combiner **plusieurs boucles `$repeat`** (ou plusieurs blocs d'objets) dans **un seul et même objet/dictionnaire**.

*   `$merge` (`array`, **Requis**) : Un tableau de blocs. Chaque bloc est traité individuellement (peut être un `$repeat` avec `$key`, un objet ordinaire, etc.), puis tous les résultats sont fusionnés en un seul objet plat via `Object.assign`.

```yaml
# Exemple : Fusionner les Control Planes et les Workers en un seul dictionnaire "vms"
outputTemplate:
  vms:
    $merge:
      # Bloc 1 : génère { "cp-0": {...}, "cp-1": {...}, "cp-2": {...} }
      - $repeat: cp_count
        $key: "cp-${_index}"
        $item:
          role: "controlplane"
          cpu: "${cp_cpu}"

      # Bloc 2 : génère { "wk-0": {...}, "wk-1": {...} }
      - $repeat: worker_count
        $key: "wk-${_index}"
        $item:
          role: "worker"
          cpu: "${worker_cpu}"

# Résultat fusionné :
# vms:
#   cp-0: { role: "controlplane", cpu: 4 }
#   cp-1: { role: "controlplane", cpu: 4 }
#   cp-2: { role: "controlplane", cpu: 4 }
#   wk-0: { role: "worker", cpu: 8 }
#   wk-1: { role: "worker", cpu: 8 }
```

**Contrainte importante :** `$merge` ne fusionne que des **objets** (dictionnaires). Chaque bloc du tableau `$merge` doit produire un objet (pas un tableau). Utilisez donc `$key` avec `$repeat` à l'intérieur d'un `$merge`.

---

### 4.5 Directive de Valeur Directe : `$value`

Résout directement une expression et retourne sa valeur brute. Utile pour les cas où la valeur de sortie est une expression qui ne peut pas être écrite comme une simple interpolation de chaîne.

*   `$value` (`string`) : Expression à évaluer.

```yaml
outputTemplate:
  computed_total:
    $value: "worker_count * cpu_per_node"
```

---

## ⚠️ 5. Règles Critiques et Erreurs Courantes

Cette section liste les erreurs les plus fréquentes commises lors de la génération de schémas. **Lisez attentivement chaque règle avant de générer un schéma.**

### Règle 1 : Ne JAMAIS utiliser deux tableaux à la suite pour fusionner des résultats

**❌ INTERDIT — Ceci est invalide en YAML et ne fonctionne pas :**
```yaml
# ERREUR : Deux tableaux assignés à la même clé "vms"
outputTemplate:
  vms:
    $repeat: cp_count
    $key: "cp-${_index}"
    $item:
      role: "controlplane"
  vms:   # ← ERREUR : clé dupliquée, YAML écrase la première
    $repeat: worker_count
    $key: "wk-${_index}"
    $item:
      role: "worker"
```

**✅ CORRECT — Utiliser `$merge` pour combiner plusieurs boucles :**
```yaml
outputTemplate:
  vms:
    $merge:
      - $repeat: cp_count
        $key: "cp-${_index}"
        $item:
          role: "controlplane"
      - $repeat: worker_count
        $key: "wk-${_index}"
        $item:
          role: "worker"
```

### Règle 2 : `$repeat` nécessite toujours `$item`

**❌ INTERDIT :**
```yaml
servers:
  $repeat: count
  hostname: "server-${_index}"  # ERREUR : pas de $item
```

**✅ CORRECT :**
```yaml
servers:
  $repeat: count
  $item:
    hostname: "server-${_index}"
```

### Règle 3 : `$if` nécessite toujours `$then`

**❌ INTERDIT :**
```yaml
backup_path:
  $if: enable_backup
  value: "/backup"  # ERREUR : pas de $then
```

**✅ CORRECT :**
```yaml
backup_path:
  $if: enable_backup
  $then: "/backup"
```

### Règle 4 : Les directives `$` ne doivent PAS être mélangées avec des clés ordinaires au même niveau

**❌ INTERDIT :**
```yaml
servers:
  $repeat: count
  $item:
    hostname: "server-${_index}"
  extra_key: "value"  # ERREUR : mélange de directives et de clés ordinaires
```

### Règle 5 : Échappement des expressions YAML ambiguës

Les valeurs qui commencent par `${` ou qui contiennent des caractères spéciaux YAML (`:`, `#`, `{`, `}`, `[`, `]`) doivent être entre guillemets :

```yaml
# ✅ CORRECT
hostname: "${env}-server-${_index}"

# ❌ ERREUR — YAML interprète le { comme un objet
hostname: ${env}-server-${_index}
```

### Règle 6 : `$repeat` avec un chemin imbriqué doit être entre guillemets

```yaml
# ✅ CORRECT — Le chemin est entre guillemets
$repeat: "cp_template.quantite"

# ❌ ERREUR — YAML interprète le point comme un texte ordinaire sans guillemets
# Cela fonctionnerait quand même car c'est traité comme une expression,
# mais les guillemets sont la bonne pratique pour les chemins imbriqués.
```

---

## 📑 6. Documents Multiples (Multi-documents YAML)

L'application supporte le partitionnement de configurations complexes en plusieurs onglets (onglets horizontaux dans l'interface).
Pour ce faire, séparez les documents YAML par un séparateur de document standard `---`.

Chaque sous-document doit commencer par un commentaire sous la forme :
`# formatter_name: Mon Nom d'Onglet`
Ce commentaire permet de donner un titre personnalisé à l'onglet dans l'interface utilisateur.

---

## 📋 7. Référence Rapide des Directives

| Directive | Requis avec | Produit | Description |
|:---|:---|:---|:---|
| `$repeat` | `$item` | tableau ou objet | Itère N fois. Produit un tableau sauf si `$key` est fourni. |
| `$item` | `$repeat` | — | Template de chaque élément d'une itération. |
| `$key` | `$repeat` | — | Clé dynamique → transforme le tableau en objet/dictionnaire. |
| `$merge` | — | objet | Fusionne un tableau de blocs en un seul dictionnaire. |
| `$if` | `$then` | — | Condition d'inclusion d'un bloc. |
| `$then` | `$if` | any | Valeur/structure si la condition est vraie. |
| `$else` | `$if` | any | Valeur/structure si la condition est fausse (optionnel). |
| `$value` | — | any | Résolution directe d'une expression JavaScript. |
| `${expr}` | — | string ou type préservé | Interpolation dans les chaînes de caractères. |

**Variables de boucle :** `_index` (0-based), `_count` (total d'itérations).

---

## 📝 8. Exemples Complets à Copier-Coller

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

### Exemple 2 : Schéma AVEC `outputTemplate` — Toutes les directives

Cet exemple démontre l'utilisation de **toutes les directives** du moteur : `$repeat`, `$item`, `$key`, `$merge`, `$if`/`$then`/`$else`, et l'interpolation `${...}`.

```yaml
title: "Déploiement de Grappe de VM"
description: "Génère l'infrastructure complète d'un cluster cloud avec CP et Workers fusionnés."
outputFormat: "yaml"

# ============================================================
# OUTPUT TEMPLATE (Définit la structure de sortie finale)
# ============================================================
outputTemplate:
  cluster_identifier: "${env_type}-${cluster_name}"
  creation_metadata:
    environment: "${env_type}"
    total_cpu_allocated: "${nodes_count * cpu_per_node}"

  # ── $repeat + $item (sans $key) → produit un TABLEAU ─────────
  virtual_machines:
    $repeat: nodes_count
    $item:
      hostname: "${env_type}-${cluster_name}-node-${_index + 1}"
      role: "${_index === 0 ? 'primary-controller' : 'worker-node'}"
      specs:
        cpu: "${cpu_per_node}"
        ram_gb: "${cpu_per_node * 4}"

      # $if dans un tableau : l'élément est retiré si la condition est fausse
      network_interfaces:
        - network_name: "default-subnet"
          ip_address: "auto"
        - $if: add_backup_network
          $then:
            network_name: "backup-subnet"
            ip_address: "dhcp"

  # ── $repeat + $item + $key → produit un DICTIONNAIRE ─────────
  system_users:
    $repeat: nodes_count
    $key: "user-node-${_index + 1}"
    $item:
      username: "admin-node-${_index + 1}"
      ssh_keys:
        - "${ssh_key}"

  # ── $merge → fusionne PLUSIEURS boucles en UN SEUL dictionnaire ─
  all_nodes:
    $merge:
      # Bloc 1 : Control Planes
      - $repeat: cp_count
        $key: "${env_type}-${cluster_name}-cp-${_index}"
        $item:
          role: "controlplane"
          cpu: "${cpu_per_node}"

      # Bloc 2 : Workers
      - $repeat: nodes_count
        $key: "${env_type}-${cluster_name}-wk-${_index}"
        $item:
          role: "worker"
          cpu: "${cpu_per_node}"

  # ── $if/$then/$else en tant que valeur d'une clé ──────────────
  ssl_config:
    $if: "env_type === 'prod'"
    $then:
      enabled: true
      cert_path: "/etc/ssl/certs/${cluster_name}.pem"
    $else:
      enabled: false

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

  - name: cp_count
    label: "Nombre de Control Planes"
    type: "integer"
    default: 3
    min: 1
    max: 5

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
