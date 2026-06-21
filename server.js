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

// Multi-configuration environment variables
const CONFIGS_JSON = process.env.CONFIGS_JSON;
const CONFIGS_FILE = process.env.CONFIGS_FILE;
const CONFIGS_DIR = process.env.CONFIGS_DIR;

function getConfigsList() {
  let list = [];

  // 1. Check CONFIGS_JSON
  if (CONFIGS_JSON) {
    try {
      const parsed = JSON.parse(CONFIGS_JSON);
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.configs)) {
          list = parsed.configs;
        } else {
          list = Object.entries(parsed).map(([id, conf]) => ({ id, ...conf }));
        }
      }
    } catch (e) {
      console.error('[MultiConfig] Failed to parse CONFIGS_JSON:', e.message);
    }
  }

  // 2. Check CONFIGS_FILE
  if (list.length === 0 && CONFIGS_FILE && fs.existsSync(CONFIGS_FILE)) {
    try {
      const fileContent = fs.readFileSync(CONFIGS_FILE, 'utf8');
      let parsed;
      if (CONFIGS_FILE.endsWith('.yaml') || CONFIGS_FILE.endsWith('.yml')) {
        parsed = yaml.load(fileContent);
      } else {
        parsed = JSON.parse(fileContent);
      }
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.configs)) {
          list = parsed.configs;
        } else {
          list = Object.entries(parsed).map(([id, conf]) => ({ id, ...conf }));
        }
      }
    } catch (e) {
      console.error('[MultiConfig] Failed to parse CONFIGS_FILE:', e.message);
    }
  }

  // 3. Check CONFIGS_DIR or directory fallback
  let dirToScan = CONFIGS_DIR;
  if (!list.length && !dirToScan && CONFIG_SOURCE === 'local' && CONFIG_PATH) {
    try {
      const stats = fs.statSync(CONFIG_PATH);
      if (stats.isDirectory()) {
        dirToScan = CONFIG_PATH;
      }
    } catch (e) {
      // Ignore
    }
  }

  if (!list.length && dirToScan && fs.existsSync(dirToScan)) {
    try {
      const files = fs.readdirSync(dirToScan);
      const supportedExtensions = ['.yaml', '.yml', '.json', '.tf'];
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          const id = path.basename(file, ext);
          list.push({
            id: id,
            name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            sourceType: 'local',
            localPath: path.join(dirToScan, file)
          });
        }
      }
    } catch (e) {
      console.error('[MultiConfig] Failed to scan CONFIGS_DIR:', e.message);
    }
  }

  // 4. Fallback to the single default config
  if (list.length === 0) {
    list.push({
      id: 'default',
      name: 'Configuration principale',
      sourceType: CONFIG_SOURCE,
      localPath: CONFIG_PATH,
      gitRepoUrl: GIT_REPO_URL_RAW,
      gitBranch: GIT_BRANCH,
      gitToken: GIT_TOKEN,
      gitConfigPath: GIT_CONFIG_PATH,
      url: URL_ADDRESS,
      urlIgnoreSsl: URL_IGNORE_SSL
    });
  }

  // Ensure each item has a unique id and name
  return list.map((item, index) => {
    const id = item.id || `config-${index}`;
    const name = item.name || id;
    return {
      ...item,
      id,
      name
    };
  });
}

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
    let token = (sourceType === 'default' && gitToken === undefined) ? GIT_TOKEN : gitToken;
    if (token && token.startsWith('$')) {
      token = process.env[token.substring(1)] || '';
    }
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

  let resolvedConfigPath = '';
  if (actualSourceType === 'git') {
    resolvedConfigPath = (sourceType === 'default' && !gitConfigPath) ? GIT_CONFIG_PATH : gitConfigPath;
  } else if (actualSourceType === 'local') {
    const pathVal = (sourceType === 'default' && !localPath) ? CONFIG_PATH : localPath;
    resolvedConfigPath = path.basename(pathVal);
  } else {
    resolvedConfigPath = 'values.yaml';
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
    configPath: resolvedConfigPath,
    loadedAt: new Date().toISOString()
  };
}

// Add JSON body parser middleware
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));

// Initial Sync at startup for all Git configurations
try {
  const configs = getConfigsList();
  configs.forEach(config => {
    if (config.sourceType === 'git' && config.gitRepoUrl) {
      const branch = config.gitBranch || 'main';
      let token = config.gitToken || '';
      if (token && token.startsWith('$')) {
        token = process.env[token.substring(1)] || '';
      }
      syncGitRepoDynamic(config.gitRepoUrl, branch, token, true)
        .then(() => console.log(`[Startup] Initial Git sync successful for config: ${config.id}`))
        .catch(err => console.warn(`[Startup Warning] Initial Git sync failed for config ${config.id}: ${err.message}`));
    }
  });
} catch (e) {
  console.warn('[Startup Warning] Failed to run initial Git sync:', e.message);
}

