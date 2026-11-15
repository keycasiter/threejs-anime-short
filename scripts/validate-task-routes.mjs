#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [taskSet, routeMap, routeMarkdown] = await Promise.all([
  readFile(path.join(root, 'evals/tasks.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'evals/task-routes.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'references/task-routes.md'), 'utf8')
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const routeSections = {
  environment: {heading: '## 环境场景', markers: ['**适用：**', '**流程：**', '**现有起点：**', '**失败回退：**', '**已知缺口：**', '**交接和首检：**'], requiredTerms: ['观察覆盖接力']},
  object: {heading: '## 物体展示', markers: ['**适用：**', '**流程：**', '**现有起点：**', '**失败回退：**', '**已知缺口：**', '**交接和首检：**'], requiredTerms: ['观察覆盖接力']},
  mechanism: {heading: '## 机制讲解', markers: ['**适用：**', '**流程：**', '**现有起点：**', '**失败回退：**', '**已知缺口：**', '**交接和首检：**'], requiredTerms: ['观察覆盖接力']},
  directorFilm: {heading: '## 导演短片', markers: ['**适用：**', '**流程：**', '**现有起点：**', '**失败回退：**', '**已知缺口：**', '**首检：**'], requiredTerms: ['renderAt', 'inspectFeatureVisibility']},
  interactive: {heading: '## 交互导览', markers: ['**适用：**', '**流程：**', '**现有起点：**', '**失败回退：**', '**已知缺口：**', '**交接和首检：**'], requiredTerms: ['观察覆盖接力']}
};

const expectedIds = taskSet.tasks.map(({id}) => id).sort();
const mappedIds = Object.keys(routeMap.routes).sort();
assert(expectedIds.join('|') === mappedIds.join('|'), `task/route ID mismatch; tasks=${expectedIds.join(',')} routes=${mappedIds.join(',')}`);

const supportedRoutes = new Set(Object.keys(routeSections));
const usedRoutes = new Set();
const observationProtocol = routeMarkdown.split('## 非影片场景的观察覆盖接力')[1]?.split('\n## ')[0] ?? '';
assert(observationProtocol, 'missing cross-route observation coverage protocol');
for (const term of ['auditObservationSet', 'selectObservationView', 'OrbitControls限位', '单次最多64个视图、32组特征', 'OrthographicCamera', '每帧循环']) {
  assert(observationProtocol.includes(term), `observation coverage protocol missing tool boundary: ${term}`);
}
for (const task of taskSet.tasks) {
  const mapping = routeMap.routes[task.id];
  assert(supportedRoutes.has(mapping.primary), `${task.id} has unknown primary route ${mapping.primary}`);
  usedRoutes.add(mapping.primary);
  const expectedLength = task.promptLength === 'short' ? 'S' : 'D';
  assert(task.id.endsWith(`-${expectedLength}`), `${task.id} suffix disagrees with promptLength=${task.promptLength}`);
  if (mapping.combinedResponsibilities) {
    assert(Array.isArray(mapping.combinedResponsibilities) && mapping.combinedResponsibilities.length > 0, `${task.id} has an empty combination`);
  }
}

for (const family of new Set(taskSet.tasks.map(({id}) => id.slice(0, id.lastIndexOf('-'))))) {
  const short = routeMap.routes[`${family}-S`];
  const detailed = routeMap.routes[`${family}-D`];
  assert(short && detailed, `${family} is missing its short/detailed pair`);
  assert(short.primary === detailed.primary, `${family} short/detailed prompts select different primary routes`);
}

for (const route of Object.keys(routeSections)) {
  assert(usedRoutes.has(route), `no task covers route ${route}`);
  const {heading, markers} = routeSections[route];
  const start = routeMarkdown.indexOf(heading);
  assert(start >= 0, `missing route section: ${heading}`);
  const next = routeMarkdown.indexOf('\n## ', start + heading.length);
  const section = routeMarkdown.slice(start, next < 0 ? undefined : next);
  for (const marker of markers) assert(section.includes(marker), `${heading} missing ${marker}`);
  for (const term of routeSections[route].requiredTerms ?? []) assert(section.includes(term), `${heading} missing required capability handoff: ${term}`);
}

console.log(`VALID: ${taskSet.tasks.length} tasks, ${usedRoutes.size} primary routes, short/detail pairs agree, route contracts complete.`);
console.log('LIMIT: static mapping and document completeness only; no model choice, implementation adherence, rendering, or visual quality is measured.');
