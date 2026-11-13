import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createContourProfileSource as create} from '../../assets/geometry/contour-profile.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(process.env.THREE_MODULE).href:'three');
const contour=[[0,0],[2,0],[2,1],[0,1]],profile=[[0,0],[.2,0],[.2,.3],[0,.3]];
const make=(opts={})=>create(T,{contour,profile,...opts});
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function volume(g){let v=0;const p=g.attributes.position;for(let i=0;i<g.index.count;i+=3){const [a,b,c]=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,g.index.getX(i+k)));v+=a.dot(b.cross(c))/6;}return v;}
function ray(s,o,d){const mesh=new T.Mesh(s.geometry,new T.MeshBasicMaterial());mesh.updateMatrixWorld();return new T.Raycaster(new T.Vector3(...o),new T.Vector3(...d)).intersectObject(mesh);}
test('independent rectangle volume, open central hole, front/back/side rays and four winding combinations',()=>{for(const a of [contour,contour.toReversed()])for(const b of [profile,profile.toReversed()]){const s=make({contour:a,profile:b});near(volume(s.geometry),((2.4*1.4)-2)*.3);assert.equal(ray(s,[1,.5,2],[0,0,-1]).length,0);assert.ok(ray(s,[-.1,.5,2],[0,0,-1]).length);assert.ok(ray(s,[-.1,.5,-2],[0,0,1]).length);assert.ok(ray(s,[-2,.5,.1],[1,0,0]).length);s.dispose();}});
test('queries hit actual triangle and preserve independent right handed transformed frame',()=>{const s=make();for(const [u,v]of [[.13,.12],[.41,.67],[0,0],[1,1]]){const q=s.surfaceAt(u,v);const hits=ray(s,q.point.clone().addScaledVector(q.normal,.01).toArray(),q.normal.clone().negate().toArray());assert.ok(hits.some(h=>h.point.distanceTo(q.point)<1e-6&&h.faceIndex===q.triangleIndex));const determinant=q.frame.determinant();near(determinant,1);const world=new T.Matrix4().makeRotationX(.9).setPosition(2,3,4),contact=q.point.clone().applyMatrix4(world),attached=new T.Vector3().setFromMatrixPosition(world.clone().multiply(q.frame));near(contact.distanceTo(attached),0);q.point.set(100,100,100);assert.ok(s.surfaceAt(u,v).point.length()<5);}assert.deepEqual(s.surfaceAt(1,1).point,s.surfaceAt(0,0).point);s.dispose();});
test('groups cover triangles, metric UV, Float32 attributes, unit normals, hard and smooth seams',()=>{for(const smooth of [false,true]){const s=make({contourCreases:Array(4).fill(!smooth),profileCreases:Array(4).fill(!smooth),bandMaterialIndices:[0,0,2,3],uvMeters:2}),g=s.geometry;assert.ok(g.attributes.position.array instanceof Float32Array);let end=0;for(const group of g.groups){assert.equal(group.start,end);end+=group.count;}assert.equal(end,g.index.count);assert.equal(g.groups.length,3);assert.equal(s.metadata.bands.length,4);near(g.attributes.uv.getX(1),1);for(let i=0;i<g.attributes.normal.count;i++)near(new T.Vector3().fromBufferAttribute(g.attributes.normal,i).length(),1);const n=i=>new T.Vector3().fromBufferAttribute(g.attributes.normal,i);if(smooth)near(n(0).distanceTo(n(51)),0);else assert.ok(n(0).distanceTo(n(51))>1);s.dispose();}});
test('nonrectangular contour, concave section, inward offsets and snapshots',()=>{const c=[[0,0],[2,0],[2.8,1],[1,2],[-.4,1]],p=[[-.05,0],[.3,0],[.3,.1],[.1,.1],[.1,.3],[-.05,.3]],s=create(T,{contour:c,profile:p});assert.ok(volume(s.geometry)>0);assert.equal(s.metadata.triangleCount,60);const q=s.surfaceAt(.23,.37).point.clone();c[0][0]=999;p[0][0]=999;s.metadata.contour[0][0]=999;s.metadata.profile[0][0]=999;s.metadata.contourArcLengths.fill(999);s.metadata.bands[0].materialIndex=99;assert.equal(s.surfaceAt(.23,.37).materialIndex,0);near(q.distanceTo(s.surfaceAt(.23,.37).point),0);s.dispose();});
test('reject invalid domains, collapsed insets, miter overruns and Float32 loss',()=>{for(const opts of [{maxTriangles:31},{maxTriangles:1.5},{miterLimit:1.1},{profile:[[-.6,0],[0,0],[0,.3],[-.6,.3]]},{contour:[[0,0],[2,0],[1,.2],[0,1]]},{profile:[[0,0],[.2,.3],[.2,0],[0,.3]]},{contour:contour.map(([x,y])=>[x+1e9,y+1e9])},{profileCreases:[true]},{uvMeters:0},{bandMaterialIndices:7}])assert.throws(()=>make(opts));});
test('disposal event exactly once, invalid query and closed source rejection',()=>{const s=make();let events=0;s.geometry.addEventListener('dispose',()=>events++);for(const args of [[NaN,0],[-.1,0],[0,1.1],[0,Infinity]])assert.throws(()=>s.surfaceAt(...args));s.dispose();s.dispose();assert.equal(events,1);assert.throws(()=>s.surfaceAt(0,0),/disposed/);});

