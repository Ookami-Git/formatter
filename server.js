const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const parser = require('./lib/parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration sources (Server Defaults)
const CONFIG_SOURCE = process.env.CONFIG_SOURCE || 'local'; // 'local', 'git', or 'url'
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'examples', 'schema.yaml');

// Git settings (Server Defaults)
const GIT_REPO_URL_RAW = process.env.GIT_REPO_URL;
const GIT_TOKEN = process.env.GIT_TOKEN || '';
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';
const GIT_CONFIG_PATH = process.env.GIT_CONFIG_PATH || 'variables.tf';

// URL settings (Server Defaults)
const URL_ADDRESS = process.env.URL_ADDRESS || '';
const URL_IGNORE_SSL = process.env.URL_IGNORE_SSL === 'true';

// In-memory locks to serialize concurrent git syncs for the same repo+branch
const activeSyncs = new Map();

async function acquireLock(hash) {
  while (activeSyncs.has(hash)) {
    await activeSyncs.get(hash);
  }
  let resolveLock;
  const lockPromise = new Promise(resolve => {
    resolveLock = resolve;
  });
  activeSyncs.set(hash, lockPromise);
  return () => {
    activeSyncs.delete(hash);
    resolveLock();
  };
}

// Mask token in URLs for safe logging
function maskGitUrl(url) {
  if (!url) return '';
  return url.replace(/(https?:\/\/)([^@:]+)(:[^@]+)?@/, '$1***@');
}

// Concurrency-safe, parameterized Git sync function
async function syncGitRepoDynamic(repoUrl, branch, token, forceRefresh) {
  // Build authenticated repo URL
  let authRepoUrl = repoUrl;
  if (token) {
    const urlMatch = repoUrl.match(/^https?:\/\/([^@]+@)?(.+)$/);
    if (!urlMatch || !urlMatch[1]) {
      const isGitlab = repoUrl.includes('gitlab');
      const protocol = repoUrl.startsWith('https') ? 'https' : 'http';
      const hostAndPath = repoUrl.replace(/^https?:\/\//, '');
      if (isGitlab) {
        authRepoUrl = `${protocol}://oauth2:${token}@${hostAndPath}`;
      } else {
        authRepoUrl = `${protocol}://${token}@${hostAndPath}`;
      }
    }
  }

  // Create unique directory name from URL + Branch hash
  const dirHash = crypto.createHash('md5').update(`${repoUrl}#${branch}`).digest('hex');
  const targetDir = path.join(__dirname, 'git-repos', dirHash);
  
  // Acquire execution lock for this specific repository and branch
  const releaseLock = await acquireLock(dirHash);
  
  try {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const gitProxyOpt = proxy ? `-c http.proxy="${proxy}"` : '';

    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`[Git] Cloning repository ${maskGitUrl(repoUrl)} (branch: ${branch}) into ${targetDir}...`);
      execSync(`git ${gitProxyOpt} clone --single-branch --branch "${branch}" --depth 1 "${authRepoUrl}" "${targetDir}"`, { stdio: 'ignore' });
    } else if (forceRefresh) {
      console.log(`[Git] Pulling latest changes from branch ${branch} in ${targetDir}...`);
      execSync(`git ${gitProxyOpt} fetch origin "${branch}" && git ${gitProxyOpt} reset --hard FETCH_HEAD`, { cwd: targetDir, stdio: 'ignore' });
    }
    console.log(`[Git] Synchronization successful for directory: ${dirHash}`);
    return targetDir;
  } catch (error) {
    console.error(`[Git] Synchronization failed for ${maskGitUrl(repoUrl)}:`, error.message);
    throw error;
  } finally {
    releaseLock();
  }
}

