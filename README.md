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
config:
  source: git
  git:
    repoUrl: "https://github.com/org/repo.git"
    token: "ghp_xxxxxxxxxxxx"          # → crée un Secret automatiquement
    # OU
    existingTokenSecret: "my-git-secret"  # → utilise un Secret existant (clé: GIT_TOKEN)
```

> **Note :** L'injection est automatique — GitHub reçoit `https://TOKEN@github.com/...`, GitLab reçoit `https://oauth2:TOKEN@gitlab.com/...`. Le token est masqué dans les logs serveur.

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
| `itemType` | `string` | Requis si `array` | Type des éléments du tableau (`string`, `integer`, `number`, `boolean`, `object`). |
| `fields` | `array` | Requis si `object` (ou `array` d'objets) | Liste récursive des sous-champs composant la structure imbriquée. |
| `dynamicKeys` | `boolean` | Optionnel | Si `true`, l'objet est rendu comme une carte dont les clés sont ajoutées à la volée. |
| `keyLabel` | `string` | Optionnel | Libellé du champ utilisé pour saisir la clé d'un objet dynamique. |
| `validation` | `object` | Optionnel | Règles de validation. Supporté pour les champs de type `string` (voir ci-dessous). |

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

## ☸️ Déploiement Kubernetes

### Option 1 : Helm Chart (recommandé)

La source de configuration se choisit via `config.source`. Chaque mode dispose de son propre bloc de configuration.

#### Modes disponibles

| Mode | Description | Configuration requise |
|---|---|---|
| `embedded` | Schéma exemple intégré dans l'image Docker | Aucune |
| `inline` | Schéma défini dans `values.yaml` | `config.inline.schema` |
| `configmap` | ConfigMap Kubernetes existant | `config.configmap.name` |
| `secret` | Secret Kubernetes existant | `config.secret.name` |
| `url` | URL HTTP/HTTPS d'un fichier de schéma | `config.url.address` |
| `git` | Dépôt Git (clone + rafraîchissement) | `config.git.*` |

#### Exemples

```bash
# Mode embedded — schéma d'exemple, aucune configuration
helm install my-form ./helm --set config.source=embedded

# Mode inline — schéma défini dans values.yaml (défaut)
helm install my-form ./helm

# Mode configmap — ConfigMap existant
helm install my-form ./helm \
  --set config.source=configmap \
  --set config.configmap.name=mon-configmap

# Mode secret — Secret existant
helm install my-form ./helm \
  --set config.source=secret \
  --set config.secret.name=mon-secret

# Mode url — schéma chargé depuis une URL
helm install my-form ./helm \
  --set config.source=url \
  --set config.url.address="https://raw.githubusercontent.com/org/repo/main/schema.yaml"

# Mode git — dépôt privé avec token
helm install my-form ./helm \
  --set config.source=git \
  --set config.git.repoUrl="https://github.com/org/repo.git" \
  --set config.git.token="ghp_xxxx" \
  --set config.git.configPath="infra/variables.tf"

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
| `config.source` | Source : `embedded` \| `inline` \| `configmap` \| `secret` \| `url` \| `git` | `inline` |
| `config.port` | Port du serveur | `3000` |
| `config.inline.schema` | Contenu YAML du schéma (mode `inline`) | Schéma exemple |
| `config.configmap.name` | Nom du ConfigMap existant (mode `configmap`) | `""` |
| `config.secret.name` | Nom du Secret existant (mode `secret`) | `""` |
| `config.url.address` | URL du schéma (mode `url`) | `""` |
| `config.url.ignoreSsl` | Ignorer la vérification SSL (mode `url`) | `false` |
| `config.git.repoUrl` | URL du repo Git (mode `git`) | `""` |
| `config.git.branch` | Branche Git | `main` |
| `config.git.configPath` | Fichier de config dans le repo | `variables.tf` |
| `config.git.token` | Token Git → Secret créé automatiquement | `""` |
| `config.git.existingTokenSecret` | Secret existant contenant `GIT_TOKEN` | `""` |
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
