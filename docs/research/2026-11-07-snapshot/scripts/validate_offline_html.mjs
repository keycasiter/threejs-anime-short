#!/usr/bin/env node
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [file, ...flags] = process.argv.slice(2);
if (!file || flags.some(x => x !== '--require-offline')) {
  console.error('Usage: node validate_offline_html.mjs file.html [--require-offline]');
  process.exitCode = 2;
} else {
  let temp;
  try {
    const html = await readFile(file, 'utf8');
    const errors = [], dependencies = new Set(), modules = [];
    const attribute = (attrs, name) => {
      const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return match ? match[1] ?? match[2] ?? match[3] : null;
    };
    const resource = value => {
      if (value && !/^(?:data:|blob:|#)/i.test(value.trim())) dependencies.add(value.trim());
    };
    if (/<!--\s*(?:INLINE_SCRIPT|INLINE_STYLES|BUNDLE|BUNDLE_SLOT)\s*-->|\/\*\s*(?:BUNDLE|BUNDLE_SLOT)\s*\*\//i.test(html)) errors.push('Unfilled bundle/style placeholder found');
    let scripts = 0;
    const markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs, code) => {
      const type = (attribute(attrs, 'type') ?? '').trim().toLowerCase();
      const src = attribute(attrs, 'src'); resource(src);
      if (type && !['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) return '';
      scripts++;
      if (src) return `<script ${attrs}></script>`;
      if (type === 'module') {
        // Collected below so all file access remains asynchronous.
        modules.push({ index: scripts, code });
      } else {
        try { new Script(code, { filename: `${file}:script-${scripts}` }); }
        catch (e) { errors.push(`Script ${scripts}: ${e.message}`); }
      }
      return `<script ${attrs}></script>`;
    });
    if (!scripts) errors.push('No executable script found');
    if (modules.length) {
      temp = await mkdtemp(join(tmpdir(), 'film-html-check-'));
      for (const { index, code } of modules) {
        const path = join(temp, `script-${index}.mjs`); await writeFile(path, code);
        const checked = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
        if (checked.error) throw checked.error;
        if (checked.status !== 0) errors.push(`Module ${index}: ${checked.stderr.trim()}`);
      }
    }
    for (const [, tag, attrs] of markup.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
      resource(attribute(attrs, 'src')); resource(attribute(attrs, 'poster'));
      if (tag.toLowerCase() === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(attribute(attrs, 'rel') ?? '')) resource(attribute(attrs, 'href'));
    }
    for (const [, , url] of markup.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) resource(url);
    if (flags.includes('--require-offline') && dependencies.size) errors.push('Static external resources found');
    console.log(JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', file, scripts, dependencies: [...dependencies], errors }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (e) {
    console.error(JSON.stringify({ status: 'ERROR', message: e.message })); process.exitCode = 2;
  } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
}
