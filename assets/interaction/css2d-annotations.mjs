const finite=Number.isFinite;

/**
 * Attach one accessible HTML annotation to a real Object3D anchor. The caller
 * shares one CSS2DRenderer across all annotations. Scene, anchor, renderer and
 * an explicitly supplied line material are borrowed; created DOM, line geometry
 * and the default line material belong to this handle.
 */
export function createCSS2DAnnotation(T,{
 CSS2DObject,scene,anchor,document=globalThis.document,text,id='',offset=[0,0,0],
 closeLabel='Close annotation',onSelect=()=>{},onClose=()=>{},leaderLine=false,
 lineMaterial=null,lineColor='#e6c78f',lineRenderOrder=-1
}={}){
 if(!T?.Line||!T?.BufferGeometry||!T?.Float32BufferAttribute||!T?.Vector3||typeof CSS2DObject!=='function')throw new TypeError('inject Three.js geometry types and the same-version CSS2DObject addon');
 if(!scene?.isScene||!anchor?.isObject3D||!scene.getObjectById(anchor.id))throw new TypeError('scene and an Object3D anchor attached to that scene are required');
 if(typeof document?.createElement!=='function')throw new TypeError('a DOM document is required');
 if(typeof text!=='string'||!text.trim())throw new TypeError('annotation text must be a non-empty string');
 if(typeof id!=='string'||typeof closeLabel!=='string'||typeof onSelect!=='function'||typeof onClose!=='function')throw new TypeError('id, closeLabel, onSelect and onClose have invalid types');
 if(!Array.isArray(offset)||offset.length!==3||!offset.every(finite))throw new TypeError('offset must be a finite local [x,y,z]');
 if(typeof leaderLine!=='boolean'||!Number.isInteger(lineRenderOrder))throw new TypeError('leaderLine must be boolean and lineRenderOrder an integer');
 if(leaderLine&&lineMaterial&&lineMaterial.isMaterial!==true)throw new TypeError('lineMaterial must be a Three.js Material');
 const element=document.createElement('div'),content=document.createElement('button'),closeButton=document.createElement('button');
 element.className='three-annotation';element.setAttribute('role','group');element.setAttribute('aria-label',text);
 element.style.pointerEvents='auto';element.style.position='relative';element.style.display='';element.dataset.annotationId=id;
 content.type='button';content.className='three-annotation__text';content.textContent=text;content.setAttribute('aria-label',text);content.style.pointerEvents='auto';
 closeButton.type='button';closeButton.className='three-annotation__close';closeButton.textContent='×';closeButton.setAttribute('aria-label',closeLabel);closeButton.style.pointerEvents='auto';
 element.appendChild(content);element.appendChild(closeButton);
 const object=new CSS2DObject(element);object.name=id?`annotation:${id}`:'html-annotation';object.position.set(...offset);anchor.add(object);
 let line=null,ownedLineMaterial=null;
 if(leaderLine){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(6),3));
  const material=lineMaterial??(ownedLineMaterial=new T.LineBasicMaterial({color:lineColor,depthTest:true,depthWrite:false}));
  line=new T.Line(geometry,material);line.name=id?`annotation-leader:${id}`:'html-annotation-leader';line.renderOrder=lineRenderOrder;scene.add(line);
 }
 let visible=true,disposed=false;const lineStart=new T.Vector3(),lineEnd=new T.Vector3();
 const alive=()=>{if(disposed)throw new Error('CSS2D annotation disposed');};
 function setVisible(value){alive();visible=Boolean(value);object.visible=visible;element.style.display=visible?'':'none';if(line)line.visible=visible;return visible;}
 function select(event){if(disposed||!visible)return;if(event.target===closeButton)return;onSelect({id,anchor,object,event});}
 function close(event){if(disposed)return;event?.preventDefault?.();event?.stopPropagation?.();setVisible(false);onClose({id,anchor,object,event});}
 function update(){
  alive();if(!line||!visible)return object;
  anchor.updateWorldMatrix(true,false);object.updateWorldMatrix(true,false);
  anchor.getWorldPosition(lineStart);object.getWorldPosition(lineEnd);const p=line.geometry.getAttribute('position');
  p.setXYZ(0,lineStart.x,lineStart.y,lineStart.z);p.setXYZ(1,lineEnd.x,lineEnd.y,lineEnd.z);p.needsUpdate=true;line.geometry.computeBoundingSphere();return object;
 }
 function setText(next){alive();if(typeof next!=='string'||!next.trim())throw new TypeError('annotation text must be a non-empty string');content.textContent=next;content.setAttribute('aria-label',next);element.setAttribute('aria-label',next);return object;}
 function dispose(){if(disposed)return;disposed=true;closeButton.removeEventListener('click',close);content.removeEventListener('click',select);object.removeFromParent();element.remove?.();if(line){line.removeFromParent();line.geometry.dispose();if(ownedLineMaterial)ownedLineMaterial.dispose();}}
 content.addEventListener('click',select);closeButton.addEventListener('click',close);
 update();
 return {object,element,content,closeButton,leader:line,setText,show:()=>setVisible(true),hide:()=>setVisible(false),update,dispose,readState:()=>({id,text:content.textContent,visible,disposed,hasLeaderLine:Boolean(line)})};
}