test('finite translated coordinates with resolvable Float32 thickness remain supported',()=>{const s=make({contour:contour.map(([x,y])=>[x*1024+1e10,y*1024+1e10]),profile:profile.map(([d,z])=>[d*10240,z*10240])});assert.ok(volume(s.geometry)>0);s.dispose();});
test('all emitted hard normals face out of analytic rectangular ring; soft corner equal-quad weighting',()=>{const s=make(),g=s.geometry,p=g.attributes.position;const solid=([x,y,z])=>x>-.2&&x<2.2&&y>-.2&&y<1.2&&z>0&&z<.3&&!(x>0&&x<2&&y>0&&y<1);for(let t=0;t<g.index.count/3;t++){const vs=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,g.index.getX(3*t+k))),c=vs[0].clone().add(vs[1]).add(vs[2]).divideScalar(3),n=vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).normalize();assert.ok(solid(c.clone().addScaledVector(n,-1e-5).toArray()));assert.ok(!solid(c.clone().addScaledVector(n,1e-5).toArray()));for(let k=0;k<3;k++)near(n.distanceTo(new T.Vector3().fromBufferAttribute(g.attributes.normal,g.index.getX(3*t+k))),0);}s.dispose();const smooth=make({contourCreases:Array(4).fill(false),profileCreases:Array(4).fill(false)});near(new T.Vector3().fromBufferAttribute(smooth.geometry.attributes.normal,0).distanceTo(new T.Vector3(1,1,-2).normalize()),0);smooth.dispose();});
test('nonrectangular offsets are true line distances rather than clamped corner displacements',()=>{const c=[[0,0],[3,0],[2,2],[0,1]],s=make({contour:c});const p=s.geometry.attributes.position;for(let i=0;i<4;i++){const a=c[i],b=c[(i+1)%4],normal=new T.Vector2(b[1]-a[1],a[0]-b[0]).normalize();for(const index of [i*4+3,i*4+2]){const q=new T.Vector2(p.getX(index),p.getY(index));near(q.sub(new T.Vector2(...a)).dot(normal),.2);}}s.dispose();});
test('reject Float32 nonadjacent concave profile contact while accepting separated same shape',()=>{const section=z=>[[0,1],[.4,1],[.4,1.3],[.2,z],[0,1.3]];assert.throws(()=>make({profile:section(1.00000001)}),/Float32/);const s=make({profile:section(1.01)});s.dispose();});
test('each sparse crease/material option is rejected',()=>{for(const key of ['contourCreases','profileCreases','bandMaterialIndices']){const value=key==='bandMaterialIndices'?[3,4,,6]:[true,true,,true];assert.throws(()=>make({[key]:value}));}});
test('exact normalized public arc boundaries select outgoing cells on both axes and material agrees with groups',()=>{const s=make({contour:[[0,0],[1,0],[1,46],[0,46]],profile:[[0,0],[1,0],[1,46],[0,46]],bandMaterialIndices:[3,4,5,6]});for(const [key,field,other]of [['contourArcLengths','contourSegment',.1],['profileArcLengths','profileBand',.1]]){const a=s.metadata[key];for(let i=1;i<a.length-1;i++){const boundary=a[i]/a.at(-1);for(const [value,want]of [[boundary-1e-12,i-1],[boundary,i],[boundary+1e-12,i]]){const q=field==='contourSegment'?s.surfaceAt(value,other):s.surfaceAt(other,value);assert.equal(q[field],want);const group=s.geometry.groups.find(g=>q.triangleIndex*3>=g.start&&q.triangleIndex*3<g.start+g.count);assert.equal(q.materialIndex,group.materialIndex);}}}s.dispose();});

