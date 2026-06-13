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
# Image depuis GitHub Container Registry
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
| `CONFIG_SOURCE` | Source de la configuration : `local` ou `git` | `local` | Non |
| `CONFIG_PATH` | Chemin du fichier de configuration (mode `local`) | `/app/config/schema.yaml` | Non |
| `GIT_REPO_URL` | URL du dépôt Git à cloner (sans token) | — | Oui si `git` |
| `GIT_TOKEN` | Token d'authentification Git (PAT GitHub/GitLab). Injecté automatiquement dans l'URL | — | Non (repos privés) |
| `GIT_BRANCH` | Branche Git à utiliser | `main` | Non |
| `GIT_CONFIG_PATH` | Chemin du fichier de config dans le dépôt Git | `variables.tf` | Non |

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
    existingSecret: "my-git-secret"    # → utilise un Secret existant (clé: GIT_TOKEN)
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
| `string` | Champ texte | — |
| `integer` / `number` | Champ numérique | Step=1 pour integer, step=any pour number |
| `boolean` | Toggle switch | — |
| `select` | Liste déroulante | Requiert `options` ou `validation` Terraform |
| `object` | Carte imbriquée | Sous-champs récursifs |
| `array` | Liste dynamique | Supporte `itemType` (string, object, etc.) |

---

## ☸️ Déploiement Kubernetes

### Option 1 : Helm Chart (recommandé)

```bash
# Installation avec les valeurs par défaut (mode local + ConfigMap embarqué)
helm install my-form ./helm

# Installation avec source Git
helm install my-form ./helm \
  --set config.source=git \
  --set config.git.repoUrl="https://TOKEN@github.com/org/repo.git" \
  --set config.git.configPath="infra/variables.tf"

# Installation avec Ingress
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
| `config.source` | Source : `local` ou `git` | `local` |
| `config.path` | Chemin de config (mode local) | `/app/config/schema.yaml` |
| `config.port` | Port du serveur | `3000` |
| `config.git.repoUrl` | URL du repo Git | `""` |
| `config.git.branch` | Branche Git | `main` |
| `config.git.configPath` | Fichier de config dans le repo | `variables.tf` |
| `configMapName` | Nom d'un ConfigMap existant (optionnel) | `""` |
| `schemaContent` | Contenu YAML du schéma (si pas de ConfigMap externe) | Schéma exemple |
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
├── config/                   # Schémas de configuration par défaut
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
