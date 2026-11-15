#!/usr/bin/env node
import {cp, mkdtemp, readFile, readdir, rm, symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedRoot = process.env.THREE_ROOT ?? process.argv[2];
if (!requestedRoot) {
  console.error('Usage: THREE_ROOT=/absolute/path/to/node_modules/three node scripts/verify-example-suite.mjs');
  process.exit(2);
}

const threeRoot = path.resolve(requestedRoot);
let threePackage;
try { threePackage = JSON.parse(await readFile(path.join(threeRoot, 'package.json'), 'utf8')); }
catch (error) { console.error(`Cannot read Three.js package at ${threeRoot}: ${error.message}`); process.exit(2); }
if (threePackage.version !== '0.187.0') {
  console.error(`Expected three@0.187.0, received ${threePackage.version ?? 'unknown'}`);
  process.exit(2);
}

async function htmlFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await htmlFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(file);
  }
  return result.sort();
}

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(file));
    else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) result.push(file);
  }
  return result.sort();
}

const codeFiles = [...await sourceFiles(path.join(root, 'assets')),
  ...await sourceFiles(path.join(root, 'scripts'))];
const syntaxFailures = [];
for (const file of codeFiles) {
  const run = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  if (run.status !== 0) {
    syntaxFailures.push(file);
    console.error(`SYNTAX FAIL ${path.relative(root, file)}\n${run.stderr || run.stdout}`);
  }
}
if (!syntaxFailures.length) console.log(`PASS syntax: ${codeFiles.length} Skill JavaScript modules.`);

const stage = await mkdtemp(path.join(tmpdir(), 'threejs-example-suite-'));
try {
  await cp(path.join(root, 'assets'), path.join(stage, 'assets'), {recursive: true});
  const sharedVendor = path.join(stage, 'vendor');
  await symlink(threeRoot, sharedVendor, 'dir');
  const pages = await htmlFiles(path.join(stage, 'assets', 'examples'));
  for (const page of pages) {
    const pageVendor = path.join(path.dirname(page), 'vendor');
    await rm(pageVendor, {recursive: true, force: true});
    const target = path.relative(path.dirname(page), sharedVendor);
    await symlink(target, pageVendor, 'dir');
  }

  const verifier = path.join(root, 'scripts', 'validate_offline_html.mjs');
  const failures = [];
  for (const page of pages) {
    const run = spawnSync(process.execPath, [verifier, page, '--require-offline'], {encoding: 'utf8'});
    let report;
    try { report = JSON.parse(run.stdout); }
    catch { report = {errors: [run.stderr || run.stdout || 'validator produced no JSON']}; }
    if (run.status !== 0 || report.status !== 'PASS') {
      failures.push({page: path.relative(stage, page), errors: report.errors ?? []});
      console.error(`FAIL ${path.relative(stage, page)}`);
      for (const error of report.errors ?? []) console.error(`  ${error}`);
    } else {
      console.log(`PASS ${path.relative(stage, page)}: ${report.modulesChecked} modules, ${report.localFilesChecked} files`);
    }
  }
  console.log(`SUMMARY: ${pages.length-failures.length}/${pages.length} offline example entries passed with Three ${threePackage.version}.`);
  if (failures.length || syntaxFailures.length) process.exitCode = 1;
} finally {
  await rm(stage, {recursive: true, force: true});
}