// Liveness/Readiness Probe for Kubernetes
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Endpoint to retrieve list of branches and tags (for Git source only)
app.get('/api/branches', async (req, res) => {
  const configId = req.query.config;
  const configs = getConfigsList();
  let selectedConfig = configs.find(c => c.id === configId);
  if (!selectedConfig) {
    selectedConfig = configs[0];
  }

  if (!selectedConfig || selectedConfig.sourceType !== 'git' || !selectedConfig.gitRepoUrl) {
    return res.status(400).json({ success: false, error: "La source de la configuration n'est pas configurée en mode Git." });
  }

  try {
    const repoUrl = selectedConfig.gitRepoUrl;
    let token = selectedConfig.gitToken || '';
    if (token && token.startsWith('$')) {
      token = process.env[token.substring(1)] || '';
    }
    
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

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const gitProxyOpt = proxy ? `-c http.proxy="${proxy}"` : '';

    console.log(`[Git] Listing remote branches and tags for ${maskGitUrl(repoUrl)}...`);
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

// Endpoint to load schema (GET)
app.get('/api/config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const forceRefresh = req.query.refresh === 'true';
  const branchParam = req.query.branch;
  const configId = req.query.config;

  try {
    const configs = getConfigsList();
    let selectedConfig = configs.find(c => c.id === configId);
    if (!selectedConfig) {
      if (configId) {
        return res.status(404).json({ success: false, error: `Configuration '${configId}' non trouvée.` });
      }
      selectedConfig = configs[0];
    }

    if (!selectedConfig) {
      throw new Error("Aucune configuration disponible.");
    }

    const result = await loadSchemaData({
      sourceType: selectedConfig.sourceType,
      localPath: selectedConfig.localPath,
      gitRepoUrl: selectedConfig.gitRepoUrl,
      gitBranch: branchParam || selectedConfig.gitBranch,
      gitToken: selectedConfig.gitToken,
      gitConfigPath: selectedConfig.gitConfigPath,
      url: selectedConfig.url,
      urlIgnoreSsl: selectedConfig.urlIgnoreSsl,
      refresh: forceRefresh
    });

    result.configId = selectedConfig.id;
    result.configsList = configs.map(c => ({ id: c.id, name: c.name, description: c.description }));

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
        networks: [
          "admin-net", "db-net", "web-net", "dmz-net",
          "monitoring-net", "backup-net", "vpn-net", "bi-net",
          "test-net", "staging-net", "prod-net", "security-net",
          "shared-net", "internal-net", "external-net"
        ]
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

// Ephemeral directory cleanup helper
function deleteFolderRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Cleanup] Failed to remove directory ${dirPath}:`, err.message);
    }
  }
}

// Endpoint to pull project config (POST)
app.post('/api/sync/pull', async (req, res) => {
  const { repoUrl, token, sourceBranch, targetPath } = req.body;
  if (!repoUrl || !sourceBranch || !targetPath) {
    return res.status(400).json({ success: false, error: 'Paramètres manquants : repoUrl, sourceBranch, et targetPath sont requis.' });
  }

  const pullId = crypto.randomBytes(16).toString('hex');
  const tempDir = path.join(__dirname, 'git-repos', `pull-${pullId}`);

  try {
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

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const gitProxyOpt = proxy ? `-c http.proxy="${proxy}"` : '';

    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`[Git Pull] Ephemeral clone of ${maskGitUrl(repoUrl)} on branch ${sourceBranch}...`);

    let cloneSuccess = false;
    try {
      execSync(`git ${gitProxyOpt} clone --single-branch --branch "${sourceBranch}" --depth 1 "${authRepoUrl}" "${tempDir}"`, { stdio: 'ignore' });
      cloneSuccess = true;
    } catch (cloneErr) {
      console.warn(`[Git Pull] Shallow clone failed, trying full clone: ${cloneErr.message}`);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        execSync(`git ${gitProxyOpt} clone "${authRepoUrl}" "${tempDir}"`, { stdio: 'ignore' });
        cloneSuccess = true;

        if (fs.existsSync(path.join(tempDir, '.git'))) {
          try {
            execSync(`git checkout "${sourceBranch}"`, { cwd: tempDir, stdio: 'ignore' });
          } catch (checkoutErr) {
            console.warn(`[Git Pull] Checkout of ${sourceBranch} failed: ${checkoutErr.message}`);
          }
        }
      } catch (fallbackErr) {
        throw new Error(`Échec du clonage du dépôt Git : ${fallbackErr.message}`);
      }
    }

    const cleanTargetPath = targetPath.replace(/^[\\/.]+/, '').replace(/\\/g, '/');
    const targetFullPath = path.join(tempDir, cleanTargetPath);
    const targetDirname = path.dirname(targetFullPath);
    const abstractFullPath = path.join(targetDirname, '.formatter-abstract-values.yml');

    let parsedData = null;
    let mode = 'classic';

    if (fs.existsSync(abstractFullPath)) {
      console.log(`[Git Pull] Abstract values file found at ${abstractFullPath}`);
      const fileContent = fs.readFileSync(abstractFullPath, 'utf8');
      try {
        parsedData = yaml.load(fileContent);
        mode = 'abstract';
      } catch (yamlErr) {
        throw new Error(`Erreur de parsing de .formatter-abstract-values.yml : ${yamlErr.message}`);
      }
    } else if (fs.existsSync(targetFullPath)) {
      console.log(`[Git Pull] Classic configuration file found at ${targetFullPath}`);
      const fileContent = fs.readFileSync(targetFullPath, 'utf8');
      try {
        const parsed = parseConfigContent(fileContent, targetFullPath);
        parsedData = parsed.data;
        mode = 'classic';
      } catch (parseErr) {
        throw new Error(`Erreur de parsing du fichier cible ${targetPath} : ${parseErr.message}`);
      }
    } else {
      console.log(`[Git Pull] Target path ${targetPath} does not exist in branch ${sourceBranch}`);
      return res.json({
        success: true,
        data: {},
        mode: 'none',
        message: `Le fichier cible n'existe pas encore dans la branche ${sourceBranch}. Le formulaire reste vide.`
      });
    }

    res.json({
      success: true,
      data: parsedData,
      mode: mode
    });

  } catch (error) {
    console.error(`[Git Pull] Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    deleteFolderRecursive(tempDir);
  }
});

// Endpoint to commit project config (POST)
app.post('/api/sync/commit', async (req, res) => {
  const { repoUrl, token, sourceBranch, destBranch, targetPath, content, abstractValues } = req.body;
  if (!repoUrl || !sourceBranch || !destBranch || !targetPath || content === undefined) {
    return res.status(400).json({ success: false, error: 'Paramètres manquants : repoUrl, sourceBranch, destBranch, targetPath, et content sont requis.' });
  }

  const commitId = crypto.randomBytes(16).toString('hex');
  const tempDir = path.join(__dirname, 'git-repos', `commit-${commitId}`);

  try {
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

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const gitProxyOpt = proxy ? `-c http.proxy="${proxy}"` : '';

    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`[Git Commit] Ephemeral clone of ${maskGitUrl(repoUrl)} on branch ${sourceBranch}...`);

    let clonedSuccessfully = false;
    let isRepoEmpty = false;
    try {
      execSync(`git ${gitProxyOpt} clone --single-branch --branch "${sourceBranch}" --depth 1 "${authRepoUrl}" "${tempDir}"`, { stdio: 'ignore' });
      clonedSuccessfully = true;
    } catch (cloneErr) {
      console.warn(`[Git Commit] Shallow clone of branch ${sourceBranch} failed, trying full clone: ${cloneErr.message}`);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        execSync(`git ${gitProxyOpt} clone "${authRepoUrl}" "${tempDir}"`, { stdio: 'ignore' });
        clonedSuccessfully = true;

        try {
          execSync(`git log -1`, { cwd: tempDir, stdio: 'ignore' });
        } catch (e) {
          isRepoEmpty = true;
        }
      } catch (fallbackErr) {
        throw new Error(`Échec du clonage du dépôt Git : ${fallbackErr.message}`);
      }
    }

    if (isRepoEmpty) {
      console.log(`[Git Commit] Repository is empty. Creating branch ${destBranch}...`);
      execSync(`git checkout -b "${destBranch}"`, { cwd: tempDir, stdio: 'ignore' });
    } else {
      if (destBranch !== sourceBranch) {
        console.log(`[Git Commit] Branching from ${sourceBranch} to ${destBranch}...`);
        try {
          execSync(`git checkout -b "${destBranch}"`, { cwd: tempDir, stdio: 'ignore' });
        } catch (branchErr) {
          console.warn(`[Git Commit] Branch ${destBranch} already exists locally, checking out and resetting: ${branchErr.message}`);
          execSync(`git checkout "${destBranch}"`, { cwd: tempDir, stdio: 'ignore' });
          execSync(`git reset --hard origin/${sourceBranch}`, { cwd: tempDir, stdio: 'ignore' });
        }
      } else {
        console.log(`[Git Commit] Staying on branch ${sourceBranch}...`);
      }
    }

    const cleanTargetPath = targetPath.replace(/^[\\/.]+/, '').replace(/\\/g, '/');
    const targetFullPath = path.join(tempDir, cleanTargetPath);
    const targetDirname = path.dirname(targetFullPath);
    fs.mkdirSync(targetDirname, { recursive: true });

    fs.writeFileSync(targetFullPath, content, 'utf8');
    console.log(`[Git Commit] Wrote target configuration file to ${targetFullPath}`);

    let filesToCommit = [cleanTargetPath];

    if (abstractValues && typeof abstractValues === 'object' && Object.keys(abstractValues).length > 0) {
      const abstractFullPath = path.join(targetDirname, '.formatter-abstract-values.yml');
      const abstractYaml = yaml.dump(abstractValues, { indent: 2 });
      fs.writeFileSync(abstractFullPath, abstractYaml, 'utf8');
      console.log(`[Git Commit] Wrote abstract values file to ${abstractFullPath}`);

      const relativeAbstractPath = path.relative(tempDir, abstractFullPath).replace(/\\/g, '/');
      filesToCommit.push(relativeAbstractPath);
    }

    execSync(`git config user.name "Form Generator"`, { cwd: tempDir, stdio: 'ignore' });
    execSync(`git config user.email "form-generator@local"`, { cwd: tempDir, stdio: 'ignore' });

    for (const file of filesToCommit) {
      execSync(`git add "${file}"`, { cwd: tempDir, stdio: 'ignore' });
    }

    let hasChanges = true;
    try {
      execSync(`git diff --cached --exit-code`, { cwd: tempDir, stdio: 'ignore' });
      hasChanges = false;
    } catch (diffErr) {
      hasChanges = true;
    }

    if (hasChanges) {
      execSync(`git commit -m "update: configuration updated via dynamic form"`, { cwd: tempDir, stdio: 'ignore' });
      console.log(`[Git Commit] Committed changes.`);
    } else {
      console.log(`[Git Commit] No changes detected. Pushing HEAD anyway.`);
    }

    let pushCmd = `git ${gitProxyOpt} push`;
    if (destBranch === 'feature/form-update') {
      pushCmd += ` --force origin "${destBranch}"`;
    } else {
      pushCmd += ` origin "${destBranch}"`;
    }

    if (isRepoEmpty) {
      pushCmd = `git ${gitProxyOpt} push -u origin "${destBranch}"`;
    }

    console.log(`[Git Commit] Pushing to branch ${destBranch}...`);
    execSync(pushCmd, { cwd: tempDir, stdio: 'ignore' });
    console.log(`[Git Commit] Push successful!`);

    let webUrl = repoUrl.replace(/(https?:\/\/)([^@]+@)?/, '$1').replace(/\.git$/, '');
    let mergeRequestUrl = '';
    let pushedDirectly = (destBranch === sourceBranch);

    if (!pushedDirectly) {
      if (webUrl.includes('gitlab')) {
        mergeRequestUrl = `${webUrl}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(destBranch)}&merge_request[target_branch]=${encodeURIComponent(sourceBranch)}`;
      } else if (webUrl.includes('github')) {
        mergeRequestUrl = `${webUrl}/compare/${encodeURIComponent(sourceBranch)}...${encodeURIComponent(destBranch)}?expand=1`;
      } else {
        mergeRequestUrl = webUrl;
      }
    } else {
      if (webUrl.includes('gitlab')) {
        mergeRequestUrl = `${webUrl}/-/tree/${encodeURIComponent(destBranch)}`;
      } else if (webUrl.includes('github')) {
        mergeRequestUrl = `${webUrl}/tree/${encodeURIComponent(destBranch)}`;
      } else {
        mergeRequestUrl = webUrl;
      }
    }

    res.json({
      success: true,
      pushedDirectly: pushedDirectly,
      destBranch: destBranch,
      mergeRequestUrl: mergeRequestUrl
    });

  } catch (error) {
    console.error(`[Git Commit] Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    deleteFolderRecursive(tempDir);
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
  try {
    const configs = getConfigsList();
    console.log(` Loaded ${configs.length} configuration(s):`);
    configs.forEach(config => {
      console.log(`  - [${config.id}] ${config.name} (${config.sourceType})`);
      if (config.sourceType === 'git') {
        console.log(`    Repo: ${maskGitUrl(config.gitRepoUrl)} (branch: ${config.gitBranch || 'main'})`);
      } else if (config.sourceType === 'url') {
        console.log(`    URL: ${config.url}`);
      } else {
        console.log(`    Path: ${config.localPath}`);
      }
    });
  } catch (e) {
    console.log(` Error listing configurations: ${e.message}`);
  }
  console.log(`===================================================`);
});
