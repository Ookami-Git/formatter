# ⚡ Dynamic Form Formatter

Générateur de formulaire dynamique qui produit du **JSON**, **YAML** ou **HCL/tfvars** en temps réel à partir de schémas YAML, JSON ou Terraform (`.tf`).

![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-ready-326CE5?logo=kubernetes&logoColor=white)
![Helm](https://img.shields.io/badge/Helm-chart-0F1689?logo=helm&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)

---

## 📋 Fonctionnalités

- 🔄 **Live Preview** — Le résultat s'actualise en temps réel pendant la saisie
- 📑 **Multi-documents YAML** — Séparateurs `---` convertis en onglets avec nommage via `# formatter_name:`
- 🧩 **Objets dynamiques** — Les objets YAML peuvent avoir des clés libres comme `vm1`, `vm2` ou `node-a`
- 🔀 **Formats de sortie** — JSON, YAML, HCL/tfvars en un clic
- 📥 **Import** — Coller une configuration existante pour la modifier via le formulaire
- 🔐 **Source Git privée** — Charger le schéma depuis un dépôt Git privé (GitHub/GitLab) via token
- 🏗️ **Terraform natif** — Parse directement les fichiers `variables.tf` avec validation, types complexes, etc.
- ✅ **Healthcheck** — Endpoint `/healthz` pour Kubernetes liveness/readiness probes
- 📋 **Copier en 1 clic** — Bouton de copie dans le presse-papier

---

## 🚀 Démarrage rapide

### Docker

```bash
# Image depuis GitHub Container Registry (schéma exemple intégré)
docker run -d -p 3000:3000 ghcr.io/ookami-git/formatter:latest
```

Avec un schéma local monté :

```bash
docker run -d -p 3000:3000 \
  -v $(pwd)/mon-schema.yaml:/app/config/schema.yaml \
  ghcr.io/ookami-git/formatter:latest
```

Avec une source Git (repo privé) :

```bash
docker run -d -p 3000:3000 \
  -e CONFIG_SOURCE=git \
  -e GIT_REPO_URL=https://github.com/mon-org/mon-repo.git \
  -e GIT_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx \
  -e GIT_BRANCH=main \
  -e GIT_CONFIG_PATH=infra/variables.tf \
  ghcr.io/ookami-git/formatter:latest
```

Avec une source URL :

```bash
docker run -d -p 3000:3000 \
  -e CONFIG_SOURCE=url \
  -e URL_ADDRESS=https://raw.githubusercontent.com/mon-org/mon-repo/main/schema.yaml \
  ghcr.io/ookami-git/formatter:latest
```

### Node.js (développement)

```bash
npm install
npm start
# → http://localhost:3000
```

---

## ⚙️ Variables d'environnement

| Variable | Description | Valeur par défaut | Requis |
|---|---|---|---|
| `PORT` | Port d'écoute du serveur HTTP | `3000` | Non |
| `CONFIG_SOURCE` | Source de la configuration : `local`, `git` ou `url` | `local` | Non |
| `CONFIG_PATH` | Chemin du fichier de configuration (mode `local`) | `/app/examples/schema.yaml` | Non |
| `GIT_REPO_URL` | URL du dépôt Git à cloner (sans token) | — | Oui si `git` |
| `GIT_TOKEN` | Token d'authentification Git (PAT GitHub/GitLab). Injecté automatiquement dans l'URL | — | Non (repos privés) |
| `GIT_BRANCH` | Branche Git à utiliser | `main` | Non |
| `GIT_CONFIG_PATH` | Chemin du fichier de config dans le dépôt Git | `variables.tf` | Non |
| `URL_ADDRESS` | URL HTTP/HTTPS du fichier de schéma (mode `url`) | — | Oui si `url` |
| `URL_IGNORE_SSL` | Ignorer la vérification SSL (`true`/`false`) | `false` | Non |
| `HTTP_PROXY` | URL du proxy HTTP à utiliser pour le clonage Git et les requêtes sortantes | — | Non |
| `HTTPS_PROXY` | URL du proxy HTTPS à utiliser pour le clonage Git et les requêtes sortantes | — | Non |
| `CONFIGS_JSON` | Liste des configurations au format JSON (mode multi-config) | — | Non |
| `CONFIGS_FILE` | Chemin vers un fichier JSON/YAML listant les configurations | — | Non |
| `CONFIGS_DIR` | Chemin vers un dossier à scanner pour enregistrer automatiquement tous les schémas présents | — | Non |

### 🔐 Authentification Git (repos privés)

Le token est **séparé de l'URL** pour permettre un stockage sécurisé :

**Docker** — via variable d'environnement :
```bash
docker run -e GIT_TOKEN=ghp_xxxx -e GIT_REPO_URL=https://github.com/org/repo.git ...
```

**Kubernetes** — via Secret :
```bash
# Créer le secret
kubectl create secret generic my-git-token --from-literal=GIT_TOKEN=ghp_xxxxxxxxxxxx

# Référencer dans le Deployment (env var depuis secretKeyRef)
```

**Helm** — via `values.yaml` :
```yaml
app:
  configs:
    - id: main
      name: "Main Schema"
      source: git
      git:
        repoUrl: "https://github.com/org/repo.git"
        token: "ghp_xxxxxxxxxxxx"          # → crée un Secret automatiquement
        # OU
        existingTokenSecret: "my-git-secret"  # → utilise un Secret existant (clé: GIT_TOKEN)
```

> **Note :** L'injection est automatique — GitHub reçoit `https://TOKEN@github.com/...`, GitLab reçoit `https://oauth2:TOKEN@gitlab.com/...`. Le token est masqué dans les logs serveur.

---

## 🗂️ Mode Multi-Configurations

Il est possible de faire tourner l'application avec plusieurs fichiers de configuration indépendants. L'utilisateur peut basculer de l'un à l'autre via un menu déroulant dans l'interface ou y accéder directement via un paramètre dans l'URL.

Trois approches sont possibles pour configurer le mode Multi-Configurations :

### Option 1 : Définir la liste via une variable d'environnement JSON (`CONFIGS_JSON`)
Cette méthode est idéale pour Docker ou Helm car elle ne nécessite aucun fichier supplémentaire.

```bash
docker run -d -p 3000:3000 \
  -e CONFIGS_JSON='[{"id":"frontend","name":"Frontend","sourceType":"local","localPath":"/app/examples/schema.yaml"},{"id":"backend","name":"Backend (Git)","sourceType":"git","gitRepoUrl":"https://github.com/my-org/backend-repo.git","gitBranch":"main","gitConfigPath":"variables.tf"}]' \
  ghcr.io/ookami-git/formatter:latest
```

### Option 2 : Scanner un répertoire contenant plusieurs schémas (`CONFIGS_DIR` ou `CONFIG_PATH`)
Si vous montez un dossier contenant plusieurs fichiers de schéma (`.yaml`, `.yml`, `.json`, `.tf`), le serveur va automatiquement les détecter et les enregistrer comme configurations séparées.

Dans cette configuration, l'ID et le nom de chaque configuration sont automatiquement dérivés du nom de fichier.

**Avec Docker :**
```bash
docker run -d -p 3000:3000 \
  -v $(pwd)/mes-schemas:/app/mes-schemas \
  -e CONFIGS_DIR=/app/mes-schemas \
  ghcr.io/ookami-git/formatter:latest
```

**Avec Kubernetes (Helm) :**
Vous pouvez monter un ConfigMap contenant plusieurs fichiers dans `/app/config` et configurer le paramètre `app.configsDir` à `/app/config` (qui est un dossier). Le serveur traitera automatiquement ce dossier comme source multi-configs.

### Option 3 : Utiliser un fichier d'index de configurations (`CONFIGS_FILE`)
Vous pouvez spécifier un fichier YAML ou JSON listant toutes vos configurations disponibles.

Fichier `/app/mes-configs.yaml` :
```yaml
configs:
  - id: app-infra
    name: "Infrastructure Cloud"
    sourceType: local
    localPath: "/app/examples/schema.yaml"
  - id: app-k8s
    name: "Déploiement Kubernetes"
    sourceType: url
    url: "https://raw.githubusercontent.com/org/repo/main/k8s-schema.yaml"
```

Lancement :
```bash
docker run -d -p 3000:3000 \
  -v $(pwd)/mes-configs.yaml:/app/mes-configs.yaml \
  -e CONFIGS_FILE=/app/mes-configs.yaml \
  ghcr.io/ookami-git/formatter:latest
```

---

### 🔗 Liens directs via URL
Une fois configuré, vous pouvez charger directement une configuration cible en ajoutant le paramètre de requête `config` dans l'URL :
- `http://localhost:3000/?config=app-infra`
- `http://localhost:3000/?config=app-k8s`

Le basculement dans l'interface met à jour l'URL dynamiquement sans rechargement de page, préservant une expérience Single Page Application (SPA).

---

## 📦 Formats de schéma supportés

### YAML (`.yaml` / `.yml`)

```yaml
title: "Mon Application"
description: "Configurez votre déploiement"
fields:
  - name: app_name
    label: "Nom"
    type: string
    default: "my-app"
    required: true

  - name: replicas
    label: "Réplicas"
    type: integer
    default: 3

  - name: enable_ssl
    label: "Activer SSL"
    type: boolean
    default: false

  - name: environment
    label: "Environnement"
    type: select
    options: [dev, staging, prod]
    default: dev

  - name: hosts
    label: "Hôtes"
    type: object
    dynamicKeys: true
    keyLabel: "Nom de l'hôte"
    description: "Chaque entrée crée une clé dynamique dans l'objet final."
    fields:
      - name: ip
        label: "Adresse IP"
        type: string
      - name: role
        label: "Rôle"
        type: string
        default: worker
```

Avec `dynamicKeys: true`, le champ `object` n'est plus limité à des sous-propriétés connues à l'avance. L'utilisateur ajoute autant d'entrées qu'il veut, saisit la clé de chaque objet, puis remplit un sous-formulaire pour la valeur associée.

Exemple de sortie générée:

```yaml
hosts:
  vm1:
    ip: 10.0.0.10
    role: control-plane
  vm2:
    ip: 10.0.0.11
    role: worker
```

### Référencement de variables dans un schéma YAML/JSON

```yaml
fields:
  - name: subnets
    label: "Subnets"
    type: array
    itemType: string
    default: [a, b, c]

  - name: subnet_name
    label: "Subnet sélectionné"
    type: select
    optionsFrom: /subnets
```

### Récupération dynamique d'options depuis une URL (`optionsUrl`)

Permet de charger dynamiquement la liste d'options depuis une URL HTTP(S) externe (effectué via une requête GET).
L'application intègre un bouton de rafraîchissement forcé (icône tournante) à côté du champ pour court-circuiter le cache client (qui a une durée de vie par défaut de 5 minutes).

```yaml
fields:
  - name: subnets_from_url
    label: "Sélection de sous-réseau"
    type: select
    optionsUrl:
      url: "https://api.mon-infra.com/subnets"
      ignoreSsl: true              # Optionnel, contourne la vérification SSL
      path: "project.all.subnets"  # Optionnel, notation pointée pour cibler un tableau sous un objet complexe
      auth:                        # Optionnel, Basic ou Bearer auth
        # Exemple avec Bearer Auth :
        type: "bearer"
        token: "mon-token-statique"
        # Pour une sécurité accrue orientée Kubernetes (Secret/EnvVar) :
        # tokenEnv: "MON_TOKEN_ENV_VAR"
        # tokenFile: "/secrets/mon-token/token"

        # OU Exemple avec Basic Auth :
        # type: "basic"
        # username: "mon-utilisateur"
        # password: "mon-mot-de-passe-statique"
        # Pour une sécurité accrue orientée Kubernetes (Secret/EnvVar) :
        # passwordEnv: "MON_PASSWORD_ENV_VAR"
        # passwordFile: "/secrets/mon-password/password"
```

### Sélection multiple avec cases à cocher (Checklists)

Si la variable de destination du formulaire (le champ qui porte `optionsFrom` ou `optionsUrl`) est déclarée avec le type `array` (au lieu de `select` ou `string`), l'application génère automatiquement une **checklist** sous forme de cases à cocher multiples.
- **Support des longues listes** : Les éléments sont présentés dans un bloc de hauteur maximale (`200px`) avec défilement vertical pour préserver la lisibilité de la page.
- **Barre de recherche intégrée** : Un champ de texte permet de filtrer en temps réel les choix par mot-clé (insensible à la casse).

```yaml
fields:
  - name: subnets
    label: "Sous-réseaux"
    type: array
    itemType: string
    optionsUrl: "https://api.mon-infra.com/subnets" # Rendu en checklist avec recherche
```

### Multi-documents YAML (onglets)

```yaml
# formatter_name: Frontend
title: "Frontend Config"
fields:
  - name: port
    type: integer
    default: 3000
---
# formatter_name: Backend
title: "Backend Config"
fields:
  - name: db_host
    type: string
    default: "localhost"
```

### Terraform (`.tf`)

```hcl
variable "app_name" {
  description = "Nom de l'application"
  type        = string
  default     = "my-app"
}

variable "replica_count" {
  description = "Nombre de réplicas"
  type        = number
  default     = 3
}

variable "tags" {
  description = "Labels"
  type        = map(string)
  default     = {}
}
```

#### Annotations Terraform supportées

- `@ignore` dans la description d'une variable Terraform exclut totalement la variable du formulaire généré.
- `@optionsFrom(<target> = <source>)` permet de lier un champ de type `select` à des valeurs provenant d'une autre propriété du schéma.
  - `<source>` peut être un chemin absolu commençant par `/` ou un chemin relatif avec `..`.
  - `<target>` peut cibler un sous-champ au sein d'un objet complexe.
- @optionsUrl(<target> = <source_url_or_json>)` permet de charger dynamiquement des options depuis une URL HTTP(S) externe.
  - `<source_url_or_json>` peut être une simple URL ou un objet JSON complet (avec paramètres `auth`, `ignoreSsl`, `path`).
- `@condition(<expression>)` permet de définir une condition de visibilité pour la variable. La variable ne s'affiche et son contenu n'est généré que si l'expression est vraie.
  - `@condition(<target> = <expression>)` permet de cibler un sous-champ au sein d'un objet complexe.

> Pour les schémas YAML/JSON, utilisez directement la propriété `optionsFrom`, `optionsUrl` ou `condition` au niveau du champ.

Exemples :

```hcl
variable "subnet_name" {
  description = "Nom du subnet. @optionsFrom(subnet_name = /subnets)"
  type        = string
}

# Exemple simple d'optionsUrl avec une chaîne de caractères (URL directe en simple quotes) :
variable "app_environment" {
  type        = string
  description = "Environnement cible. @optionsUrl(app_environment = 'https://api.mon-infra.com/environments')"
}

# Exemple complexe avec objet JSON (utilisation recommandée des simples quotes pour éviter d'échapper les guillemets) :
variable "target_network" {
  type        = string
  description = "Réseau cible. @optionsUrl(target_network = {'url': 'https://api.mon-infra.com/networks', 'path': 'project.all.networks', 'ignoreSsl': true, 'auth': {'type': 'basic', 'username': 'admin', 'passwordEnv': 'MY_NETWORKS_PASSWORD'}})"
}

# (Optionnel) Il reste possible d'utiliser des guillemets doubles en les échappant :
# description = "Réseau cible. @optionsUrl(target_network = {\"url\": \"https://api.mon-infra.com/networks\"})"


variable "internal_token" {
  description = "Champ interne ignoré par le générateur. @ignore"
  type        = string
  default     = "hidden"
}
```

### Types de champs supportés

| Type | Rendu | Notes |
|---|---|---|
| `string` | Champ texte | Supporte la validation par expression régulière (`validation.regex`). |
| `integer` / `number` | Champ numérique | Step=1 pour integer, step=any pour number. |
| `boolean` | Toggle switch | Rendu sous forme de bouton à bascule. |
| `select` | Liste déroulante | Requiert `options` (ou extrait des blocs de validation Terraform). |
| `object` | Carte imbriquée | Permet des sous-champs récursifs via la propriété `fields`. |
| `array` | Liste dynamique | Supporte `itemType`. Si `itemType: object`, requiert la propriété `fields`. |
| `object` avec `dynamicKeys: true` | Carte d'objets à clés libres | Chaque entrée affiche une clé éditable suivie d'un sous-formulaire `fields`. |

---

### 📋 Structure détaillée du Schéma (YAML / JSON)

Un schéma de configuration valide est constitué d'un objet racine contenant les métadonnées globales, suivi d'une liste de définitions de champs.

#### Structure racine

| Propriété | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | Le titre principal affiché en haut du formulaire. |
| `description` | `string` | Un texte explicatif affiché sous le titre (supporte le HTML basique). |
| `outputFormat` | `string` | Format de sortie présélectionné par défaut (`json`, `yaml`, `hcl`). |
| `fields` | `array` | Liste des définitions de champs composant le formulaire. |

---

#### Propriétés d'un champ (`field`)

Chaque élément du tableau `fields` comporte les propriétés suivantes :

| Propriété | Type | Rendu / Usage | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Requis** | Identifiant technique du champ (clé utilisée dans le document généré en sortie). |
| `type` | `string` | **Requis** | Type de donnée et de composant UI (`string`, `integer`, `number`, `boolean`, `select`, `object`, `array`). |
| `label` | `string` | Optionnel | Libellé convivial affiché à l'utilisateur. Par défaut, le `name` converti en Title Case (ex: `app_name` ➜ `Nom de l'application`). |
| `description` | `string` | Optionnel | Description d'aide ou tooltip affiché sous le champ de saisie. |
| `required` | `boolean` | Optionnel | Rend le champ obligatoire (ajoute un astérisque rouge et bloque la validation). |
| `default` | `any` | Optionnel | Valeur par défaut préremplie dans le formulaire au chargement. |
| `options` | `array` | Requis si `select` | Liste d'options sous la forme simple `["dev", "prod"]` ou d'objets `[{"value": "dev", "label": "Développement"}]`. |
| `optionsFrom` | `string` | Optionnel | Chemin vers une autre valeur/collection existante dans le schéma (`/subnets`, `../add_volumes`). Utilisé pour remplir dynamiquement un `select`. |
| `itemType` | `string` | Requis si `array` | Type des éléments du tableau (`string`, `integer`, `number`, `boolean`, `object`). |
| `fields` | `array` | Requis si `object` (ou `array` d'objets) | Liste récursive des sous-champs composant la structure imbriquée. |
| `dynamicKeys` | `boolean` | Optionnel | Si `true`, l'objet est rendu comme une carte dont les clés sont ajoutées à la volée. |
| `keyLabel` | `string` | Optionnel | Libellé du champ utilisé pour saisir la clé d'un objet dynamique. |
| `validation` | `object` | Optionnel | Règles de validation. Supporté pour les champs de type `string` (voir ci-dessous). |
| `condition` | `string` | Optionnel | Expression JavaScript définissant la condition d'affichage du champ (ex: `enable_ssl == true`). Supporte les opérateurs logiques (`&&`, `||`, `!`) et les chemins relatifs (ex: `../enable_ssl`). |
| `min` | `number` | Optionnel | Limite minimale. Valide la longueur (pour `string`), la valeur numérique (pour `integer`/`number`), ou le nombre d'éléments/entrées (pour `array` et `object` dynamique). |
| `max` | `number` | Optionnel | Limite maximale. Valide la longueur (pour `string`), la valeur numérique (pour `integer`/`number`), ou le nombre d'éléments/entrées (pour `array` et `object` dynamique). |

---

#### 🔀 Champs conditionnés (Conditions de visibilité)

Il est possible de masquer des champs du formulaire et de les exclure totalement du document de sortie (JSON, YAML ou HCL/tfvars) selon une condition logique.

##### Expressions supportées
Les conditions sont des expressions JavaScript évaluées dynamiquement. Vous pouvez utiliser :
- Des opérateurs de comparaison (`==`, `!=`, `<`, `>`, `===`, etc.).
- Des opérateurs logiques pour chaîner des conditions : `&&` (ET), `||` (OU), `!` (NON).
- Des parenthèses `( )` pour définir des priorités d'évaluation.

##### Chemins relatifs (Navigation dans la configuration)
Si un champ est imbriqué dans un objet ou un tableau, vous pouvez faire référence à d'autres champs à l'aide de chemins relatifs ou absolus :
- `enable_ssl` ou `./enable_ssl` : fait référence à un champ frère (au même niveau).
- `../enable_ssl` : monte d'un niveau (parent) pour trouver `enable_ssl`.
- `../../env` : monte de deux niveaux.
- `/env` : cible le champ `env` situé à la racine du schéma.

##### Exemple YAML :
```yaml
fields:
  - name: env
    type: select
    options: [dev, prod]
    default: dev
  - name: enable_ssl
    type: boolean
    default: false
  - name: ssl_config
    type: object
    fields:
      - name: port
        type: integer
        default: 443
        condition: "../enable_ssl == true"
      - name: cert_secret
        type: string
        condition: "../enable_ssl == true && ../../env == 'prod'"
```

##### Exemple Terraform HCL :
```hcl
variable "env" {
  type    = string
  default = "dev"
}

variable "database" {
  type = object({
    use_ssl  = bool
    ssl_port = number
  })
  description = "Config DB. @condition(ssl_port = use_ssl == true && ../env == 'prod')"
}
```

---

#### Validation de format (Expressions régulières / Regex)

La validation s'applique aux champs de type `string` grâce à l'objet `validation` :

```yaml
fields:
  - name: email
    label: "Adresse Email"
    type: string
    required: true
    validation:
      regex: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
      message: "Veuillez entrer une adresse email valide."
```

| Propriété | Type | Description |
| :--- | :--- | :--- |
| `regex` | `string` | **Requis** | Le motif regex de validation (ex: `^[a-z0-9-]+$`). Attention à doubler les antislashs en YAML/JSON (`\\`). |
| `message` | `string` | Optionnel | Le message d'erreur affiché en rouge sous le champ lorsque la regex échoue. |

---

#### Validation de valeur, longueur et quantité (`min` / `max`)

Il est possible de contraindre les valeurs saisies, la longueur du texte ou le nombre d'éléments/options à l'aide des propriétés `min` et `max` :

| Type de champ | Rôle de `min` | Rôle de `max` | Comportement UI / Validation |
| :--- | :--- | :--- | :--- |
| `string` | Longueur minimale du texte | Longueur maximale du texte | Une erreur s'affiche si le texte est trop court. L'attribut HTML `maxlength` empêche physiquement de saisir un texte dépassant `max`. |
| `integer` / `number` | Valeur numérique minimale | Valeur numérique maximale | La valeur saisie est automatiquement limitée (clamped) dans l'intervalle défini lors de la saisie ou de la perte de focus. |
| `array` (liste) | Nombre minimum d'éléments | Nombre maximum d'éléments | Une erreur s'affiche si le nombre d'éléments est inférieur à `min`. Le bouton "Ajouter un élément" est désactivé et les duplications sont bloquées une fois la limite `max` atteinte. |
| `array` (checklist) | Nombre minimum d'options cochées | Nombre maximum d'options cochées | Une erreur s'affiche si trop peu de cases sont cochées. Les cases non cochées sont désactivées pour empêcher de dépasser `max`. |
| `object` (clé dynamique) | Nombre minimum d'entrées | Nombre maximum d'entrées | Une erreur s'affiche si le nombre d'entrées est inférieur à `min`. Le bouton "Ajouter une entrée" est désactivé une fois la limite `max` atteinte. |

##### Exemple YAML :
```yaml
fields:
  - name: replica_count
    label: "Nombre d'instances"
    type: integer
    min: 1
    max: 5
    default: 3

  - name: environment_variables
    label: "Variables d'environnement"
    type: array
    itemType: object
    min: 2
    max: 4
    fields:
      - name: name
        type: string
        required: true
      - name: value
        type: string
        required: true
```

---

## ☸️ Déploiement Kubernetes

### Option 1 : Helm Chart (recommandé)

La configuration se définit sous la racine `app` dans le fichier `values.yaml` (ou via `--set app.configs[...]`).

#### Exemples de configurations (dans `values.yaml`)

**Mode Mono-Configuration (Inline par défaut) :**
```yaml
app:
  port: 3000
  configs:
    - id: default
      name: "Configuration principale"
      source: inline
      inline:
        schema: |
          title: "Mon Application"
          description: "Remplissez le formulaire pour générer votre configuration."
          fields:
            - name: app_name
              label: "Nom de l'application"
              type: string
              default: "my-app"
              required: true
```

**Mode Multi-Configurations (Inline + Git) :**
```yaml
app:
  port: 3000
  configs:
    - id: web-app
      name: "Frontend Config"
      source: inline
      inline:
        schema: |
          title: "Frontend Schema"
          fields:
            - name: front_port
              type: integer
              default: 80
    - id: db-app
      name: "Database (Git)"
      source: git
      git:
        repoUrl: "https://github.com/my-org/db-repo.git"
        branch: "main"
        configPath: "variables.tf"
        token: "ghp_xxxxxx"
```

**Mode Répertoire (scan de dossier monté) :**
```yaml
app:
  port: 3000
  configsDir: "/app/config"
# Vous pouvez alors monter votre ConfigMap/Secret contenant vos schémas dans /app/config.
```

#### Exemples de commandes d'installation

```bash
# Installer avec les valeurs par défaut (schéma exemple inline)
helm install my-form ./helm

# Mode répertoire — scanner un ConfigMap existant contenant plusieurs schémas
helm install my-form ./helm \
  --set app.configsDir="/app/config" \
  --set "extraVolumes[0].name=schemas-vol" \
  --set "extraVolumes[0].configMap.name=my-existing-schemas" \
  --set "extraVolumeMounts[0].name=schemas-vol" \
  --set "extraVolumeMounts[0].mountPath=/app/config"

# Avec Ingress
helm install my-form ./helm \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set "ingress.hosts[0].host=formatter.example.com" \
  --set "ingress.hosts[0].paths[0].path=/" \
  --set "ingress.hosts[0].paths[0].pathType=Prefix"
```

#### Paramètres Helm

| Paramètre | Description | Défaut |
|---|---|---|
| `replicaCount` | Nombre de réplicas | `1` |
| `image.repository` | Image Docker | `ghcr.io/ookami-git/formatter` |
| `image.tag` | Tag de l'image | `appVersion` du chart |
| `app.port` | Port d'écoute du serveur Node.js | `3000` |
| `app.configsDir` | Répertoire à scanner pour charger plusieurs configurations | `""` |
| `app.configs` | Liste des configurations gérées par l'application | (1 configuration inline par défaut) |
| `app.configs[].id` | ID unique de la configuration (utilisé dans l'URL) | `default` |
| `app.configs[].name` | Nom de la configuration affiché dans le sélecteur de l'interface | `Configuration principale` |
| `app.configs[].source` | Type de source : `inline` \| `configmap` \| `secret` \| `url` \| `git` | `inline` |
| `app.configs[].inline.schema` | Schéma YAML défini en ligne (si `source: inline`) | Schéma exemple |
| `app.configs[].configmap.name` | Nom du ConfigMap existant (si `source: configmap`) | `""` |
| `app.configs[].configmap.key` | Clé du fichier schéma dans le ConfigMap | `schema.yaml` |
| `app.configs[].secret.name` | Nom du Secret existant (si `source: secret`) | `""` |
| `app.configs[].secret.key` | Clé du fichier schéma dans le Secret | `schema.yaml` |
| `app.configs[].url.address` | URL HTTP/HTTPS du fichier de schéma (si `source: url`) | `""` |
| `app.configs[].url.ignoreSsl` | Ignorer la vérification SSL (si `source: url`) | `false` |
| `app.configs[].git.repoUrl` | URL du dépôt Git (si `source: git`) | `""` |
| `app.configs[].git.branch` | Branche Git à cloner | `main` |
| `app.configs[].git.configPath` | Chemin du fichier dans le dépôt Git | `variables.tf` |
| `app.configs[].git.token` | Token Git (crée un Secret automatiquement) | `""` |
| `app.configs[].git.existingTokenSecret` | Secret existant contenant `GIT_TOKEN` | `""` |
| `service.type` | Type de service K8s | `ClusterIP` |
| `service.port` | Port du service | `80` |
| `ingress.enabled` | Activer l'Ingress | `false` |
| `ingress.className` | Classe Ingress | `""` |
| `resources.limits.cpu` | Limite CPU | `200m` |
| `resources.limits.memory` | Limite mémoire | `256Mi` |

### Option 2 : Manifestes YAML bruts

Le fichier `k8s/deployment.yaml` contient un déploiement complet (ConfigMap + Deployment + Service) prêt à l'emploi :

```bash
kubectl apply -f k8s/deployment.yaml
```

Pour accéder au service :

```bash
# Port-forward local
kubectl port-forward svc/dynamic-form-service 3000:80

# Ou via NodePort
kubectl patch svc dynamic-form-service -p '{"spec":{"type":"NodePort"}}'
```

---

## 🔄 CI/CD — GitHub Actions

Le workflow `.github/workflows/docker-publish.yml` construit et pousse automatiquement l'image Docker :

| Événement | Tags générés |
|---|---|
| Push sur `main` | `latest`, `<sha>` |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `1`, `<sha>` |
| Pull Request | Build uniquement (pas de push) |

L'image est publiée sur **GitHub Container Registry** : `ghcr.io/<owner>/formatter`

### Première utilisation

Aucune configuration de secrets n'est nécessaire — le workflow utilise `GITHUB_TOKEN` qui est automatiquement fourni par GitHub Actions avec les permissions `packages: write`.

---

## 📁 Structure du projet

```
formatter/
├── .github/workflows/
│   └── docker-publish.yml    # CI/CD → build & push Docker
├── examples/                 # Schémas de configuration d'exemple
│   ├── schema.yaml
│   ├── multidoc-schema.yaml
│   └── variables.tf
├── helm/                     # Helm Chart Kubernetes
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── _helpers.tpl
│       ├── configmap.yaml
│       ├── deployment.yaml
│       ├── ingress.yaml
│       └── service.yaml
├── k8s/
│   └── deployment.yaml       # Manifestes K8s bruts (alternative à Helm)
├── lib/
│   └── parser.js             # Parseur Terraform HCL
├── public/                   # Frontend (Vanilla JS)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── lib/                  # Dépendances front (Prism.js, js-yaml)
├── server.js                 # Backend Express.js
├── Dockerfile
├── .dockerignore
└── package.json
```

---

## 📄 License

MIT
