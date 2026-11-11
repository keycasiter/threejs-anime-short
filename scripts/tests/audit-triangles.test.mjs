import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTriangles } from '../../assets/geometry/audit-triangles.mjs';
const positions = [0,0,0, 0,0,1, 1,0,0];
test('heightfield orientation follows emitted indices, independent of vertex normals', () => {
  assert.equal(auditTriangles({positions,indices:[0,1,2],expectedDirection:[0,1,0]}).aligned,1);
  assert.equal(auditTriangles({positions,indices:[0,2,1],expectedDirection:[0,1,0]}).opposed,1);
});
test('degeneracy is invariant under uniform unit changes', () => {
  for (const scale of [1e-6,1,1e6]) {
    const p=[0,0,0, 1,0,0, 2,0,0].map(x=>x*scale);
    assert.equal(auditTriangles({positions:p}).degenerate,1);
    assert.equal(auditTriangles({positions:positions.map(x=>x*scale)}).valid,1);
  }
});
test('invalid indices and nonfinite vertices are reported', () => {
  assert.equal(auditTriangles({positions,indices:[0,1,99]}).invalid,1);
  assert.equal(auditTriangles({positions:[NaN,...positions.slice(1)]}).invalid,1);
});
test('collapsed ring includes degenerate faces; a pole fan does not', () => {
  const p=[0,1,0, 0,1,0, 1,0,0, 0,0,1];
  assert.equal(auditTriangles({positions:p,indices:[0,1,2,1,3,2]}).degenerate,1);
  assert.equal(auditTriangles({positions:p,indices:[0,3,2]}).degenerate,0);
});
test('closed surfaces can audit validity without an inappropriate global facing', () => {
  const result=auditTriangles({positions,indices:[0,1,2,0,2,1]});
  assert.equal(result.valid,2);assert.equal(result.opposed,0);
});
test('malformed layouts and zero expected vector are rejected', () => {
  assert.throws(()=>auditTriangles({positions:[0,0]}));
  assert.throws(()=>auditTriangles({positions,expectedDirection:[0,0,0]}));
});