// Fetch content from an HTTP/HTTPS URL with SSL bypass and proxy support
function fetchUrlContent(urlStr, ignoreSsl = false, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'ConfigFormGenerator/1.0',
        'Accept': 'text/plain, application/json, text/yaml, */*',
        ...customHeaders
      }
    };

    // Handle SSL ignore
    if (isHttps && ignoreSsl) {
      options.agent = new https.Agent({ rejectUnauthorized: false });
    }

    // Handle Proxying
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) {
      console.log(`[Proxy] Routing request to ${urlStr} through proxy: ${proxy}`);
      options.agent = new HttpsProxyAgent(proxy, {
        rejectUnauthorized: isHttps ? !ignoreSsl : undefined
      });
    }

    const req = httpModule.request(urlStr, options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Failed to load URL: HTTP status ${res.statusCode}`));
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function parseYamlDocs(fileContent) {
  const docsText = fileContent.split(/^---$/m);
  const parsedDocs = [];

  docsText.forEach((docText, index) => {
    const trimmed = docText.trim();
    if (!trimmed) return;

    try {
      const docData = yaml.load(trimmed);
      if (docData && typeof docData === 'object' && Object.keys(docData).length > 0) {
        // Extract tab name from first comment containing formatter_name:
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
    return { data: parsedDocs, isMultiDoc: true, format: 'yaml' };
  } else if (parsedDocs.length === 1) {
    return { data: parsedDocs[0].schema, isMultiDoc: false, format: 'yaml' };
  } else {
    return { data: {}, isMultiDoc: false, format: 'yaml' };
  }
}

function parseConfigContent(fileContent, filePathOrUrl) {
  const ext = path.extname(filePathOrUrl || '').toLowerCase().split('?')[0];

  if (ext === '.tf') {
    return { data: parser.parseTerraformVariables(fileContent), format: 'hcl', isMultiDoc: false };
  } else if (ext === '.yaml' || ext === '.yml') {
    return parseYamlDocs(fileContent);
  } else if (ext === '.json') {
    return { data: JSON.parse(fileContent), format: 'json', isMultiDoc: false };
  }

  // Fallback detection by content
  if (fileContent.includes('variable')) {
    return { data: parser.parseTerraformVariables(fileContent), format: 'hcl', isMultiDoc: false };
  } else {
    try {
      return { data: JSON.parse(fileContent), format: 'json', isMultiDoc: false };
    } catch {
      return parseYamlDocs(fileContent);
    }
  }
}

async function loadSchemaData({ sourceType, localPath, gitRepoUrl, gitBranch, gitToken, gitConfigPath, url, urlIgnoreSsl, refresh }) {
  let resolvedPath = '';
  let fileContent = '';
  let sourceLabel = '';
  let loadedGitBranch = undefined;
  let actualSourceType = sourceType;
  if (!actualSourceType || actualSourceType === 'default') {
    actualSourceType = CONFIG_SOURCE;
  }

  if (actualSourceType === 'git') {
    const repoUrl = (sourceType === 'default' && !gitRepoUrl) ? GIT_REPO_URL_RAW : gitRepoUrl;
    const branch = (sourceType === 'default' && !gitBranch) ? GIT_BRANCH : gitBranch;
    const token = (sourceType === 'default' && gitToken === undefined) ? GIT_TOKEN : gitToken;
    const configPath = (sourceType === 'default' && !gitConfigPath) ? GIT_CONFIG_PATH : gitConfigPath;

    if (!repoUrl) {
      throw new Error('URL du dépôt Git non spécifiée');
    }

    const targetDir = await syncGitRepoDynamic(repoUrl, branch, token, refresh);
    resolvedPath = path.join(targetDir, configPath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Fichier de configuration non trouvé dans le dépôt Git : ${configPath}`);
    }

    fileContent = fs.readFileSync(resolvedPath, 'utf8');
    sourceLabel = `${repoUrl} (${branch}) - ${configPath}`;
    loadedGitBranch = branch;
  } else if (actualSourceType === 'url') {
    const urlAddress = (sourceType === 'default' && !url) ? URL_ADDRESS : url;
    const ignoreSsl = (sourceType === 'default' && urlIgnoreSsl === undefined) ? URL_IGNORE_SSL : !!urlIgnoreSsl;

    if (!urlAddress) {
      throw new Error('URL du schéma non spécifiée');
    }

    fileContent = await fetchUrlContent(urlAddress, ignoreSsl);
    resolvedPath = urlAddress;
    sourceLabel = urlAddress;
  } else {
    // Local source
    const pathVal = (sourceType === 'default' && !localPath) ? CONFIG_PATH : localPath;
    resolvedPath = pathVal;
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(__dirname, resolvedPath);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Fichier de configuration local non trouvé : ${resolvedPath}`);
    }

    fileContent = fs.readFileSync(resolvedPath, 'utf8');
    sourceLabel = resolvedPath;
  }

  const { data, format, isMultiDoc } = parseConfigContent(fileContent, resolvedPath);

  return {
    success: true,
    isMultiDoc: isMultiDoc,
    data: data,
    source: sourceLabel,
    sourceType: actualSourceType,
    gitBranch: loadedGitBranch,
    format: format,
    loadedAt: new Date().toISOString()
  };
}

// Add JSON body parser middleware
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Initial Sync at startup if source is Git
if (CONFIG_SOURCE === 'git' && GIT_REPO_URL_RAW) {
  syncGitRepoDynamic(GIT_REPO_URL_RAW, GIT_BRANCH, GIT_TOKEN, true)
    .then(() => console.log('[Startup] Initial Git sync successful.'))
    .catch(err => console.warn(`[Startup Warning] Initial Git sync failed: ${err.message}`));
}

// Liveness/Readiness Probe for Kubernetes
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Endpoint to retrieve list of branches and tags (for Git source only)
app.get('/api/branches', async (req, res) => {
  if (CONFIG_SOURCE !== 'git' || !GIT_REPO_URL_RAW) {
    return res.status(400).json({ success: false, error: "La source de l'application n'est pas configurée en mode Git." });
  }

  try {
    // Build authenticated repo URL
    let authRepoUrl = GIT_REPO_URL_RAW;
    if (GIT_TOKEN) {
      const urlMatch = GIT_REPO_URL_RAW.match(/^https?:\/\/([^@]+@)?(.+)$/);
      if (!urlMatch || !urlMatch[1]) {
        const isGitlab = GIT_REPO_URL_RAW.includes('gitlab');
        const protocol = GIT_REPO_URL_RAW.startsWith('https') ? 'https' : 'http';
        const hostAndPath = GIT_REPO_URL_RAW.replace(/^https?:\/\//, '');
        if (isGitlab) {
          authRepoUrl = `${protocol}://oauth2:${GIT_TOKEN}@${hostAndPath}`;
        } else {
          authRepoUrl = `${protocol}://${GIT_TOKEN}@${hostAndPath}`;
        }
      }
    }

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const gitProxyOpt = proxy ? `-c http.proxy="${proxy}"` : '';

    console.log(`[Git] Listing remote branches and tags for ${maskGitUrl(GIT_REPO_URL_RAW)}...`);
    const output = execSync(`git ${gitProxyOpt} ls-remote --heads --tags "${authRepoUrl}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    
    const branches = [];
    const tags = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Ignore dereferenced annotated tags
      if (trimmed.endsWith('^{}')) continue;

      const headsMatch = trimmed.match(/[a-f0-9]+\s+refs\/heads\/(.+)$/);
      if (headsMatch && headsMatch[1]) {
        branches.push(headsMatch[1]);
        continue;
      }

      const tagsMatch = trimmed.match(/[a-f0-9]+\s+refs\/tags\/(.+)$/);
      if (tagsMatch && tagsMatch[1]) {
        tags.push(tagsMatch[1]);
      }
    }

    res.json({ success: true, branches: branches, tags: tags });
  } catch (error) {
    console.error('[Git] Failed to retrieve branches/tags:', error.message);
    res.status(500).json({ success: false, error: 'Impossible de récupérer la liste des branches et tags', details: error.message });
  }
});

// Endpoint to load default schema (GET)
app.get('/api/config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const forceRefresh = req.query.refresh === 'true';
  const branchParam = req.query.branch;

  try {
    const result = await loadSchemaData({
      sourceType: 'default',
      gitBranch: branchParam,
      refresh: forceRefresh
    });
    res.json(result);
  } catch (error) {
    console.error('Error loading configuration:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Utility helper to navigate objects using dot and bracket notation
function getValueByPath(obj, pathStr) {
  if (!pathStr) return obj;
  // Normalize brackets to dots, e.g., networks[0] -> networks.0
  const normalizedPath = pathStr.replace(/\[['"]?([^\]'"]+)['"]?\]/g, '.$1');
  const segments = normalizedPath.split('.').filter(Boolean);
  let current = obj;
  for (const segment of segments) {
    if (current && typeof current === 'object') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

// Endpoint to fetch dynamic options from URL (POST)
app.post('/api/options-url', async (req, res) => {
  const { url, ignoreSsl, auth, path: pathStr } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: "L'URL est requise." });
  }

  try {
    const customHeaders = {};

    // Handle authentication and secret resolution
    if (auth && typeof auth === 'object') {
      let resolvedToken = '';
      let resolvedUsername = '';
      let resolvedPassword = '';

      if (auth.type === 'bearer') {
        if (auth.tokenEnv && process.env[auth.tokenEnv]) {
          resolvedToken = process.env[auth.tokenEnv];
        } else if (auth.tokenFile && fs.existsSync(auth.tokenFile)) {
          resolvedToken = fs.readFileSync(auth.tokenFile, 'utf8').trim();
        } else {
          resolvedToken = auth.token || '';
        }

        if (resolvedToken) {
          customHeaders['Authorization'] = `Bearer ${resolvedToken}`;
        }
      } else if (auth.type === 'basic') {
        resolvedUsername = auth.username || '';
        if (auth.passwordEnv && process.env[auth.passwordEnv]) {
          resolvedPassword = process.env[auth.passwordEnv];
        } else if (auth.passwordFile && fs.existsSync(auth.passwordFile)) {
          resolvedPassword = fs.readFileSync(auth.passwordFile, 'utf8').trim();
        } else {
          resolvedPassword = auth.password || '';
        }

        const creds = `${resolvedUsername}:${resolvedPassword}`;
        const encoded = Buffer.from(creds).toString('base64');
        customHeaders['Authorization'] = `Basic ${encoded}`;
      }
    }

    // Fetch the URL content with bypass SSL and custom headers
    const rawData = await fetchUrlContent(url, !!ignoreSsl, customHeaders);

    // Try parsing as JSON first, and fallback to YAML
    let parsedData;
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      try {
        parsedData = yaml.load(rawData);
      } catch (err) {
        throw new Error("Impossible de parser le contenu renvoyé par l'URL (JSON ou YAML attendu).");
      }
    }

    // Resolve specific path if defined
    const resolvedVal = getValueByPath(parsedData, pathStr);

    // Format final choices to match optionsForm behavior
    let choices = [];
    if (resolvedVal !== undefined && resolvedVal !== null) {
      if (Array.isArray(resolvedVal)) {
        choices = resolvedVal.map(item => {
          if (item !== null && typeof item === 'object') {
            return {
              value: item.value !== undefined ? item.value : (item.key !== undefined ? item.key : item.name),
              label: item.label !== undefined ? item.label : (item.name !== undefined ? item.name : (item.value !== undefined ? item.value : item.key))
            };
          }
          return item;
        });
      } else if (typeof resolvedVal === 'object') {
        choices = Object.keys(resolvedVal);
      } else {
        choices = [String(resolvedVal)];
      }
    }

    res.json({ success: true, choices });
  } catch (error) {
    console.error(`[optionsUrl] Failed to load options from ${url}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mock endpoint for optionsUrl testing
app.get('/api/mock-options', (req, res) => {
  const authHeader = req.headers['authorization'];
  res.json({
    auth_received: authHeader || 'none',
    project: {
      all: {
        networks: ["admin-net", "db-net", "web-net", "dmz-net"]
      }
    },
    simple_list: ["dev", "staging", "prod"],
    key_value_object: {
      "zone-1a": "Europe West 1-A",
      "zone-1b": "Europe West 1-B",
      "zone-1c": "Europe West 1-C"
    }
  });
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
    console.log(` Git Repo: ${maskGitUrl(GIT_REPO_URL_RAW)}`);
    console.log(` Git Branch: ${GIT_BRANCH}`);
    console.log(` Git Config Path: ${GIT_CONFIG_PATH}`);
  } else {
    console.log(` Config Path: ${CONFIG_PATH}`);
  }
  console.log(`===================================================`);
});
