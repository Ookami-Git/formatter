# Règles de développement & Contexte de l'application (formatter)

Vous êtes un assistant de codage IA expert et vous travaillez sur le projet **Dynamic Form Formatter** (formatter).
Vous devez impérativement lire et suivre ces consignes pour toute modification ou ajout dans cette base de code.

## 📌 Architecture de l'Application

Ce projet est un générateur de formulaire dynamique Single Page Application (SPA) développé en Node.js (Express) pour le backend et en HTML/CSS/JS vanille pour le frontend. Il génère du JSON, YAML ou HCL/tfvars à partir de schémas.

### Structure des dossiers et fichiers clés :
- **Backend / Serveur :**
  - `./server.js` : Point d'entrée de l'application Express. Gère le serveur HTTP, les routes d'API, le clonage/mise à jour dynamique des dépôts Git contenant les schémas, le proxying/cache des URLs externes pour les options dynamiques, et le healthcheck (`/healthz`).
  - `./lib/parser.js` : Parseur principal. Lit les schémas d'entrée (YAML, JSON ou Terraform HCL `.tf`) et les convertit en une structure unifiée de champs pour le formulaire.
- **Frontend / Client :**
  - `./public/index.html` : Structure HTML de l'application (SPA).
  - `./public/style.css` : Styles CSS vanille. Interface moderne, lisible, épurée et responsive (inspirée du design de Chrome/Edge/Discord/Spotify).
  - `./public/app.js` : Logique principale du client (rendu dynamique du formulaire, validation des champs, gestion des onglets multi-documents, requêtes pour `optionsUrl`, gestion des conditions de visibilité).
  - `./public/lib/transform-engine.js` : Moteur d'évaluation récursif pour la couche d'abstraction (`outputTemplate`). Gère les interpolations de variables `${expression}`, les conditions `$if`, et les boucles `$repeat`.
- **Déploiement et CI/CD :**
  - `./Dockerfile` : Configuration de l'image Docker multi-stage basée sur Node.js 20-alpine.
  - `./helm/` : Chart Helm pour déploiement Kubernetes.
  - `./k8s/deployment.yaml` : Manifestes Kubernetes bruts.
  - `./.github/workflows/docker-publish.yml` : Workflow CI/CD de build et push sur GitHub Container Registry (GHCR).

## 🛠️ Consignes de Développement & Règles strictes

1. **Gestion des dépendances frontend & Autonomie (Air-gapped) :**
   - L'application est écrite en HTML/JS vanille et ne possède pas d'étape de compilation/build (Vite/Webpack/Babel). Il est interdit d'introduire des frameworks ou outils nécessitant un build sans accord.
   - Si une fonctionnalité nécessite l'ajout d'une bibliothèque tierce, **les fichiers sources (.js, .css) doivent être téléchargés localement et placés dans `./public/lib/`**.
   - Il est **strictement interdit de charger des scripts ou styles depuis des serveurs externes (CDN, unpkg, etc.)** au moment de l'exécution (contrainte d'environnement isolé/offline).
2. **Sécurité Git & Credentials :**
   - L'application ne doit JAMAIS persister ou stocker de tokens, mots de passe ou URLs de dépôts privés sur le serveur ou dans les configurations locales. Tout doit être saisi en live par l'utilisateur et transiter de manière éphémère dans les requêtes API.
3. **Documentation & Synchronisation :**
   - **Règle absolue :** À chaque modification, correction ou ajout de fonctionnalité, vous devez **mettre à jour** le fichier `./README.md` pour y documenter le changement (nouvelles variables d'environnement, annotations, etc.).
4. **Qualité et Rétrocompatibilité :**
   - Préservez le support des formats existants (JSON, YAML, Terraform HCL).
   - Veillez à ce que le moteur de transformation (`transform-engine.js`) conserve les types de données natifs (nombres, booléens) lors de l'évaluation des expressions.

## 🤖 Consignes pour l'IA (Prompting optimisé)

- **Analyse préalable :** Avant d'émettre du code, lisez les fichiers impactés en entier.
- **Réponses concises :** Pas de blabla inutile, concentrez-vous sur le code robuste.
- **Langue :** Répondez toujours en français.