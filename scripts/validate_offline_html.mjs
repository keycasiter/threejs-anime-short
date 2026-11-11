#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';

const [argument, ...flags] = process.argv.slice(2);
if (!argument || flags.some(x => x !== '--require-offline')) {
  console.error('Usage: node validate_offline_html.mjs file.html [--require-offline]');
  process.exit(2);
}

const offline = flags.includes('--require-offline');
const htmlPath = resolve(argument);
const remoteDependencies = new Set();
const localDependencies = new Set();
const localReferences = [];
const errors = [];
const visited = new Set();
let importMap = {};
let executableScripts = 0;
let checkedInlineModules = 0;

function attribute(attrs, name) {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

function rememberReference(value, baseFile, owner) {
  if (!value) return;
  const reference = value.trim();
  if (!reference || /^(?:data:|blob:|#|javascript:)/i.test(reference)) return;
  if (/^(?:https?:)?\/\//i.test(reference) || /^[a-z][a-z\d+.-]*:/i.test(reference)) {
    remoteDependencies.add(reference);
    if (offline) errors.push(`${owner}: non-local dependency ${reference}`);
    return;
  }
  localReferences.push({reference, baseFile, owner});
}

function mapBareSpecifier(specifier) {
  const direct = importMap[specifier];
  if (typeof direct === 'string') return direct;
  const prefix = Object.keys(importMap).filter(key => key.endsWith('/') && specifier.startsWith(key)).sort((a,b) => b.length-a.length)[0];
  if (prefix && typeof importMap[prefix] === 'string') return importMap[prefix] + specifier.slice(prefix.length);
  return null;
}

function resolveLocalReference(reference, baseFile, owner) {
  if (/^(?:data:|blob:|#)/i.test(reference)) return null;
  if (/^(?:https?:)?\/\//i.test(reference) || /^[a-z][a-z\d+.-]*:/i.test(reference)) {
    remoteDependencies.add(reference);
    if (offline) errors.push(`${owner}: non-local dependency ${reference}`);
    return null;
  }
  let mapped = reference;
  let resolutionBase = baseFile;
  if (!reference.startsWith('.') && !reference.startsWith('/') && !reference.startsWith('?')) {
    mapped = mapBareSpecifier(reference, baseFile);
    if (!mapped) {
      errors.push(`${owner}: bare module specifier cannot be verified offline: ${reference}`);
      return null;
    }
    // Import-map addresses are relative to the importing HTML's document base,
    // not the directory of the JS module that happened to use the bare name.
    resolutionBase = htmlPath;
  }
  if (/^(?:https?:)?\/\//i.test(mapped) || /^[a-z][a-z\d+.-]*:/i.test(mapped)) {
    if (offline) errors.push(`${owner}: import map resolves to non-local dependency ${mapped}`);
    remoteDependencies.add(mapped);
    return null;
  }
  if (mapped.startsWith('/')) {
    errors.push(`${owner}: root-relative resource is not portable in an offline package: ${mapped}`);
    return null;
  }
  const pathPart = decodeURIComponent(mapped.split(/[?#]/, 1)[0]);
  const path = pathPart ? resolve(dirname(resolutionBase), pathPart) : resolutionBase;
  localDependencies.add(path);
  return path;
}

function extractJsReferences(source) {
  const found = new Set();
  const patterns = [
    /\bimport\s+(?:[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimportScripts\s*\(\s*['"]([^'"]+)['"]/g,
    /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

function extractCssReferences(source) {
  const found = new Set();
  for (const match of source.matchAll(/@import\s+(?:url\()?\s*['"]?([^'"\s)]+)['"]?\s*\)?/gi)) found.add(match[1]);
  for (const match of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) found.add(match[2]);
  return [...found];
}

async function scanModule(path, chain = []) {
  const normalized = resolve(path);
  if (visited.has(normalized)) return;
  visited.add(normalized);
  let source;
  try { source = await readFile(normalized, 'utf8'); }
  catch { errors.push(`Missing local module: ${normalized} (import chain: ${[...chain, normalized].join(' -> ')})`); return; }
  for (const reference of extractJsReferences(source)) {
    const next = resolveLocalReference(reference, normalized, 'module import');
    if (next) {
      if (/\.(?:m?js|cjs)$/i.test(next)) await scanModule(next, [...chain, normalized]);
      else await verifyLocalFile(next, 'module resource');
    }
  }
}

async function verifyLocalFile(path, owner) {
  let info;
  try { info = await stat(path); }
  catch { errors.push(`${owner}: missing local file ${path}`); return; }
  if (!info.isFile()) { errors.push(`${owner}: local resource is not a file ${path}`); return; }
  const extension = extname(path).toLowerCase();
  if (extension === '.css') {
    const source = await readFile(path, 'utf8');
    for (const reference of extractCssReferences(source)) {
      const next = resolveLocalReference(reference, path, 'CSS resource');
      if (next) {
        await verifyLocalFile(next, 'CSS resource');
      }
    }
  } else if (extension === '.json') {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      for (const uri of collectUris(value)) {
        const next = resolveLocalReference(uri, path, 'JSON asset URI');
        if (next) {
          await verifyLocalFile(next, 'JSON asset URI');
        }
      }
    } catch (error) {
      errors.push(`Invalid JSON dependency ${path}: ${error.message}`);
    }
  }
}

function collectUris(value, found = []) {
  if (Array.isArray(value)) for (const item of value) collectUris(item, found);
  else if (value && typeof value === 'object') {
    if (typeof value.uri === 'string') found.push(value.uri);
    for (const [key, item] of Object.entries(value)) if (key !== 'uri') collectUris(item, found);
  }
  return found;
}

try {
  const html = await readFile(htmlPath, 'utf8');
  if (/<!--\s*(?:INLINE_SCRIPT|INLINE_STYLES|BUNDLE|BUNDLE_SLOT)\s*-->|\/\*\s*(?:BUNDLE|BUNDLE_SLOT)\s*\*\//i.test(html)) errors.push('Unfilled bundle/style placeholder found');
  if (/\b__(?:INLINE_SCRIPT|INLINE_STYLES|BUNDLE|BUNDLE_SLOT)__\b/i.test(html)) errors.push('Unfilled bundle/style placeholder found');

  const importMapBlocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attrs]) => (attribute(attrs, 'type') ?? '').trim().toLowerCase() === 'importmap');
  for (const [, , text] of importMapBlocks) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.imports && typeof parsed.imports === 'object') importMap = {...importMap, ...parsed.imports};
    } catch (error) { errors.push(`Invalid import map: ${error.message}`); }
  }

  const inlineModules = [];
  for (const [, attrs, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const type = (attribute(attrs, 'type') ?? '').trim().toLowerCase();
    if (type === 'importmap') continue;
    if (type && !['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) continue;
    executableScripts++;
    const src = attribute(attrs, 'src');
    if (src) {
      rememberReference(src, htmlPath, 'script src');
      if (offline && !/^(?:https?:)?\/\//i.test(src)) {
        const path = resolveLocalReference(src, htmlPath, 'script src');
        if (path) {
          await verifyLocalFile(path, 'script src');
          if (type === 'module' || /\.m?js(?:[?#]|$)/i.test(src)) await scanModule(path);
        }
      }
    } else if (type === 'module') inlineModules.push(code);
    else {
      try { new Script(code, {filename: `${htmlPath}:inline-${executableScripts}`}); }
      catch (error) { errors.push(`Inline script ${executableScripts}: ${error.message}`); }
    }
  }
  if (!executableScripts) errors.push('No executable script found');

  if (offline) for (let index = 0; index < inlineModules.length; index++) {
    checkedInlineModules++;
    const source = inlineModules[index];
    const temp = resolve(tmpdir(), `offline-html-check-${process.pid}-${index}.mjs`);
    const {writeFile, unlink} = await import('node:fs/promises');
    try {
      await writeFile(temp, source, 'utf8');
      const checked = spawnSync(process.execPath, ['--check', temp], {encoding: 'utf8'});
      if (checked.error) throw checked.error;
      if (checked.status !== 0) errors.push(`Inline module ${index + 1}: ${checked.stderr.trim()}`);
    } finally { await unlink(temp).catch(() => {}); }
    for (const reference of extractJsReferences(source)) {
      const next = resolveLocalReference(reference, htmlPath, 'inline module import');
      if (next) {
        if (/\.(?:m?js|cjs)$/i.test(next)) await scanModule(next);
        else await verifyLocalFile(next, 'inline module resource');
      }
    }
  }

  for (const [, tag, attrs] of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const name = tag.toLowerCase();
    for (const attr of ['src', 'poster']) {
      const value = attribute(attrs, attr);
      if (value && !/^script$/i.test(name)) rememberReference(value, htmlPath, `${name} ${attr}`);
    }
    if (name === 'link') {
      const href = attribute(attrs, 'href');
      if (href) rememberReference(href, htmlPath, 'link href');
    }
    const srcset = attribute(attrs, 'srcset');
    if (srcset) for (const candidate of srcset.split(',')) rememberReference(candidate.trim().split(/\s+/)[0], htmlPath, `${name} srcset`);
    const style = attribute(attrs, 'style');
    if (style) for (const reference of extractCssReferences(style)) rememberReference(reference, htmlPath, `${name} inline style`);
  }
  for (const [, code] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    for (const reference of extractCssReferences(code)) rememberReference(reference, htmlPath, 'inline CSS');
  }
  for (const reference of localReferences.slice()) {
    if (reference.reference.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(reference.reference)) continue;
    const path = resolveLocalReference(reference.reference, reference.baseFile, reference.owner);
    if (path) await verifyLocalFile(path, reference.owner);
  }

  console.log(JSON.stringify({
    status: errors.length ? 'FAIL' : 'PASS', file: htmlPath, executableScripts,
    checkedInlineModules, modulesChecked: visited.size,
    localFilesChecked: localDependencies.size, localDependencies: [...localDependencies],
    remoteDependencies: [...remoteDependencies], errors
  }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({status: 'ERROR', message: error.message}, null, 2));
  process.exitCode = 2;
}
