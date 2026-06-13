const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');
const parser = require('./lib/parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration sources
const CONFIG_SOURCE = process.env.CONFIG_SOURCE || 'local'; // 'local' or 'git'
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'examples', 'schema.yaml');

// Git settings
const GIT_REPO_URL_RAW = process.env.GIT_REPO_URL;
const GIT_TOKEN = process.env.GIT_TOKEN || '';
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';
const GIT_CONFIG_PATH = process.env.GIT_CONFIG_PATH || 'variables.tf';
const GIT_TEMP_DIR = path.join(__dirname, 'git-repo');

// Build authenticated Git URL if a token is provided separately
function buildGitUrl() {
  if (!GIT_REPO_URL_RAW) return null;
  if (!GIT_TOKEN) return GIT_REPO_URL_RAW;

  // If the URL already contains credentials, use it as-is
  const urlMatch = GIT_REPO_URL_RAW.match(/^https?:\/\/([^@]+@)?(.+)$/);
  if (urlMatch && urlMatch[1]) return GIT_REPO_URL_RAW;

  // Inject token: GitLab uses oauth2:TOKEN@, GitHub uses TOKEN@
  const isGitlab = GIT_REPO_URL_RAW.includes('gitlab');
  const protocol = GIT_REPO_URL_RAW.startsWith('https') ? 'https' : 'http';
  const hostAndPath = GIT_REPO_URL_RAW.replace(/^https?:\/\//, '');

  if (isGitlab) {
    return `${protocol}://oauth2:${GIT_TOKEN}@${hostAndPath}`;
  }
  return `${protocol}://${GIT_TOKEN}@${hostAndPath}`;
}

const GIT_REPO_URL = buildGitUrl();

// Mask token in URLs for safe logging
function sanitizeUrl(url) {
  if (!url) return '';
  return url.replace(/(https?:\/\/)(oauth2:)?[^@]+@/, '$1***@');
}

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Function to synchronize Git repository
function syncGitRepo() {
  if (CONFIG_SOURCE !== 'git' || !GIT_REPO_URL) return;

  try {
    if (!fs.existsSync(path.join(GIT_TEMP_DIR, '.git'))) {
      console.log(`[Git] Cloning repository ${sanitizeUrl(GIT_REPO_URL)} (branch: ${GIT_BRANCH}) into ${GIT_TEMP_DIR}...`);
      // Clone single branch and depth 1 for maximum speed
      execSync(`git clone --single-branch --branch ${GIT_BRANCH} --depth 1 "${GIT_REPO_URL}" "${GIT_TEMP_DIR}"`, { stdio: 'inherit' });
    } else {
      console.log(`[Git] Pulling latest changes from branch ${GIT_BRANCH}...`);
      // Fetch and reset to origin branch to avoid local drift issues
      execSync(`git fetch origin ${GIT_BRANCH} && git reset --hard origin/${GIT_BRANCH}`, { cwd: GIT_TEMP_DIR, stdio: 'inherit' });
    }
    console.log(`[Git] Synchronization successful.`);
  } catch (error) {
    console.error('[Git] Synchronization failed:', error.message);
    throw error;
  }
}

// Initial Sync at startup if source is Git
if (CONFIG_SOURCE === 'git') {
  try {
    syncGitRepo();
  } catch (err) {
    console.warn(`[Startup Warning] Initial Git sync failed. Will retry on client request.`);
  }
}

// Liveness/Readiness Probe for Kubernetes
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Endpoint to load schema dynamically
app.get('/api/config', (req, res) => {
  // Prevent browser caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const forceRefresh = req.query.refresh === 'true';

  try {
    // If Git is enabled and a refresh is requested, sync now
    if (CONFIG_SOURCE === 'git' && GIT_REPO_URL && forceRefresh) {
      syncGitRepo();
    }

    // Determine target config path
    const resolvedPath = CONFIG_SOURCE === 'git'
      ? path.join(GIT_TEMP_DIR, GIT_CONFIG_PATH)
      : CONFIG_PATH;

    if (!fs.existsSync(resolvedPath)) {
      console.error(`Config file not found at: ${resolvedPath}`);
      return res.status(404).json({
        error: 'Configuration file not found',
        source: CONFIG_SOURCE,
        path: resolvedPath
      });
    }

    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    const ext = path.extname(resolvedPath).toLowerCase();

    let configData;
    let formatDetected = 'yaml';
    let isMultiDoc = false;

    if (ext === '.tf') {
      configData = parser.parseTerraformVariables(fileContent);
      formatDetected = 'hcl';
    } else if (ext === '.yaml' || ext === '.yml') {
      formatDetected = 'yaml';
      const docsText = fileContent.split(/^---$/m);
      const parsedDocs = [];

      docsText.forEach((docText, index) => {
        const trimmed = docText.trim();
        if (!trimmed) return;

        try {
          const docData = yaml.load(trimmed);
          if (docData && typeof docData === 'object' && Object.keys(docData).length > 0) {
            // Extrait le nom d'onglet depuis le premier commentaire non vide s'il contient formatter_name:
            let tabName = `Configuration ${parsedDocs.length + 1}`;
            const lines = trimmed.split('\n');
            let firstNonEmptyLine = null;
            for (let line of lines) {
              const tLine = line.trim();
              if (tLine !== '') {
                firstNonEmptyLine = tLine;
                break;
              }
            }
            if (firstNonEmptyLine && firstNonEmptyLine.startsWith('#')) {
              const match = firstNonEmptyLine.match(/#\s*formatter_name:\s*(.+)/);
              if (match) {
                tabName = match[1].trim();
              }
            }
            parsedDocs.push({ tabName, schema: docData });
          }
        } catch (e) {
          console.warn(`[YAML] Failed to parse document index ${index}:`, e.message);
        }
      });

      if (parsedDocs.length > 1) {
        configData = parsedDocs;
        isMultiDoc = true;
      } else if (parsedDocs.length === 1) {
        configData = parsedDocs[0].schema;
      } else {
        configData = {};
      }
    } else if (ext === '.json') {
      configData = JSON.parse(fileContent);
      formatDetected = 'json';
    } else {
      if (fileContent.includes('variable')) {
        configData = parser.parseTerraformVariables(fileContent);
        formatDetected = 'hcl';
      } else {
        configData = yaml.load(fileContent);
        formatDetected = 'yaml';
      }
    }

    // Return configuration schema to frontend
    res.json({
      success: true,
      isMultiDoc: isMultiDoc,
      data: configData,
      source: resolvedPath,
      sourceType: CONFIG_SOURCE,
      format: formatDetected,
      loadedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error loading configuration:', error);
    res.status(500).json({
      error: 'Failed to parse configuration file',
      details: error.message
    });
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` Config Form Generator server started!`);
  console.log(` Port: ${PORT}`);
  console.log(` Source Mode: ${CONFIG_SOURCE}`);
  if (CONFIG_SOURCE === 'git') {
    console.log(` Git Repo: ${sanitizeUrl(GIT_REPO_URL)}`);
    console.log(` Git Branch: ${GIT_BRANCH}`);
    console.log(` Git Config Path: ${GIT_CONFIG_PATH}`);
  } else {
    console.log(` Config Path: ${CONFIG_PATH}`);
  }
  console.log(`===================================================`);
});
