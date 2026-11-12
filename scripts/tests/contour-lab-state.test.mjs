import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {createResourceScope} from '../../assets/runtime/resource-scope.mjs';
import {createAssetSlot} from '../../assets/runtime/asset-slot.mjs';
import {createContourRelation} from '../../assets/examples/contour-relations.mjs';
const T=await import(pathToFileURL(process.env.THREE_MODULE).href);
const {OrbitControls}=await import(new URL('../examples/jsm/controls/OrbitControls.js',pathToFileURL(process.env.THREE_MODULE)).href.replace('/build/examples/','/examples/'));
const main=await readFile(new URL('../../assets/examples/contour-lab/main.mjs',import.meta.url),'utf8');
const design=JSON.parse(await readFile(new URL('../../assets/examples/contour-relations-design.json',import.meta.url),'utf8'));
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${v} != ${b[i]}`));
function element(){let value='';return {style:{},textContent:'',children:[],get value(){return value;},set value(v){value=this.children.length&&!this.children.some(x=>x.value===String(v))?'':String(v);},replaceChildren(...children){this.children=children;value=children[0]?.value??'';},addEventListener(){},removeEventListener(){}};}
const functionSource=name=>{const start=main.indexOf(` function ${name}(`);assert.ok(start>=0);const lineEnd=main.indexOf('\n',start);const multiline=main.slice(start,lineEnd).trimEnd().endsWith('{');return main.slice(start,multiline?main.indexOf('\n }',start)+3:lineEnd);};
// Execute the actual main consumer functions, not a parallel slot-state model.
function harness(){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const materials=Object.fromEntries(['frame','panelDeck','attachment'].map(k=>[k,new T.MeshStandardMaterial({roughness:k==='frame'?.46:.7})]));
 const rigidDepth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
 const doc=element(),camera=new T.PerspectiveCamera(40,16/9,.05,40),controls=new OrbitControls(camera,{...element(),getRootNode:()=>doc});controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;
 const slot=createAssetSlot(new T.Group());slot.replace(s=>s.own(createContourRelation(T,{design,materials})));
 const context=vm.createContext({T,design,materials,rigidDepth,slot,$,camera,controls,listen:(element,event,callback)=>{element.listeners??={};element.listeners[event]=callback;},createContourRelation,document:{createElement:element},console});
 vm.runInContext(`let disposed=false,error=null,replacementStatus='committed',selected={id:'opening-bearing',mode:'profile'},viewName='front';const parameters={spanX:1,spanY:1,sectionWidth:1,sectionHeight:1};const initialRoughness=.46;\n${['status','isFrozen','sync','viewOptions','rebuild','setView'].map(functionSource).join('\n')}\nglobalThis.api={rebuild,read(){return {selected,parameters,viewName,error,replacementStatus,revision:slot.revision,asset:slot.current.readState(),camera:{position:camera.position.toArray(),target:controls.target.toArray()}}}};`,context);
 vm.runInContext(main.split('\n').find(line=>line.includes("listen($('relation'),'change'")),context);
 return {api:context.api,slot,nodes,$,rigidDepth,close(){controls.dispose();slot.dispose();Object.values(materials).forEach(m=>m.dispose());rigidDepth.dispose();}};
}
test('actual Orbit configuration admits every registered camera position and target',()=>{
 const doc=element(),canvas={...element(),getRootNode:()=>doc};const camera=new T.PerspectiveCamera(40,16/9,.05,40),owner={own:x=>x};let controls;
 const line=main.split('\n').find(x=>x.includes('controls=owner.own(new OrbitControls'));
 controls=new Function('OrbitControls','camera','renderer','owner',`let controls;${line};return controls;`)(OrbitControls,camera,{domElement:canvas},owner);
 for(const example of design.examples)for(const pose of Object.values(example.camera)){camera.position.set(...pose.position);controls.target.set(...pose.target);controls.update();near(camera.position.toArray(),pose.position);near(controls.target.toArray(),pose.target);}
 controls.dispose();
});
test('actual main consumer adopts committed slot after old geometry cleanup throws',()=>{
 const h=harness(),old=h.slot.current,geometry=old.parts.frame.geometry;geometry.addEventListener('dispose',()=>{throw Error('retirement diagnostic');});
 assert.equal(h.api.rebuild({mode:'plain',parameters:{spanX:1.2}}),true);
 const s=h.api.read();assert.equal(s.revision,2);assert.equal(s.selected.mode,s.asset.mode);assert.equal(s.parameters.spanX,s.asset.parameters.spanX);assert.equal(h.$('mode').value,'plain');assert.equal(h.$('spanX').value,'1.2');
 assert.equal(s.replacementStatus,'committed-with-cleanup-error');assert.match(h.$('status').textContent,/已提交|committed/i);assert.doesNotMatch(h.$('status').textContent,/保留上一版本/);h.close();
});
test('actual main rejects own constructor without corrupting controls or revision',()=>{
 const h=harness(),before=h.api.read();for(const parameters of [{constructor:1},Object.defineProperty({},'unregistered',{value:1}),{[Symbol('unregistered')]:1}])assert.equal(h.api.rebuild({parameters}),false);const after=h.api.read();assert.equal(after.revision,before.revision);assert.equal(after.selected.mode,before.selected.mode);assert.equal(Object.hasOwn(after.parameters,'constructor'),false);assert.match(after.error,/Unknown structural parameter/);h.close();
});
test('actual programmatic relation switch refreshes view options and marks preserved camera custom',()=>{
 const h=harness(),before=h.api.read().camera;assert.equal(h.api.rebuild({id:'support-recess'}),true);const state=h.api.read();near(state.camera.position,before.position);near(state.camera.target,before.target);assert.equal(state.viewName,'custom');assert.equal(h.$('view').value,'custom');assert.deepEqual(h.$('view').children.map(x=>x.value),['custom',...Object.keys(design.examples[1].camera)]);h.close();
});

test('actual UI relation handler selects first registered pose while API keeps a custom camera',()=>{
 const h=harness();h.$('relation').value='support-recess';h.$('relation').listeners.change();const state=h.api.read();
 assert.equal(state.viewName,'grazing');assert.equal(h.$('view').value,'grazing');near(state.camera.position,design.examples[1].camera.grazing.position);near(state.camera.target,design.examples[1].camera.grazing.target);h.close();
});

test('actual initializer releases dependent color/depth materials before renderer bookkeeping',()=>{
 const released=[],scope=createResourceScope(),owner={own:x=>scope.own(x),defer:fn=>scope.defer(fn)};
 class Color extends T.MeshStandardMaterial{constructor(options){super(options);this.addEventListener('dispose',()=>released.push('color'));}}
 class Depth extends T.MeshDepthMaterial{constructor(options){super(options);this.addEventListener('dispose',()=>released.push('depth'));}}
 // Only the renderer lifecycle is a CPU double; no GPU/program balance is claimed.
 class Renderer{constructor(){this.domElement={remove(){}};this.shadowMap={};}setPixelRatio(){}setAnimationLoop(){}dispose(){released.push('renderer');}}
 const initialization=main.slice(main.indexOf('try{')+5,main.indexOf(' const match=contract.camera'));
 const context=vm.createContext({T:{...T,WebGLRenderer:Renderer,MeshStandardMaterial:Color,MeshDepthMaterial:Depth},owner,contract:design.renderContract,document:{body:{prepend(){}}}});
 vm.runInContext(`let renderer;const materials={};${initialization}`,context);scope.dispose();
 assert.equal(released.filter(x=>x==='color').length,3);assert.equal(released.at(-1),'renderer');assert.equal(released.filter(x=>x==='depth').length,1);
});
test('actual slot builder lends one scene depth material across every rigid caster and replacement',()=>{
 const h=harness();let releases=0;h.rigidDepth.addEventListener('dispose',()=>releases++);
 for(const id of ['opening-bearing','support-recess'])for(const mode of ['plain','profile']){
  assert.equal(h.api.rebuild({id,mode}),true);let casters=0;h.slot.current.root.traverse(node=>{if(node.isMesh&&node.castShadow){casters++;assert.equal(node.customDepthMaterial,h.rigidDepth);}});assert.ok(casters>=2);assert.equal(releases,0);
 }
 assert.equal(h.rigidDepth.depthPacking,T.RGBADepthPacking);h.close();assert.equal(releases,1);
});
test('custom view entry is disabled display-only while API can mark it selected',()=>{
 const h=harness();h.api.rebuild({id:'support-recess'});const option=h.$('view').children.find(x=>x.value==='custom');assert.equal(option.disabled,true);assert.equal(h.$('view').value,'custom');assert.equal(h.api.read().viewName,'custom');h.close();
});
