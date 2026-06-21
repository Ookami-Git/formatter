#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version || '')) {
  throw new Error(`Version SemVer invalide : ${version}`);
}

const root = path.resolve(__dirname, '..');
function writeJsonVersion(file) {
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  content.version = version;
  if (content.packages?.['']) content.packages[''].version = version;
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
}
writeJsonVersion(path.join(root, 'package.json'));
writeJsonVersion(path.join(root, 'package-lock.json'));

const chartFile = path.join(root, 'helm', 'Chart.yaml');
const chart = fs.readFileSync(chartFile, 'utf8')
  .replace(/^version:\s*.*$/m, `version: ${version}`)
  .replace(/^appVersion:\s*.*$/m, `appVersion: "${version}"`);
if (!/^version:\s*\S+/m.test(chart) || !/^appVersion:\s*"\S+"/m.test(chart)) {
  throw new Error('helm/Chart.yaml doit contenir version et appVersion.');
}
fs.writeFileSync(chartFile, chart);
