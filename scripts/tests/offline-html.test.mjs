import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../validate_offline_html.mjs', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'offline-html-test-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  return root;
}

async function run(root) {
  return spawnSync(process.execPath, [script, join(root, 'index.html'), '--require-offline'], {encoding:'utf8'});
}

test('offline validation recursively catches a missing Three.js sidecar import', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'src'), {recursive:true});
  await mkdir(join(root, 'vendor'), {recursive:true});
  await writeFile(join(root, 'index.html'), '<script type="module">import "./src/scene.js";</script>');
  await writeFile(join(root, 'src/scene.js'), 'import "../vendor/three.module.js";');
  await writeFile(join(root, 'vendor/three.module.js'), 'import "./three.core.js";');
  let result = await run(root);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Missing local module: .*three\.core\.js/);

  await writeFile(join(root, 'vendor/three.core.js'), 'export const REVISION = "180";');
  result = await run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"status": "PASS"/);
});

test('offline validation follows local import-map targets and checks local assets', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'vendor'), {recursive:true});
  await writeFile(join(root, 'index.html'), '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script><script type="module">import * as THREE from "three";</script><img src="./preview.png">');
  await writeFile(join(root, 'vendor/three.module.js'), 'export const REVISION = "180";');
  await writeFile(join(root, 'preview.png'), 'image');
  const result = await run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"status": "PASS"/);
});

test('offline validation allows embedded data URIs in local JSON assets', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'assets'), {recursive:true});
  await writeFile(join(root, 'index.html'), '<script type="module">void 0;</script><link rel="preload" href="./assets/model.gltf">');
  await writeFile(join(root, 'assets/model.gltf'), JSON.stringify({buffers:[{uri:'data:application/octet-stream;base64,AA=='}]}));
  const result = await run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"status": "PASS"/);
});

test('offline validation rejects remote transitive dependencies and missing HTML resources', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'index.html'), '<script type="module">import "https://cdn.example/three.js";</script><img src="./missing.png">');
  const result = await run(root);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /non-local dependency https:\/\/cdn\.example\/three\.js/);
  assert.match(result.stdout, /missing local file .*missing\.png/);
});

test('offline validation rejects the unresolved __BUNDLE__ replacement token', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'index.html'), '<script>__BUNDLE__</script>');
  const result = await run(root);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Unfilled bundle\/style placeholder found/);
});
