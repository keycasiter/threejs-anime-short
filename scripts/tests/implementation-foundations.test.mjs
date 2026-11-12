import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T = await import(process.env.THREE_MODULE ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : 'three');
let resources = {}, slots = {};
try { resources = await import('../../assets/runtime/resource-scope.mjs'); } catch(e) { if(e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
try { slots = await import('../../assets/runtime/asset-slot.mjs'); } catch(e) { if(e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
const scope = () => {
  assert.equal(typeof resources.createResourceScope, 'function', 'resource ownership implementation is required');
  return resources.createResourceScope();
};
const slot = parent => {
  assert.equal(typeof slots.createAssetSlot, 'function', 'transactional asset handoff is required');
  return slots.createAssetSlot(parent);
};
function disposalCount(object) {
  let n = 0; object.addEventListener('dispose', () => n++); return () => n;
}
function asset(s, material) {
  const geometry = s.own(new T.BoxGeometry(2, 3, 4));
  const root = new T.Mesh(geometry, material);
  return {root, geometry};
}

test('scope releases owned geometry once and keeps borrowed shared material alive', () => {
  const s = scope(), geometry = new T.BoxGeometry(), material = new T.MeshStandardMaterial();
  const geometryCount = disposalCount(geometry), materialCount = disposalCount(material);
  assert.equal(s.own(geometry), geometry); s.own(geometry);
  const mesh = new T.Mesh(geometry, material); assert.equal(mesh.material, material);
  assert.equal(s.inspect().owned, 1); s.dispose(); s.dispose();
  assert.equal(geometryCount(), 1); assert.equal(materialCount(), 0);
  assert.equal(s.inspect().state, 'disposed');
  assert.throws(() => s.own(material), /closed|disposed/i); assert.equal(materialCount(), 0);
  material.dispose();
});
test('exclusive ownership conflict is detected before either owner releases a resource', () => {
  const a = scope(), b = scope(), texture = new T.Texture(), n = disposalCount(texture);
  a.own(texture); assert.throws(() => b.own(texture), /owner|owned/i);
  b.dispose(); assert.equal(n(), 0); a.dispose(); assert.equal(n(), 1);
});
test('cleanup is reverse order and releases all resources after one cleanup throws', () => {
  const s = scope(), order = [], g = new T.BoxGeometry(), n = disposalCount(g);
  s.own(g); s.defer(() => { order.push('first'); });
  s.defer(() => { order.push('failure'); throw new Error('cleanup failure'); });
  s.defer(() => { order.push('last'); });
  assert.throws(() => s.dispose(), e => e instanceof AggregateError && e.errors.some(x => x.message === 'cleanup failure'));
  assert.deepEqual(order, ['last', 'failure', 'first']); assert.equal(n(), 1);
  assert.doesNotThrow(() => s.dispose());
});
test('custom whole-factory release keeps receiver and does not infer nested ownership', () => {
  const s = scope(), g = new T.BoxGeometry(), n = disposalCount(g);
  const factory = {geometry: g, dispose() { this.geometry.dispose(); }};
  s.own(factory); assert.throws(() => s.own(factory, () => {}), /release|registered/i);
  const x = {value: 0}; s.own(x, resource => { resource.value = 7; }); s.dispose();
  assert.equal(n(), 1); assert.equal(x.value, 7);
});
test('invalid ownership and cleanup inputs do not register partial work', () => {
  const s = scope();
  for(const value of [null, 1, {}, 'x']) assert.throws(() => s.own(value));
  assert.throws(() => s.defer(4)); assert.equal(s.inspect().owned, 0); s.dispose();
});

test('slot mounts candidate then retires old resources while preserving external scene children', () => {
  const parent = new T.Group(), external = new T.Group(), m = new T.MeshStandardMaterial(); parent.add(external);
  const x = slot(parent), first = x.replace(s => asset(s, m)), n = disposalCount(first.geometry);
  assert.equal(x.current, first); assert.equal(first.root.parent, parent); assert.equal(x.revision, 1);
  const second = x.replace(s => asset(s, m));
  assert.equal(n(), 1); assert.equal(first.root.parent, null); assert.equal(second.root.parent, parent);
  assert.equal(x.revision, 2); assert.ok(parent.children.includes(external));
  x.dispose(); assert.deepEqual(parent.children, [external]); assert.equal(x.current, null); m.dispose();
});
test('builder failure cleans candidate resources and preserves previous visible asset', () => {
  const parent = new T.Group(), m = new T.MeshStandardMaterial(), x = slot(parent);
  const first = x.replace(s => asset(s, m)), old = disposalCount(first.geometry); let candidateCount;
  assert.throws(() => x.replace(s => { const g = s.own(new T.BoxGeometry()); candidateCount = disposalCount(g); throw Error('build failure'); }), /build failure/);
  assert.equal(candidateCount(), 1); assert.equal(old(), 0); assert.equal(x.current, first);
  assert.equal(first.root.parent, parent); assert.equal(x.revision, 1); x.dispose(); m.dispose();
});
test('invalid or parented candidate is rejected without stealing caller objects', () => {
  const parent = new T.Group(), other = new T.Group(), root = new T.Group(), x = slot(parent);
  other.add(root); assert.throws(() => x.replace(() => ({root})), /parent|detach/i);
  assert.equal(root.parent, other); assert.throws(() => x.replace(() => ({})), /root/i);
  assert.throws(() => x.replace(() => ({root: parent})), /parent|cycle|root/i);
  assert.equal(x.revision, 0); x.dispose();
});
test('mount callback failure rolls back candidate and leaves active handle unchanged', () => {
  const parent = new T.Group(), m = new T.MeshStandardMaterial(), x = slot(parent);
  const first = x.replace(s => asset(s, m)); let count;
  assert.throws(() => x.replace(s => {
    const next = asset(s, m); count = disposalCount(next.geometry);
    next.root.addEventListener('added', () => { throw Error('mount failure'); }); return next;
  }), /mount failure/);
  assert.equal(count(), 1); assert.equal(x.current, first); assert.deepEqual(parent.children, [first.root]);
  x.dispose(); m.dispose();
});
test('added listeners cannot commit a reparented candidate or leave a disposed mesh in another parent', () => {
  for(const throwAfterMove of [false,true]) {
    const parent=new T.Group(),elsewhere=new T.Group(),m=new T.MeshStandardMaterial(),x=slot(parent);
    const first=x.replace(s=>asset(s,m));let n,candidate;
    assert.throws(()=>x.replace(s=>{
      const next=asset(s,m);candidate=next.root;n=disposalCount(next.geometry);
      candidate.addEventListener('added',()=>{
        if(candidate.parent===parent){elsewhere.add(candidate);if(throwAfterMove)throw Error('moved then failed');}
      });return next;
    }));
    assert.equal(n(),1);assert.equal(x.current,first);assert.equal(x.revision,1);
    assert.equal(candidate.parent,null);assert.equal(elsewhere.children.length,0);assert.deepEqual(parent.children,[first.root]);
    x.dispose();m.dispose();
  }
});
test('retirement failure reports an error after new asset has committed and remains usable', () => {
  const parent = new T.Group(), m = new T.MeshStandardMaterial(), x = slot(parent);
  const first = x.replace(s => { const a = asset(s, m); s.defer(() => {throw Error('old retirement');}); return a; });
  const n = disposalCount(first.geometry);
  assert.throws(() => x.replace(s => asset(s, m)), /cleanup|retir|dispos/i);
  assert.notEqual(x.current, first); assert.equal(x.current.root.parent, parent);
  assert.equal(x.revision, 2); assert.equal(n(), 1); x.dispose(); m.dispose();
});
test('slot refuses asynchronous and reentrant replacement and is terminal after disposal', () => {
  const x = slot(new T.Group());
  assert.throws(() => x.replace(async () => ({root: new T.Group()})), /sync/i);
  assert.throws(() => x.replace(() => x.replace(() => ({root:new T.Group()}))), /progress|reentran|busy/i);
  assert.equal(x.current, null); assert.equal(x.revision, 0);
  x.dispose(); x.dispose(); assert.throws(() => x.replace(() => ({root:new T.Group()})), /disposed/i);
});
test('failed build and failed cleanup are both retained in the error report', () => {
  const x = slot(new T.Group());
  assert.throws(() => x.replace(s => {s.defer(() => {throw Error('cleanup failure');}); throw Error('original failure');}),
    e => e instanceof AggregateError && e.errors[0].message === 'original failure' && e.errors[1] instanceof AggregateError);
  assert.equal(x.current, null); x.dispose();
});
