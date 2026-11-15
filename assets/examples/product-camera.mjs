/**
 * Code-built precision camera for the object-showcase route.
 * Coordinates are metres, Y up, lens points +Z. Materials are borrowed from the
 * caller; every geometry created here is owned and released by dispose().
 */
export function buildProductCamera(THREE,{materials}={}){
  if(String(THREE?.REVISION)!=='187')throw new Error('product camera requires Three.js r187');
  const roles=['shell','trim','rubber','glass','screen','marking','dark'];
  for(const role of roles)if(!materials?.[role]?.isMaterial)throw new TypeError(`materials.${role} must be a Three.js material`);
  const root=new THREE.Group();root.name='precision-camera';
  const owned=new Set(),parts={},anchors={};let disposed=false,focus=0;
  const own=g=>(owned.add(g),g);
  function mesh(name,geometry,material,parent=root,position=[0,0,0]){
    const o=new THREE.Mesh(own(geometry),material);o.name=name;o.position.set(...position);o.castShadow=true;o.receiveShadow=true;parent.add(o);parts[name]=o;return o;
  }
  function box(name,size,position,material,parent=root){return mesh(name,new THREE.BoxGeometry(...size),material,parent,position);}
  function cylY(name,radius,height,position,material,segments=48,parent=root){return mesh(name,new THREE.CylinderGeometry(radius,radius,height,segments),material,parent,position);}
  function cylZ(name,radius,depth,position,material,segments=64,parent=root){const o=mesh(name,new THREE.CylinderGeometry(radius,radius,depth,segments),material,parent,position);o.rotation.x=Math.PI/2;return o;}
  function roundedShape(width,height,r){const s=new THREE.Shape();s.moveTo(-width/2+r,-height/2);s.lineTo(width/2-r,-height/2);s.quadraticCurveTo(width/2,-height/2,width/2,-height/2+r);s.lineTo(width/2,height/2-r);s.quadraticCurveTo(width/2,height/2,width/2-r,height/2);s.lineTo(-width/2+r,height/2);s.quadraticCurveTo(-width/2,height/2,-width/2,height/2-r);s.lineTo(-width/2,-height/2+r);s.quadraticCurveTo(-width/2,-height/2,-width/2+r,-height/2);return s;}
  function extruded(name,width,height,depth,r,bevel,material,position){
    const g=new THREE.ExtrudeGeometry(roundedShape(width,height,r),{depth:depth-2*bevel,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:8});
    g.translate(0,0,-depth/2+bevel);return mesh(name,g,material,root,position);
  }
  function instanced(name,geometry,material,parent,count,matrices){
    const o=new THREE.InstancedMesh(own(geometry),material,count);o.name=name;o.castShadow=true;o.receiveShadow=true;
    matrices.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;parent.add(o);parts[name]=o;return o;
  }
  try{
    const bodyY=.052,w=.145,h=.094,d=.060;
    parts.body=extruded('body',w,h,d,.009,.002,materials.shell,[0,bodyY,0]);
    // A separate top cap and base seam keep the silhouette, panel break and
    // body thickness legible from front, rear and grazing views.
    box('topPlate',[w-.004,.012,d-.004],[0,.103,0],materials.trim);
    box('baseSeam',[w-.012,.003,d-.007],[0,.006,0],materials.dark);
    extruded('viewfinderHump',.058,.025,.044,.008,.0014,materials.shell,[.027,.119,-.002]);
    box('viewfinderFront',[.026,.012,.002],[.027,.119,.022],materials.dark);
    box('viewfinderGlass',[.016,.006,.001],[.027,.119,.0235],materials.glass);

    // Right-hand grip: a real padded form with shallow horizontal ribs.
    extruded('gripPad',.027,.068,.009,.009,.001,materials.rubber,[.056,.052,.032]);
    for(let i=0;i<7;i++)box(`grip-rib-${i}`,[.019,.00075,.0012],[.056,.026+i*.008,.037],materials.dark);
    box('rearGrip',[.026,.067,.004],[.056,.052,-.032],materials.rubber);

    // Lens mount, extending barrel, focus ring, aperture index and glass are
    // separate surfaces so their depth and changing state remain inspectable.
    const cx=-.018,cy=.055;
    const lens=new THREE.Group();lens.name='lens-barrel';lens.position.set(cx,cy,.031);root.add(lens);parts.lensBarrel=lens;
    const lensParts={};
    function lensMesh(name,g,material,pos=[0,0,0]){const o=new THREE.Mesh(own(g),material);o.name=name;o.position.set(...pos);o.castShadow=true;o.receiveShadow=true;lens.add(o);lensParts[name]=o;return o;}
    function lensCylinder(name,radius,depth,z,material){const o=lensMesh(name,new THREE.CylinderGeometry(radius,radius,depth,64),material,[0,0,z]);o.rotation.x=Math.PI/2;return o;}
    lensCylinder('mount-flange',.032,.008,.004,materials.trim);
    lensCylinder('rear-barrel',.029,.014,.014,materials.dark);
    lensCylinder('focus-barrel',.028,.018,.027,materials.rubber);
    lensCylinder('front-barrel',.024,.013,.040,materials.shell);
    const torus=(name,r,t,z,material)=>{const o=lensMesh(name,new THREE.TorusGeometry(r,t,10,72),material,[0,0,z]);return o;};
    torus('mount-edge',.030,.0014,.009,materials.trim);
    torus('focus-ring-front',.027,.0011,.035,materials.trim);
    torus('front-bezel',.0225,.0018,.047,materials.trim);
    torus('lens-inner-ring',.0187,.0007,.0485,materials.dark);
    lensCylinder('iris-housing',.0186,.002,.047,materials.dark);
    // Eight faceted iris leaves create a readable aperture rather than a flat
    // black disk. They are deliberately shallow and remain behind the glass.
    const iris=new THREE.Group();iris.name='iris';iris.position.z=.0482;lens.add(iris);lensParts.iris=iris;
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,shape=new THREE.Shape();
      shape.moveTo(.006*Math.cos(a),.006*Math.sin(a));shape.lineTo(.018*Math.cos(a+.28),.018*Math.sin(a+.28));
      shape.lineTo(.018*Math.cos(a+.55),.018*Math.sin(a+.55));shape.lineTo(.006*Math.cos(a+.34),.006*Math.sin(a+.34));shape.closePath();
      const leaf=new THREE.Mesh(own(new THREE.ShapeGeometry(shape)),materials.trim);leaf.name=`iris-leaf-${i}`;leaf.castShadow=false;iris.add(leaf);
    }
    const glass=lensMesh('front-glass',new THREE.SphereGeometry(.019,48,24),materials.glass,[0,0,.050]);glass.scale.set(1,1,.075);lensParts.frontGlass=glass;
    // Forty-eight machined grip teeth use one instanced geometry and material.
    const toothGeo=new THREE.BoxGeometry(.0013,.0022,.006),matrices=[];
    for(let i=0;i<48;i++){const a=i*Math.PI*2/48,ob=new THREE.Object3D();ob.position.set(.0275*Math.cos(a),.0275*Math.sin(a),.027);ob.rotation.z=a+Math.PI/2;ob.updateMatrix();matrices.push(ob.matrix.clone());}
    instanced('focus-knurling',toothGeo,materials.rubber,lens,matrices.length,matrices);
    const focusMark=mesh('focus-mark',new THREE.BoxGeometry(.0012,.004,.0008),materials.marking,lens,[0,.0305,.035]);lensParts.focusMark=focusMark;
    parts.focusRing=lensParts['focus-ring-front'];
    parts.frontGlass=glass;parts.aperture=iris;parts.lensDetails=lensParts;

    // Front plate: recessed optical window, badge, screws, and strap lugs.
    box('frontBadge',[.022,.008,.001],[.052,.082,.031],materials.dark);
    box('badgeRule',[.017,.0007,.0007],[.052,.084,.0318],materials.marking);
    for(const [i,x]of [-.061,.061].entries())for(const [j,y]of [.022,.082].entries()){
      const screw=cylZ(`front-screw-${i}-${j}`,.0015,.0009,[x,y,.031],materials.trim,12);screw.rotation.y=Math.PI/2;
      box(`screw-slot-${i}-${j}`,[.0018,.00025,.0003],[x,y,.0317],materials.dark);
    }
    for(const x of [-.073,.073])for(const sign of [-1,1]){
      const lug=new THREE.Mesh(own(new THREE.TorusGeometry(.006,.0015,8,20,Math.PI)),materials.trim);lug.name=`strap-lug-${x}-${sign}`;
      lug.position.set(x,.043,sign*.027);lug.rotation.y=sign<0?Math.PI:0;lug.castShadow=true;root.add(lug);parts[lug.name]=lug;
    }

    // Top controls: a knurled exposure dial, shutter button and real hot shoe.
    const dialX=-.047,dialZ=-.006;
    cylY('exposure-dial',.011,.005,[dialX,.112,dialZ],materials.trim);
    cylY('dial-cap',.007,.0015,[dialX,.115,dialZ],materials.dark);
    const tickMatrices=[];
    for(let i=0;i<24;i++){const a=i*Math.PI*2/24,o=new THREE.Object3D();o.position.set(dialX+.009*Math.cos(a),.115,dialZ+.009*Math.sin(a));o.scale.set(.0007,1,.0015);o.rotation.y=-a;o.updateMatrix();tickMatrices.push(o.matrix.clone());}
    instanced('exposure-ticks',new THREE.BoxGeometry(1,.0006,1),materials.marking,root,tickMatrices.length,tickMatrices);
    cylY('shutter-collar',.007,.004,[.045,.112,-.007],materials.dark);
    cylY('shutter',.0045,.004,[.045,.115,-.007],materials.trim);
    cylY('function-button',.003,.003,[.022,.112,-.023],materials.dark,32);
    box('hotshoe-base',[.031,.002,.014],[.022,.111,.016],materials.dark);
    for(const x of [.010,.034])box(`hotshoe-rail-${x}`,[.0015,.003,.014],[x,.113,.016],materials.trim);

    // Rear controls and display make the housing a complete object rather than
    // a front-only prop. Camera-facing screen remains an actual material slot.
    box('rear-screen-frame',[.052,.033,.002],[.030,.061,-.031],materials.trim);
    parts.display=box('display',[.045,.026,.0008],[.030,.061,-.0322],materials.screen);
    box('rear-view-port',[.026,.012,.001],[-.038,.084,-.031],materials.dark);
    box('rear-view-glass',[.019,.006,.0007],[-.038,.084,-.0318],materials.glass);
    for(let i=0;i<3;i++)cylY(`rear-control-${i}`,.003,.002,[.060,.037+i*.014,-.034],materials.trim,24);
    for(let i=0;i<4;i++){
      const x=-.063+i*.042;box(`rear-seam-${i}`,[.001,.001,.001],[x,.095,-.031],materials.dark);
    }

    // Distinct anchors are stable consumers for labels, straps and composition.
    anchors.mount=new THREE.Object3D();anchors.mount.name='mount-anchor';anchors.mount.position.set(cx,cy,.032);root.add(anchors.mount);
    anchors.hotshoe=new THREE.Object3D();anchors.hotshoe.name='hotshoe-anchor';anchors.hotshoe.position.set(.022,.116,.016);root.add(anchors.hotshoe);
    anchors.screen=new THREE.Object3D();anchors.screen.name='display-anchor';anchors.screen.position.set(.030,.061,-.033);root.add(anchors.screen);
    root.updateMatrixWorld(true);
    function setFocus(value){if(disposed)throw new Error('camera has been disposed');if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('focus must be in 0..1');focus=value;lens.position.z=.031+value*.008;lensParts['focus-ring-front'].rotation.z=value*.18;}
    return {root,parts,anchors,setFocus,readState:()=>({focus,focusTravel:focus*.008,materialsBorrowed:true,geometryCount:owned.size}),dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const g of owned)g.dispose();owned.clear();}};
  }catch(error){for(const g of owned)g.dispose();root.removeFromParent();throw error;}
}
