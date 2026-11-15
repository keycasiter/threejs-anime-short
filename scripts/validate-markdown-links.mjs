#!/usr/bin/env node
import {readdir, readFile, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.MARKDOWN_ROOT ?? defaultRoot);
const markdownFiles = [];
const anchorsByFile = new Map();

function headingSlug(value) {
  return value.replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function anchorsFor(file) {
  if (anchorsByFile.has(file)) return anchorsByFile.get(file);
  const text = await readFile(file, 'utf8');
  const anchors = new Set(text.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm));
  const result = new Set();
  const duplicates = new Map();
  for (const match of anchors) {
    const base = headingSlug(match[1]);
    const duplicateIndex = duplicates.get(base) ?? 0;
    duplicates.set(base, duplicateIndex + 1);
    result.add(duplicateIndex ? `${base}-${duplicateIndex}` : base);
  }
  for (const [, id] of text.matchAll(/(?:id|name)=["']([^"']+)["']/g)) result.add(id);
  anchorsByFile.set(file, result);
  return result;
}

async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    const relative = path.relative(root, file).split(path.sep);
    if (entry.name === '.git' || entry.name === '.superpowers' || entry.name === 'node_modules' ||
        relative[0] === 'evals' && relative[1] === 'baseline') continue;
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile() && entry.name.endsWith('.md')) markdownFiles.push(file);
  }
}

await walk(root);
const missing = [];
let linksChecked = 0;
let fragmentsChecked = 0;
for (const file of markdownFiles) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].split(/\s+"/)[0].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:)/i.test(raw)) continue;
    const [pathAndQuery, fragment] = raw.split('#', 2);
    const target = decodeURIComponent(pathAndQuery.split('?')[0]);
    const resolved = target ? path.resolve(path.dirname(file), target) : file;
    linksChecked++;
    let exists = true;
    try { await access(resolved); }
    catch { exists = false; missing.push(`${path.relative(root, file)}: ${raw}`); }
    if (exists && fragment && resolved.endsWith('.md')) {
      fragmentsChecked++;
      const expected = decodeURIComponent(fragment);
      const anchors = await anchorsFor(resolved);
      if (!anchors.has(expected)) missing.push(`${path.relative(root, file)}: ${raw} (missing heading anchor)`);
    }
  }
}

if (missing.length) {
  console.error(`BROKEN: ${missing.length} of ${linksChecked} local links / ${fragmentsChecked} Markdown fragments`);
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`VALID: ${linksChecked} local Markdown links and ${fragmentsChecked} heading anchors across ${markdownFiles.length} documents.`);
