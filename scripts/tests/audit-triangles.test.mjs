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
test('curved outward directions accept a tetrahedron and detect a flipped face', () => {
  const p = [1,1,1, -1,-1,1, -1,1,-1, 1,-1,-1];
  const outward = [0,2,1, 0,1,3, 0,3,2, 1,2,3];
  assert.equal(auditTriangles({positions:p,indices:outward,expectedDirections:p}).aligned,4);
  const reversed = [...outward.slice(0,9),1,3,2];
  const result = auditTriangles({positions:p,indices:reversed,expectedDirections:p});
  assert.equal(result.aligned,3);assert.equal(result.opposed,1);
});
test('a short wide bent patch can invert despite finite nondegenerate triangles', () => {
  function patch(turn) {
    const positions=[],refs=[],indices=[],rings=24,segments=48,radius=2;
    for(let i=0;i<=rings;i++)for(let j=0;j<segments;j++){
      const x=i/rings,t=turn*x,a=j/segments*Math.PI*2,cy=Math.cos(a),sz=Math.sin(a);
      positions.push(x-radius*Math.sin(t)*cy,radius*Math.cos(t)*cy,radius*sz);
      refs.push(-Math.sin(t)*cy,Math.cos(t)*cy,sz);
    }
    for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
      const a=i*segments+j,b=i*segments+(j+1)%segments,c=a+segments,d=b+segments;
      indices.push(a,b,c,b,d,c);
    }
    return {positions,indices,expectedDirections:refs};
  }
  assert.equal(auditTriangles(patch(0)).opposed,0);
  const result=auditTriangles(patch(.9));
  assert.equal(result.invalid,0);assert.equal(result.degenerate,0);assert(result.opposed>0);
});
test('per-vertex references support typed arrays and ignore unused vertices', () => {
  const p=new Float32Array([...positions,9,9,9]);
  const refs=new Float32Array([0,1,0, 0,1,0, 0,1,0, 0,0,0]);
  assert.equal(auditTriangles({positions:p,indices:[0,1,2],expectedDirections:refs}).aligned,1);
});
test('ambiguous, malformed and undefined reference fields are rejected', () => {
  assert.throws(()=>auditTriangles({positions,expectedDirection:[0,1,0],expectedDirections:positions}),/Choose/);
  assert.throws(()=>auditTriangles({positions,expectedDirections:[0,1,0]}),/per vertex/);
  assert.throws(()=>auditTriangles({positions,expectedDirections:Array(9).fill(0)}),/nonzero/);
  assert.throws(()=>auditTriangles({positions,expectedDirections:[0,1,0,NaN,1,0,0,1,0]}),/finite/);
  assert.throws(()=>auditTriangles({positions,expectedDirections:[1,0,0,-.5,0,0,-.5,0,0]}),/cancel/);
});
