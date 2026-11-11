/** Diagnostic controls for real scene consumers; optional DOM UI. Absolute
 * time can reproduce analytic motion; accumulated simulation/physics/history
 * must provide their own reset via onTime. Does not promise pixel determinism.
 */
const validTime=t=>{if(!Number.isFinite(t)||t<0)throw Error('time must be finite and nonnegative');};
export function createSceneClock({time=0,paused=false}={}) {
  validTime(time);if(typeof paused!=='boolean')throw Error('paused must be boolean');let last=null;
  return {
    tick(wallSeconds){if(!Number.isFinite(wallSeconds))throw Error('wall time must be finite');
      const dt=paused||last===null?0:Math.max(0,wallSeconds-last);last=wallSeconds;time+=dt;
      return {time,dt,paused};},
    freeze(t=time){validTime(t);time=t;paused=true;last=null;},
    resume(){paused=false;last=null;},
    readState:()=>({time,paused})
  };
}

export function createSceneWorkbench(T,{camera,controls=null,renderer=null,clock=createSceneClock(),
  effects={},modes={},onTime=()=>{}}={}) {
  if(!camera?.isPerspectiveCamera||camera.parent)throw Error('unparented PerspectiveCamera required');
  if(typeof onTime!=='function'||!clock?.freeze||!clock?.readState)throw Error('clock and onTime required');
  for(const [name,e]of Object.entries(effects))if(!e||typeof e.get!=='function'||typeof e.set!=='function'||typeof e.get()!=='boolean')throw Error(`boolean effect consumer required: ${name}`);
  for(const fn of Object.values(modes))if(typeof fn!=='function')throw Error('mode must call a real scene factory/view');
  let disposed=false,panel=null,mode=null;
  function alive(){if(disposed)throw Error('workbench disposed');}
  function snapshot(){alive();return {camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,
    target:controls?.target.toArray()??null},clock:{...clock.readState()},effects:Object.fromEntries(Object.entries(effects).map(([k,e])=>[k,e.get()])),mode,
    stats:renderer?{...renderer.info.render,memory:{...renderer.info.memory},scope:renderer.info.autoReset?'last renderer invocation':'since last renderer.info.reset()'}:null};}
  function setEffect(name,value){alive();if(!effects[name])throw Error(`unknown effect ${name}`);if(typeof value!=='boolean')throw Error('boolean effect required');effects[name].set(value);if(effects[name].get()!==value)throw Error(`effect ${name} failed consumer readback`);
    if(panel)for(const box of panel.querySelectorAll('input[data-effect]'))if(box.dataset.effect===name)box.checked=value;}
  function setTime(time){alive();validTime(time);clock.freeze(time);onTime(time);if(panel)panel.querySelector('input[type=number]').value=String(time);}
  function setMode(name){alive();if(!modes[name])throw Error(`unknown mode ${name}`);
    const damping=controls?.enableDamping;
    try{if(controls){controls.enableDamping=false;controls.update();}modes[name]();controls?.update();}
    finally{if(controls)controls.enableDamping=damping;}
    mode=name;if(panel?.querySelector('select'))panel.querySelector('select').value=name;
  }
  function restore(s){alive();const c=s?.camera;
    const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
    if(!c||!vector(c.position,3)||!vector(c.quaternion,4)||Math.hypot(...c.quaternion)<1e-8||!Number.isFinite(c.fov)||c.fov<=0||c.fov>=180)throw Error('invalid camera snapshot');
    if(controls&&!vector(c.target,3))throw Error('controls target required');
    validTime(s.clock?.time);
    if(!s.effects||Object.keys(s.effects).some(k=>!effects[k]||typeof s.effects[k]!=='boolean'))throw Error('invalid effects snapshot');
    if(s.mode!==null&&!modes[s.mode])throw Error('unknown mode in snapshot');
    if(s.mode!==null)setMode(s.mode);
    // Drain pending OrbitControls deltas before applying the desired camera.
    const damping=controls?.enableDamping;
    if(controls){controls.enableDamping=false;controls.update();controls.target.fromArray(c.target);}
    camera.position.fromArray(c.position);camera.quaternion.fromArray(c.quaternion).normalize();camera.fov=c.fov;
    camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    if(controls){controls.update();controls.enableDamping=damping;}
    for(const[k,v]of Object.entries(s.effects))setEffect(k,v);
    setTime(s.clock.time); // Deliberately freezes restored shots even if source was live.
    return snapshot();
  }
  function mount(container=globalThis.document?.body){alive();if(panel)throw Error('workbench already mounted');if(!container?.append)throw Error('DOM container required');
    const doc=container.ownerDocument;panel=doc.createElement('details');panel.className='scene-workbench';panel.open=true;
    panel.style.cssText='position:fixed;right:14px;top:14px;z-index:1000;background:#13202aee;color:#e9f1f2;padding:12px;font:12px/1.7 system-ui;border:1px solid #5b747e;border-radius:7px;max-width:240px';
    const summary=doc.createElement('summary');summary.textContent='场景工作台';panel.append(summary);
    const time=doc.createElement('input');time.type='number';time.min='0';time.step='.1';time.value=String(clock.readState().time);time.setAttribute('aria-label','冻结时间（秒）');
    const freeze=doc.createElement('button');freeze.textContent='冻结 / 定位';freeze.onclick=()=>setTime(Number(time.value));
    const live=doc.createElement('button');live.textContent='继续';live.onclick=()=>clock.resume();panel.append(time,freeze,live);
    for(const[name,e]of Object.entries(effects)){const label=doc.createElement('label');label.style.display='block';const box=doc.createElement('input');box.type='checkbox';box.checked=e.get();box.dataset.effect=name;box.onchange=()=>{setEffect(name,box.checked);box.checked=e.get();};label.append(box,doc.createTextNode(name));panel.append(label);}
    if(Object.keys(modes).length){const select=doc.createElement('select');select.setAttribute('aria-label','诊断视图');for(const name of Object.keys(modes)){const o=doc.createElement('option');o.value=name;o.textContent=name;select.append(o);}select.onchange=()=>setMode(select.value);panel.append(select);}
    container.append(panel);return panel;
  }
  return {clock,snapshot,restore,setEffect,setTime,setMode,mount,
    dispose(){if(disposed)return;disposed=true;panel?.remove();panel=null;}};
}
