/**
 * A code-built slider-crank teaching assembly with one absolute-time state.
 * Units are metres; Y is up; +Z faces the viewer. Materials are borrowed.
 */
export function buildSliderCrank(THREE,{materials,crankRadius=.035,rodLength=.145,period=2.4}={}){
  if(String(THREE?.REVISION)!=='187')throw new Error('slider-crank requires Three.js r187');
  const roles=['frame','wheel','steel','copper','glass','dark'];
  for(const key of roles)if(!materials?.[key]?.isMaterial)throw new TypeError(`materials.${key} must be a Three.js material`);
  for(const [name,value]of Object.entries({crankRadius,rodLength,period}))if(!Number.isFinite(value)||value<=0)throw new RangeError(`${name} must be positive`);
  if(rodLength<2.2*crankRadius||rodLength>10*crankRadius)throw new RangeError('rodLength/crankRadius must be in [2.2,10]');
  const root=new THREE.Group();root.name='slider-crank-assembly';
  const owned=new Set(),parts={};let disposed=false,lastState=null;
  const own=g=>(owned.add(g),g);
  function add(name,geometry,material,parent=root,position=[0,0,0]){
    const o=new THREE.Mesh(own(geometry),material);o.name=name;o.position.set(...position);o.castShadow=true;o.receiveShadow=true;parent.add(o);parts[name]=o;return o;
  }
  function box(name,size,position,material,parent=root){return add(name,new THREE.BoxGeometry(...size),material,parent,position);}
  function cylX(name,r,length,position,material,segments=48,parent=root){const o=add(name,new THREE.CylinderGeometry(r,r,length,segments),material,parent,position);o.rotation.z=-Math.PI/2;return o;}
  function cylZ(name,r,length,position,material,segments=48,parent=root){const o=add(name,new THREE.CylinderGeometry(r,r,length,segments),material,parent,position);o.rotation.x=Math.PI/2;return o;}
  function torusX(name,r,tube,position,material,parent=root){const o=add(name,new THREE.TorusGeometry(r,tube,10,64),material,parent,position);o.rotation.y=Math.PI/2;return o;}
  try{
    // A machined bed, upright bearing towers and a split guide rail carry loads.
    box('bed',[.37,.026,.14],[.075,-.105,0],materials.frame);
    box('bed-edge',[.34,.003,.145],[.075,-.09,0],materials.copper);
    for(const x of [-.025,.025]){
      box(`bearing-tower-${x}`,[.022,.095,.055],[x,-.049,0],materials.frame);
      box(`bearing-foot-${x}`,[.042,.008,.072],[x,-.096,0],materials.steel);
    }
    for(const y of [-.058,.058])box(`crosshead-rail-${y}`,[.19,.009,.018],[.135,y,0],materials.steel);
    for(const x of [.052,.092,.132,.172])for(const y of [-.058,.058])cylZ(`rail-fastener-${x}-${y}`,.003,.004,[x,y,.012],materials.copper,16);

    const flywheel=new THREE.Group();flywheel.name='rotating-crank';root.add(flywheel);parts.flywheel=flywheel;
    const wheelR=Math.max(.078,crankRadius*2.15);
    const rim=add('flywheel-rim',new THREE.TorusGeometry(wheelR,.006,12,96),materials.wheel,flywheel,[0,0,0]);
    const inner=add('flywheel-inner-rim',new THREE.TorusGeometry(wheelR*.82,.0022,8,80),materials.copper,flywheel,[0,0,.002]);
    const spokeGeometry=own(new THREE.BoxGeometry(.005,wheelR*1.62,.009)),spokes=new THREE.InstancedMesh(spokeGeometry,materials.steel,8);
    spokes.name='flywheel-spokes';spokes.castShadow=true;spokes.receiveShadow=true;
    for(let i=0;i<8;i++){const o=new THREE.Object3D();o.rotation.z=i*Math.PI/8;o.updateMatrix();spokes.setMatrixAt(i,o.matrix);}spokes.instanceMatrix.needsUpdate=true;flywheel.add(spokes);parts['flywheel-spokes']=spokes;
    cylZ('flywheel-hub',.024,.036,[0,0,0],materials.steel,64,flywheel);
    torusX('hub-ring',.020,.0018,[0,0,.019],materials.copper,flywheel);
    cylZ('hub-cap',.011,.006,[0,0,.022],materials.dark,40,flywheel);
    cylZ('crank-pin',.007,.024,[crankRadius,0,0],materials.copper,40,flywheel);
    cylZ('crank-pin-cap',.004,.004,[crankRadius,0,.028],materials.steel,24,flywheel);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;cylZ(`rim-rivet-${i}`,.0018,.003,[wheelR*Math.cos(a),wheelR*Math.sin(a),.005],materials.copper,12,flywheel);}

    // The bore has clear front/rear faces and open ends, allowing the piston
    // and rod to stay visible without replacing the cylinder with a line proxy.
    const boreStart=rodLength-crankRadius-.015,boreEnd=rodLength+crankRadius+.025,boreLength=boreEnd-boreStart,boreMid=(boreStart+boreEnd)/2,boreR=.048;
    const cylinder=add('cylinder-window',new THREE.CylinderGeometry(boreR,boreR,boreLength,64,1,true),materials.glass,root,[boreMid,0,0]);
    cylinder.rotation.z=-Math.PI/2;
    torusX('bore-mouth',boreR,.002,[boreStart,0,0],materials.copper);
    torusX('bore-seal',boreR*.93,.0015,[boreEnd-.006,0,0],materials.dark);
    for(const y of [-1,1])for(const z of [-1,1]){
      box(`cylinder-stay-${y}-${z}`,[boreLength,.004,.004],[(boreStart+boreEnd)/2,y*.055,z*.044],materials.frame);
    }

    const piston=new THREE.Group();piston.name='piston-slider';root.add(piston);parts.piston=piston;
    cylX('piston-crown',.041,.027,[0,0,0],materials.steel,64,piston);
    for(const x of [-.009,-.002,.005])torusX(`piston-ring-${x}`,.041,.0015,[x,0,0],materials.dark,piston);
    cylX('wrist-pin',.008,.056,[0,0,0],materials.copper,32,piston);
    cylX('wrist-pin-head-left',.010,.002,[-.014,0,0],materials.dark,32,piston);
    cylX('wrist-pin-head-right',.010,.002,[.014,0,0],materials.dark,32,piston);

    const rodGeo=own(new THREE.CylinderGeometry(.0036,.0062,rodLength,24,1,false));
    const rod=add('connecting-rod',rodGeo,materials.copper);parts.rod=rod;
    const smallEnd=torusX('rod-small-end',.0085,.002,[0,0,0],materials.steel);
    const bigEnd=torusX('rod-big-end',.0105,.002,[0,0,0],materials.steel);
    // Add a beveled central web as geometry, not as an unconnected visual line.
    const web=add('rod-web',new THREE.BoxGeometry(.008,rodLength*.76,.006),materials.copper);parts.rodWeb=web;
    const webRibs=[];for(let i=0;i<5;i++)webRibs.push(box(`rod-web-rib-${i}`,[.0012,.009,.0065],[0,0,0],materials.steel));

    // A guard segment and inspection window make the moving load path readable.
    const guard=new THREE.Group();guard.name='inspection-guard';root.add(guard);parts.guard=guard;
    for(const y of [-.052,.052])box(`guard-frame-${y}`,[.25,.003,.004],[.106,y,.032],materials.frame,guard);
    box('guard-lower-rail',[.25,.003,.004],[.106,0,.032],materials.frame,guard);
    add('guard-window',new THREE.PlaneGeometry(.235,.08),materials.glass,guard,[.106,0,.031]);

    function stateAt(time){
      if(!Number.isFinite(time)||time<0)throw new RangeError('time must be finite and nonnegative');
      const phase=(time%period)/period,angle=phase*Math.PI*2,s=Math.sin(angle),c=Math.cos(angle),rootTerm=Math.sqrt(rodLength*rodLength-crankRadius*crankRadius*s*s);
      const pistonX=crankRadius*c+rootTerm,dx=-crankRadius*s-(crankRadius*crankRadius*s*c)/rootTerm,omega=2*Math.PI/period;
      return {time,phase,angleRad:angle,angleDegrees:angle*180/Math.PI,pistonX,stroke:2*crankRadius,velocity:dx*omega,
        rodAngle:Math.atan2(-crankRadius*s,pistonX-crankRadius*c),crankRadius,rodLength,period};
    }
    function applyState(time){if(disposed)throw new Error('slider crank disposed');const s=stateAt(time);flywheel.rotation.z=s.angleRad;
      piston.position.set(s.pistonX,0,0);const pin=new THREE.Vector3(crankRadius*Math.cos(s.angleRad),crankRadius*Math.sin(s.angleRad),0),head=new THREE.Vector3(s.pistonX,0,0),delta=head.clone().sub(pin),mid=pin.clone().add(head).multiplyScalar(.5);
      rod.position.copy(mid);rod.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
      const axis=pin.clone().sub(head).normalize(),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),axis);
      for(const ring of [smallEnd,bigEnd])ring.quaternion.copy(q);smallEnd.position.copy(head);bigEnd.position.copy(pin);
      web.position.copy(mid);web.quaternion.copy(rod.quaternion);
      webRibs.forEach((rib,i)=>{rib.position.copy(mid).addScaledVector(axis,((i-2)/5)*rodLength*.62);rib.quaternion.copy(rod.quaternion);});
      lastState=s;root.updateMatrixWorld(true);return s;
    }
    root.updateMatrixWorld(true);applyState(0);
    return {root,parts,stateAt,applyState,readState:()=>({...(lastState??stateAt(0)),period,stroke:2*crankRadius,geometryCount:owned.size}),dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const g of owned)g.dispose();owned.clear();}};
  }catch(error){for(const g of owned)g.dispose();root.removeFromParent();throw error;}
}