// Frozen S07 design witnesses; station values are authored test oracles, not source output.
const stockFixtures=[
 {
  name:"B1",
  contour:[
   [-0.42,-0.23],[0.42,-0.23],[0.42,0.23],[-0.42,0.23],
  ],
  profile:[
   [0.0,0.0],[0.05,0.0],[0.05,0.0112],[0.041,0.0112],
   [0.041,0.032],[0.028999999999999998,0.032],[0.025,0.0256],[0.009,0.0256],
   [0.004,0.0176],[0.0,0.0176],
  ],
  charts:{"referenceOutsetM":0.025,"depthDatumM":0.016,"closedSeam":"reject","pieces":[{"firstSegment":0,"segmentCount":1,"mode":"member"},{"firstSegment":1,"segmentCount":1,"mode":"member"},{"firstSegment":2,"segmentCount":1,"mode":"member"},{"firstSegment":3,"segmentCount":1,"mode":"member"}]},
  stations:[
   [
    {"guideXYm":[-0.445,-0.255],"s":0},
    {"guideXYm":[0.445,-0.255],"s":0.89},
   ],
   [
    {"guideXYm":[0.445,-0.255],"s":0},
    {"guideXYm":[0.445,0.255],"s":0.51},
   ],
   [
    {"guideXYm":[0.445,0.255],"s":0},
    {"guideXYm":[-0.445,0.255],"s":0.89},
   ],
   [
    {"guideXYm":[-0.445,0.255],"s":0},
    {"guideXYm":[-0.445,-0.255],"s":0.51},
   ],
  ]
 },
 {
  name:"B2",
  contour:[
   [0.3,0.0],[0.2963065021785413,0.046930339512069257],[0.285316954888546,0.09270509831248422],[0.26730195725651035,0.13619714992186405],
   [0.2427050983124842,0.17633557568774194],[0.21213203435596426,0.21213203435596423],[0.17633557568774194,0.2427050983124842],[0.13619714992186405,0.26730195725651035],
   [0.09270509831248423,0.285316954888546],[0.04693033951206928,0.2963065021785413],[1.8369701987210297e-17,0.3],[-0.04693033951206917,0.2963065021785413],
   [-0.0927050983124842,0.2853169548885461],[-0.13619714992186402,0.26730195725651035],[-0.1763355756877419,0.2427050983124842],[-0.21213203435596423,0.21213203435596426],
   [-0.24270509831248419,0.17633557568774197],[-0.26730195725651035,0.13619714992186405],[-0.285316954888546,0.09270509831248425],[-0.29630650217854126,0.04693033951206929],
   [-0.3,3.6739403974420595e-17],[-0.2963065021785413,-0.046930339512069215],[-0.28531695488854614,-0.09270509831248407],[-0.26730195725651035,-0.136197149921864],
   [-0.2427050983124842,-0.1763355756877419],[-0.2121320343559643,-0.21213203435596423],[-0.17633557568774197,-0.24270509831248419],[-0.13619714992186407,-0.26730195725651035],
   [-0.09270509831248426,-0.285316954888546],[-0.04693033951206931,-0.29630650217854126],[-5.510910596163089e-17,-0.3],[0.0469303395120692,-0.2963065021785413],
   [0.09270509831248416,-0.2853169548885461],[0.136197149921864,-0.26730195725651035],[0.17633557568774186,-0.24270509831248427],[0.2121320343559642,-0.2121320343559643],
   [0.24270509831248419,-0.176335575687742],[0.26730195725651035,-0.13619714992186407],[0.285316954888546,-0.0927050983124843],[0.29630650217854126,-0.04693033951206933],
  ],
  profile:[
   [0.0,0.0],[0.032,0.0],[0.032,0.009099999999999999],[0.02624,0.009099999999999999],
   [0.02624,0.026],[0.01856,0.026],[0.016,0.0208],[0.0057599999999999995,0.0208],
   [0.00256,0.0143],[0.0,0.0143],
  ],
  charts:{"referenceOutsetM":0.016,"depthDatumM":0.013,"closedSeam":"cutAtStart","pieces":[{"firstSegment":0,"segmentCount":40,"mode":"rail"}]},
  stations:[
   [
    {"guideXYm":[0.3160494751757252,-8.489957721062892e-18],"s":0},
    {"guideXYm":[0.3121583816822762,0.0494410305753603],"s":0.04959391205509476},
    {"guideXYm":[0.3005809128375368,0.09766465889258215],"s":0.09918782411018952},
    {"guideXYm":[0.2816021443478808,0.14348345917744898],"s":0.14878173616528428},
    {"guideXYm":[0.25568939648044475,0.18576922050306738],"s":0.19837564822037906},
    {"guideXYm":[0.2234807270872047,0.22348072708720468],"s":0.2479695602754738},
    {"guideXYm":[0.18576922050306738,0.25568939648044475],"s":0.29756347233056857},
    {"guideXYm":[0.14348345917744898,0.2816021443478808],"s":0.34715738438566335},
    {"guideXYm":[0.09766465889258218,0.3005809128375368],"s":0.39675129644075807},
    {"guideXYm":[0.049441030575360326,0.3121583816822762],"s":0.44634520849585285},
    {"guideXYm":[1.7476022227098415e-17,0.3160494751757252],"s":0.49593912055094763},
    {"guideXYm":[-0.04944103057536021,0.3121583816822762],"s":0.5455330326060424},
    {"guideXYm":[-0.09766465889258213,0.30058091283753685],"s":0.5951269446611371},
    {"guideXYm":[-0.14348345917744895,0.2816021443478808],"s":0.6447208567162319},
    {"guideXYm":[-0.18576922050306735,0.25568939648044475],"s":0.6943147687713267},
    {"guideXYm":[-0.22348072708720468,0.2234807270872047],"s":0.7439086808264215},
    {"guideXYm":[-0.2556893964804447,0.1857692205030674],"s":0.7935025928815161},
    {"guideXYm":[-0.2816021443478808,0.14348345917744898],"s":0.8430965049366109},
    {"guideXYm":[-0.3005809128375368,0.09766465889258218],"s":0.8926904169917057},
    {"guideXYm":[-0.31215838168227616,0.04944103057536033],"s":0.9422843290468005},
    {"guideXYm":[-0.3160494751757252,4.6123041455595375e-17],"s":0.9918782411018953},
    {"guideXYm":[-0.3121583816822762,-0.04944103057536024],"s":1.04147215315699},
    {"guideXYm":[-0.3005809128375369,-0.097664658892582],"s":1.0910660652120845},
    {"guideXYm":[-0.2816021443478808,-0.14348345917744892],"s":1.1406599772671795},
    {"guideXYm":[-0.25568939648044475,-0.18576922050306732],"s":1.1902538893222743},
    {"guideXYm":[-0.22348072708720476,-0.22348072708720468],"s":1.239847801377369},
    {"guideXYm":[-0.1857692205030674,-0.25568939648044475],"s":1.2894417134324638},
    {"guideXYm":[-0.143483459177449,-0.2816021443478808],"s":1.3390356254875586},
    {"guideXYm":[-0.09766465889258219,-0.3005809128375368],"s":1.3886295375426534},
    {"guideXYm":[-0.049441030575360354,-0.31215838168227616],"s":1.4382234495977482},
    {"guideXYm":[-6.460445341281965e-17,-0.3160494751757252],"s":1.487817361652843},
    {"guideXYm":[0.049441030575360236,-0.3121583816822762],"s":1.5374112737079377},
    {"guideXYm":[0.09766465889258209,-0.30058091283753685],"s":1.5870051857630325},
    {"guideXYm":[0.14348345917744892,-0.2816021443478808],"s":1.6365990978181273},
    {"guideXYm":[0.18576922050306727,-0.2556893964804448],"s":1.686193009873222},
    {"guideXYm":[0.22348072708720465,-0.22348072708720476],"s":1.7357869219283169},
    {"guideXYm":[0.2556893964804447,-0.18576922050306743],"s":1.7853808339834116},
    {"guideXYm":[0.2816021443478808,-0.143483459177449],"s":1.8349747460385064},
    {"guideXYm":[0.3005809128375368,-0.09766465889258223],"s":1.8845686580936012},
    {"guideXYm":[0.31215838168227616,-0.049441030575360374],"s":1.934162570148696},
    {"guideXYm":[0.3160494751757252,-8.489957721062892e-18],"s":1.9837564822037907},
   ],
  ]
 },
 {
  name:"rect",
  contour:[
   [-0.525,0.5],[0.525,0.5],[0.525,1.5],[-0.525,1.5],
  ],
  profile:[
   [0.0,0.0],[0.055,0.0],[0.055,0.01225],[0.045099999999999994,0.01225],
   [0.045099999999999994,0.035],[0.0319,0.035],[0.0275,0.028000000000000004],[0.009899999999999999,0.028000000000000004],
   [0.0044,0.019250000000000003],[0.0,0.019250000000000003],
  ],
  charts:{"referenceOutsetM":0.0275,"depthDatumM":0.0175,"closedSeam":"reject","pieces":[{"firstSegment":0,"segmentCount":1,"mode":"member"},{"firstSegment":1,"segmentCount":1,"mode":"member"},{"firstSegment":2,"segmentCount":1,"mode":"member"},{"firstSegment":3,"segmentCount":1,"mode":"member"}]},
  stations:[
   [
    {"guideXYm":[-0.5525,0.4725],"s":0},
    {"guideXYm":[0.5525,0.4725],"s":1.105},
   ],
   [
    {"guideXYm":[0.5525,0.4725],"s":0},
    {"guideXYm":[0.5525,1.5275],"s":1.0550000000000002},
   ],
   [
    {"guideXYm":[0.5525,1.5275],"s":0},
    {"guideXYm":[-0.5525,1.5275],"s":1.105},
   ],
   [
    {"guideXYm":[-0.5525,1.5275],"s":0},
    {"guideXYm":[-0.5525,0.4725],"s":1.0550000000000002},
   ],
  ]
 },
 {
  name:"arch",
  contour:[
   [-0.525,0.5],[0.525,0.5],[0.525,0.975],[0.5205085522212505,1.043526250915527],
   [0.5071110588017609,1.1108799986788234],[0.48503675456842554,1.1759088019916721],[0.4546633369868303,1.2374999999999998],[0.4165105036528985,1.2945997502295783],
   [0.3712310601229375,1.3462310601229375],[0.31959975022957837,1.3915105036528985],[0.26250000000000007,1.4296633369868301],[0.2009088019916722,1.4600367545684256],
   [0.1358799986788234,1.482111058801761],[0.06852625091552715,1.4955085522212506],[3.2146978477618024e-17,1.5],[-0.0685262509155271,1.4955085522212506],
   [-0.13587999867882333,1.482111058801761],[-0.200908801991672,1.4600367545684256],[-0.2624999999999999,1.4296633369868303],[-0.31959975022957837,1.3915105036528985],
   [-0.37123106012293744,1.3462310601229375],[-0.41651050365289843,1.2945997502295785],[-0.4546633369868303,1.2374999999999998],[-0.48503675456842554,1.1759088019916721],
   [-0.5071110588017608,1.1108799986788236],[-0.5205085522212505,1.0435262509155272],[-0.525,0.9750000000000001],
  ],
  profile:[
   [0.0,0.0],[0.055,0.0],[0.055,0.01225],[0.045099999999999994,0.01225],
   [0.045099999999999994,0.035],[0.0319,0.035],[0.0275,0.028000000000000004],[0.009899999999999999,0.028000000000000004],
   [0.0044,0.019250000000000003],[0.0,0.019250000000000003],
  ],
  charts:{"referenceOutsetM":0.0275,"depthDatumM":0.0175,"closedSeam":"reject","pieces":[{"firstSegment":0,"segmentCount":1,"mode":"member"},{"firstSegment":1,"segmentCount":26,"mode":"rail"}]},
  stations:[
   [
    {"guideXYm":[-0.5525,0.4725],"s":0},
    {"guideXYm":[0.5525,0.4725],"s":1.105},
   ],
   [
    {"guideXYm":[0.5525,0.4725],"s":0},
    {"guideXYm":[0.5525,0.9759002567863567],"s":0.5034002567863567},
    {"guideXYm":[0.547831787052173,1.047123423023185],"s":0.5747762444917828},
    {"guideXYm":[0.5337310143930161,1.1180127942820526],"s":0.6470544206382711},
    {"guideXYm":[0.5104979560994011,1.1864551769801168],"s":0.7193325967847595},
    {"guideXYm":[0.47853013624015256,1.2512795029736001],"s":0.7916107729312476},
    {"guideXYm":[0.4383745330762162,1.311376610072056],"s":0.8638889490777361},
    {"guideXYm":[0.3907182201109635,1.3657182201109634],"s":0.9361671252242243},
    {"guideXYm":[0.3363766100720561,1.4133745330762162],"s":1.0084453013707126},
    {"guideXYm":[0.27627950297360043,1.4535301362401525],"s":1.0807234775172008},
    {"guideXYm":[0.21145517698011693,1.4854979560994013],"s":1.1530016536636891},
    {"guideXYm":[0.14301279428205257,1.5087310143930162],"s":1.2252798298101775},
    {"guideXYm":[0.072123423023185,1.522831787052173],"s":1.2975580059566658},
    {"guideXYm":[3.2146978477618024e-17,1.5275590059472008],"s":1.3698361821031542},
    {"guideXYm":[-0.07212342302318495,1.522831787052173],"s":1.4421143582496425},
    {"guideXYm":[-0.14301279428205252,1.5087310143930162],"s":1.5143925343961309},
    {"guideXYm":[-0.2114551769801167,1.4854979560994013],"s":1.5866707105426192},
    {"guideXYm":[-0.27627950297360027,1.4535301362401527],"s":1.6589488866891076},
    {"guideXYm":[-0.3363766100720561,1.4133745330762162],"s":1.7312270628355961},
    {"guideXYm":[-0.39071822011096347,1.3657182201109634],"s":1.8035052389820845},
    {"guideXYm":[-0.43837453307621616,1.3113766100720563],"s":1.8757834151285726},
    {"guideXYm":[-0.4785301362401526,1.2512795029736001],"s":1.9480615912750614},
    {"guideXYm":[-0.5104979560994012,1.1864551769801168],"s":2.0203397674215493},
    {"guideXYm":[-0.533731014393016,1.1180127942820528],"s":2.092617943568037},
    {"guideXYm":[-0.547831787052173,1.0471234230231852],"s":2.1648961197145256},
    {"guideXYm":[-0.5525,0.9759002567863568],"s":2.2362721074199516},
    {"guideXYm":[-0.5525,0.4725],"s":2.7396723642063083},
   ],
  ]
 },
];
const members=n=>Array.from({length:n},(_,firstSegment)=>({firstSegment,segmentCount:1,mode:'member'}));
const stock=(changes={})=>({referenceOutsetM:.1,depthDatumM:.15,closedSeam:'reject',pieces:members(4),...changes});
const formed=(changes={},opts={})=>make({...opts,formationCharts:stock(changes)});
const triple=(a,i)=>[a.getX(i),a.getY(i),a.getZ(i)];
function legacySnapshot(s){const g=s.geometry;return {attributes:Object.fromEntries(Object.entries(g.attributes).filter(([k])=>k!=='aFormationPosition').map(([k,a])=>[k,{array:Array.from(a.array),itemSize:a.itemSize,normalized:a.normalized}])),index:Array.from(g.index.array),groups:g.groups,metadata:s.metadata,queries:[[0,0],[.13,.12],[.41,.67],[1,1]].map(p=>s.surfaceAt(...p))};}
test('no-chart source retains frozen r180 arrays, index, groups, metadata and surface queries in four windings',()=>{
 const hashes=['dc8dafbdcf41791b44ccea7afeca27b29a08ec0088e9674c14841af5e0319519','602c115f53a75728c54393caeef9988e5a6e3497ae67b8d5412e6b3f2428d65e','2ffb10efbd7becf20ee8a7fad18293799a262a661cd8214b0b3df86a843ddf82','c7cc6c2d73039a53bb64eaaa48bf77b2ee76bae562be1bd4cc23d6870bb9ca45'];
 let k=0;for(const c of [contour,contour.toReversed()])for(const p of [profile,profile.toReversed()]){const s=make({contour:c,profile:p});assert.equal(s.geometry.getAttribute('aFormationPosition'),undefined);assert.equal(createHash('sha256').update(JSON.stringify(legacySnapshot(s))).digest('hex'),hashes[k++]);s.dispose();}
});
for(const fixture of stockFixtures)test(`stock ${fixture.name}: known physical stations and every emitted corner preserve legacy mesh`,()=>{
 const opts={contour:fixture.contour,profile:fixture.profile},plain=create(T,opts),s=create(T,{...opts,formationCharts:fixture.charts}),g=s.geometry,a=g.getAttribute('aFormationPosition');
 assert.ok(a,'missing stock coordinates');assert.ok(a.array instanceof Float32Array);assert.equal(a.itemSize,3);assert.equal(a.normalized,false);assert.equal(a.count,g.attributes.position.count);assert.deepEqual(legacySnapshot(s),legacySnapshot(plain));assert.deepEqual(Object.keys(s).sort(),Object.keys(plain).sort());
 const N=fixture.contour.length;fixture.charts.pieces.forEach((piece,h)=>{
  const stations=fixture.stations[h];near(stations[0].s,0);for(let k=1;k<stations.length;k++)near(stations[k].s-stations[k-1].s,Math.hypot(...stations[k].guideXYm.map((v,z)=>v-stations[k-1].guideXYm[z])),1e-12);
  for(let i=piece.firstSegment;i<piece.firstSegment+piece.segmentCount;i++)for(let j=0;j<fixture.profile.length;j++)for(let corner=0;corner<4;corner++){
   const r=(j+(corner>=2?1:0))%fixture.profile.length,end=corner===1||corner===2,vi=(j*N+i)*4+corner,k=i-piece.firstSegment+(end?1:0),[outset,z]=fixture.profile[r],p=triple(g.attributes.position,vi);
   near(a.getX(vi),fixture.charts.referenceOutsetM-outset,1e-7);near(a.getY(vi),z-fixture.charts.depthDatumM,1e-7);
   if(piece.mode==='rail')near(a.getZ(vi),stations[k].s,3e-7);
   else{const c=fixture.contour[i],d=fixture.contour[(i+1)%N],D=new T.Vector2(d[0]-c[0],d[1]-c[1]).normalize(),G=stations[0].guideXYm;near(a.getZ(vi),(p[0]-G[0])*D.x+(p[1]-G[1])*D.y,3e-7);}
  }
  if(piece.mode==='rail')for(let i=piece.firstSegment;i<piece.firstSegment+piece.segmentCount-1;i++)for(let j=0;j<fixture.profile.length;j++)for(const [left,right]of [[1,0],[2,3]]){const v=(j*N+i)*4;triple(a,v+left).forEach((x,k)=>near(x,triple(a,v+4+right)[k],1e-7));}
 });
 if(fixture.name==='B2'){const a0=0,last=(N-1)*4+1;assert.deepEqual(triple(g.attributes.position,a0),triple(g.attributes.position,last));near(a.getZ(a0),0);near(a.getZ(last),1.983756482203791,3e-7);assert.ok(a.getZ(last)>1.9);}
 plain.dispose();s.dispose();
});
test('independent rectangle members retain actual miter overlength and cut joint discontinuities',()=>{
 const s=formed(),a=s.geometry.getAttribute('aFormationPosition');assert.ok(a); // First inner edge begins .1 m after guide start; outer edge starts .1 m before it.
 near(a.getZ(0),.1);near(a.getZ(1),2.1);near(a.getZ(3),-.1);near(a.getZ(2),2.3);near(a.getZ(4),.1);assert.notEqual(a.getZ(1),a.getZ(4));
 s.dispose();
});
test('reversed contour keeps left-of-travel X, depth Y and right handed member projections',()=>{
 for(const c of [contour,contour.toReversed()]){const s=formed({}, {contour:c}),a=s.geometry.getAttribute('aFormationPosition'),p=s.geometry.attributes.position;assert.ok(a);const sign=c===contour?1:-1;
  for(let i=0;i<4;i++){const D=new T.Vector3(c[(i+1)%4][0]-c[i][0],c[(i+1)%4][1]-c[i][1],0).normalize(),X=new T.Vector3(-D.y,D.x,0),Y=new T.Vector3(0,0,1);near(X.clone().cross(Y).distanceTo(D),0);near(a.getX(i*4),sign*.1);near(a.getX(i*4+3),-sign*.1);const displacement=new T.Vector3().fromBufferAttribute(p,i*4+2).sub(new T.Vector3().fromBufferAttribute(p,i*4+3));near(a.getZ(i*4+2)-a.getZ(i*4+3),displacement.dot(D));}
  s.dispose();
 }
});
test('rail reversed winding keeps adjacent material stations continuous and final seam unwrapped',()=>{
 const c=Array.from({length:40},(_,i)=>[.3*Math.cos(i*Math.PI/20),.3*Math.sin(i*Math.PI/20)]).toReversed(),p=[[0,0],[.032,0],[.032,.026],[0,.026]],s=create(T,{contour:c,profile:p,formationCharts:{referenceOutsetM:.016,depthDatumM:.013,closedSeam:'cutAtStart',pieces:[{firstSegment:0,segmentCount:40,mode:'rail'}]}}),a=s.geometry.getAttribute('aFormationPosition');assert.ok(a);
 near(a.getX(0),-.016);near(a.getX(3),.016);near(a.getZ(0),0);near(a.getZ(157),1.983756482203791,3e-7);for(let i=0;i<39;i++)assert.deepEqual(triple(a,i*4+1),triple(a,(i+1)*4));s.dispose();
});
test('reject incomplete, overlapping, unordered, wrapping or malformed stock declarations',()=>{
 const invalid=[null,[],{},stock({extra:0}),stock({[Symbol('extra')]:0}),stock({pieces:[]}),stock({pieces:[...members(3)]}),stock({pieces:[members(4)[1],members(4)[0],...members(4).slice(2)]}),stock({pieces:[{firstSegment:0,segmentCount:2,mode:'rail'},...members(4).slice(1)]}),stock({pieces:[{firstSegment:3,segmentCount:4,mode:'rail'}]}),stock({pieces:[{firstSegment:0,segmentCount:4,mode:'member'}]}),stock({pieces:[{firstSegment:0,segmentCount:4,mode:'rail'}]}),stock({closedSeam:'cutAtStart'}),stock({closedSeam:'magic'}),stock({closedSeam:undefined}),stock({referenceOutsetM:NaN}),stock({depthDatumM:Infinity}),stock({referenceOutsetM:-.01}),stock({depthDatumM:.31})];
 for(const piece of [{firstSegment:-1,segmentCount:1,mode:'member'},{firstSegment:0,segmentCount:0,mode:'rail'},{firstSegment:0,segmentCount:1.5,mode:'rail'},{firstSegment:0,segmentCount:1,mode:'guess'},{firstSegment:0,segmentCount:1,mode:'member',extra:true},{firstSegment:0,segmentCount:1,mode:'member',[Symbol('extra')]:0}])invalid.push(stock({pieces:[piece,...members(4).slice(1)]}));
 const sparse=members(4);delete sparse[1];invalid.push(stock({pieces:sparse}));
 for(const formationCharts of invalid)assert.throws(()=>make({formationCharts}),undefined,JSON.stringify(formationCharts));
});
test('concave L reference rejects bbox notch, concave edge and vertex; accepts both interior winding orders',()=>{
 const p=[[0,0],[.04,0],[.04,.012],[.012,.012],[.012,.04],[0,.04]],c=[[0,0],[1,0],[1,1],[0,1]];
 for(const q of [p,p.toReversed()]){const old=create(T,{contour:c,profile:q});for(const [x,y]of [[.03,.03],[.012,.03],[.012,.012],[0,.02],[.04,0]])assert.throws(()=>create(T,{contour:c,profile:q,formationCharts:stock({referenceOutsetM:x,depthDatumM:y})}),RangeError);const s=create(T,{contour:c,profile:q,formationCharts:stock({referenceOutsetM:.006,depthDatumM:.03})});assert.ok(s.geometry.getAttribute('aFormationPosition'));s.dispose();assert.ok(old.surfaceAt(.2,.2).point.length()>0);old.dispose();}
});
test('reference clearance includes mesh and guide Float32 error, even when distance exceeds epsilon',()=>{
 const p=[[0,0],[.03125,0],[.03125,.03125],[0,.03125]],c=[[0,0],[1,0],[1,1],[0,1]];
 for(const q of [p,p.toReversed()]){const s=create(T,{contour:c,profile:q});s.dispose();for(const x of [5e-10,2e-8])assert.throws(()=>create(T,{contour:c,profile:q,formationCharts:stock({referenceOutsetM:x,depthDatumM:.015625})}),RangeError);const good=create(T,{contour:c,profile:q,formationCharts:stock({referenceOutsetM:1e-5,depthDatumM:.015625})});assert.ok(good.geometry.getAttribute('aFormationPosition'));good.dispose();}
});
test('stock rejects material coordinate magnitude above 8192 without restricting legacy translated sources',()=>{
 const c=[[0,0],[9000,0],[9000,1],[0,1]],old=make({contour:c});old.dispose();assert.throws(()=>formed({}, {contour:c}),RangeError);
 const translated=contour.map(([x,y])=>[x+100000,y+100000]),s=formed({}, {contour:translated});assert.ok(s.geometry.getAttribute('aFormationPosition'));s.dispose();
});
test('stock vertex cap is independent of caller triangle cap and checked before geometry allocation',()=>{
 const c=Array.from({length:500},(_,i)=>[3*Math.cos(i*2*Math.PI/500),3*Math.sin(i*2*Math.PI/500)]),p=Array.from({length:251},(_,i)=>[.1+.03*Math.cos(i*2*Math.PI/251),.1+.03*Math.sin(i*2*Math.PI/251)]);
 let allocations=0;class ObservedGeometry extends T.BufferGeometry{constructor(){super();allocations++;}}
 assert.throws(()=>create({...T,BufferGeometry:ObservedGeometry},{contour:c,profile:p,maxTriangles:300000,formationCharts:stock({referenceOutsetM:.1,depthDatumM:.1,pieces:members(500)})}),RangeError);assert.equal(allocations,0);
 const old=create(T,{contour:c,profile:p,maxTriangles:300000});assert.equal(old.geometry.attributes.position.count,502000);assert.equal(old.geometry.getAttribute('aFormationPosition'),undefined);old.dispose();
});
test('failed attachment disposes its candidate once and leaves prior stock source/query alive',()=>{
 const old=formed();assert.ok(old.geometry.getAttribute('aFormationPosition'));let events=0;
 class FailedAttachment extends T.BufferGeometry{constructor(){super();this.addEventListener('dispose',()=>events++);}setAttribute(k,a){if(k==='aFormationPosition')throw new Error('attachment failure');return super.setAttribute(k,a);}}
 assert.throws(()=>create({...T,BufferGeometry:FailedAttachment},{contour,profile,formationCharts:stock()}),/attachment failure/);assert.equal(events,1);assert.ok(old.surfaceAt(.2,.2).point.length()>0);let disposed=0;old.geometry.addEventListener('dispose',()=>disposed++);old.dispose();old.dispose();assert.equal(disposed,1);assert.throws(()=>old.surfaceAt(0,0),/disposed/);
});

