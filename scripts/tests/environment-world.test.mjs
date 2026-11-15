import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';

const threePath=resolve(process.env.THREE_MODULE);
const T=await import(pathToFileURL(threePath).href);
const {mergeGeometries}=await import(pathToFileURL(resolve(dirname(threePath),'../examples/jsm/utils/BufferGeometryUtils.js')).href);
const {buildEnvironmentWorld}=await import('../../assets/examples/environment-world.mjs');

test('environment world composes a complete connected landscape, focal spring court and distributed context',()=>{
 const world=buildEnvironmentWorld(T,{mergeGeometries,seed:381,configuration:'grid'});
 try{
  assert.equal(world.root.name,'environment-world');
  assert.equal(world.context.layout.connectionGraph.components.length,1);
  assert.ok(world.context.sites.length>=12,'the world must contain a full settlement, not one hero building');
  assert.ok(world.stats.roofTileInstances>=1200,'each visible roof needs a designed tile pattern');
  assert.ok(world.stats.treeCount>=24,'the outer terrain must remain populated in reverse views');
  assert.ok(world.stats.rockCount>=30,'the edge and shoreline need nonrepeating ground forms');
  assert.equal(world.stats.springWaterMeshes,1);
  assert.ok(world.observationTasks.overview&&world.observationTasks.courtyard&&world.observationTasks.reverse);
  assert.deepEqual(world.cameraContract,{horizontalDegrees:360,minPolarAngle:0.18,maxPolarAngle:1.62,minDistance:18,maxDistance:300});
  const state0=world.readState();world.update(3.25);const state1=world.readState();
  assert.equal(state0.seed,381);assert.equal(state1.time,3.25);assert.ok(state1.waterVertexChecksum!==state0.waterVertexChecksum);
  const road=world.context.roads.query(...world.context.sites[0].route.roadCenter);assert.ok(road,'the real settlement road query remains available');
 } finally { world.dispose(); }
 world.dispose();
 assert.throws(()=>world.update(4),/disposed/i);
});
