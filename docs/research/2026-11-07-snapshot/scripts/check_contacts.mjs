#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const [file, ...extra] = process.argv.slice(2);
try {
  if (!file || extra.length) throw new Error('Usage: node check_contacts.mjs contacts.json');
  const samples = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(samples) || !samples.length) throw new Error('Input must be a non-empty array');
  const seen = new Set();
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const results = samples.map((s, i) => {
    if (!s || typeof s.id !== 'string' || !s.id.trim() || !finite(s.time) || s.time < 0) throw new Error(`Sample ${i}: invalid id/time`);
    const key = JSON.stringify([s.id, s.time]);
    if (seen.has(key)) throw new Error(`Sample ${i}: duplicate id/time`); seen.add(key);
    for (const name of ['pointA', 'pointB']) if (!Array.isArray(s[name]) || s[name].length !== 3 || !s[name].every(finite)) throw new Error(`${s.id}: invalid ${name}`);
    const radiusA = s.radiusA ?? 0, radiusB = s.radiusB ?? 0, tolerance = s.tolerance;
    if (![radiusA, radiusB, tolerance].every(x => finite(x) && x >= 0)) throw new Error(`${s.id}: radii/tolerance must be finite and nonnegative`);
    const distance = Math.hypot(...s.pointA.map((n, j) => n - s.pointB[j]));
    const surfaceGap = distance - radiusA - radiusB;
    return { id: s.id, time: s.time, distance, surfaceGap, tolerance, status: surfaceGap <= tolerance ? 'PASS' : 'FAIL' };
  });
  const failures = results.filter(r => r.status === 'FAIL').length;
  console.log(JSON.stringify({ status: failures ? 'FAIL' : 'PASS', failures, results }, null, 2));
  process.exitCode = failures ? 1 : 0;
} catch (e) {
  console.error(JSON.stringify({ status: 'ERROR', message: e.message })); process.exitCode = 2;
}