test('slanted members use measured physical projections and neutral miter cuts in both windings',()=>{
 const shape=[[0,0],[3,0],[2.8,2],[.2,1.5]].map(([x,y])=>[x*Math.cos(.37)-y*Math.sin(.37),x*Math.sin(.37)+y*Math.cos(.37)]);
 for(const c of [shape,shape.toReversed()]){const s=formed({}, {contour:c}),a=s.geometry.getAttribute('aFormationPosition'),p=s.geometry.attributes.position;assert.ok(a);
  for(let i=0;i<4;i++){
   const v=i*4,point=k=>new T.Vector3().fromBufferAttribute(p,v+k),travel=point(1).sub(point(0)).normalize(),left=new T.Vector3(-travel.y,travel.x,0),startGuide=point(0).add(point(3)).multiplyScalar(.5);
   near((a.getZ(v)+a.getZ(v+3))*.5,0);assert.ok(a.getZ(v)*a.getZ(v+3)<0);
   for(let k=0;k<4;k++)near(a.getZ(v+k),point(k).sub(startGuide).dot(travel),4e-7);
   near(a.getX(v+3)-a.getX(v),point(3).sub(point(0)).dot(left),4e-7);
   near(a.getZ(v+1)-a.getZ(v),point(1).distanceTo(point(0)),4e-7);
  }
  s.dispose();
 }
});
test('mesh quantization error contributes separately to the interior reference clearance',()=>{
 const p=[[0,0],[.04,0],[.04,.04],[0,.04]],c=[[0,0],[1,0],[1,1],[0,1]];
 // d=80 nm exceeds epsilon + E_guide (~56.5 nm), but not their sum with E_mesh (~54 nm).
 assert.throws(()=>create(T,{contour:c,profile:p,formationCharts:stock({referenceOutsetM:8e-8,depthDatumM:.02})}),RangeError);
 const s=create(T,{contour:c,profile:p,formationCharts:stock({referenceOutsetM:1e-5,depthDatumM:.02})});assert.ok(s.geometry.getAttribute('aFormationPosition'));s.dispose();
});
test('metre bound includes exact 8192 endpoint and rejects rail accumulation and transverse/depth excess',()=>{
 const p=[[0,0],[.25,0],[.25,.25],[0,.25]],c=[[0,0],[8191.625,0],[8191.625,1],[0,1]],s=create(T,{contour:c,profile:p,formationCharts:stock({referenceOutsetM:.125,depthDatumM:.125})});assert.ok(s.geometry.getAttribute('aFormationPosition'));assert.equal(s.geometry.getAttribute('aFormationPosition').getZ(2),8192);s.dispose();
 const square=[[0,0],[3000,0],[3000,3000],[0,3000]];
 assert.throws(()=>create(T,{contour:square,profile:p,formationCharts:stock({referenceOutsetM:.125,depthDatumM:.125,closedSeam:'cutAtStart',pieces:[{firstSegment:0,segmentCount:4,mode:'rail'}]})}),RangeError);
 for(const [section,changes]of [[[[0,0],[18000,0],[18000,.3],[0,.3]],{referenceOutsetM:9000}],[[[0,0],[.2,0],[.2,18000],[0,18000]],{depthDatumM:9000}]]){
  const old=make({profile:section});old.dispose();assert.throws(()=>formed(changes,{profile:section}),RangeError);
 }
});
test('exact stock vertex budget remains supported with a larger caller triangle budget',()=>{
 const c=Array.from({length:500},(_,i)=>[3*Math.cos(i*2*Math.PI/500),3*Math.sin(i*2*Math.PI/500)]),p=Array.from({length:250},(_,i)=>[.1+.03*Math.cos(i*2*Math.PI/250),.1+.03*Math.sin(i*2*Math.PI/250)]),s=create(T,{contour:c,profile:p,maxTriangles:300000,formationCharts:stock({referenceOutsetM:.1,depthDatumM:.1,pieces:members(500)})}),a=s.geometry.getAttribute('aFormationPosition');assert.ok(a);assert.equal(a.count,500000);assert.equal(a.array.byteLength,6000000);s.dispose();
});
