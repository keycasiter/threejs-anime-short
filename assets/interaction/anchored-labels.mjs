const finite=Number.isFinite;
const DEFAULT_FONT='600 28px system-ui, sans-serif';

function positive(value,name,{min=1e-6,max=100000}={}){
 if(!finite(value)||value<min||value>max)throw new RangeError(`${name} must be finite in ${min}..${max}`);
 return value;
}
function roundedRect(ctx,x,y,width,height,radius){
 const r=Math.min(radius,width/2,height/2);
 ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+width-r,y);ctx.arcTo(x+width,y,x+width,y+r,r);ctx.lineTo(x+width,y+height-r);ctx.arcTo(x+width,y+height,x+width-r,y+height,r);ctx.lineTo(x+r,y+height);ctx.arcTo(x,y+height,x,y+height-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
}
function wrapText(ctx,text,maxWidth){
 const lines=[];
 for(const paragraph of String(text).split('\n')){
  let line='';
  for(const char of [...paragraph]){
   const candidate=line+char;
   if(line&&ctx.measureText(candidate).width>maxWidth){lines.push(line.trimEnd());line=char.trimStart();}
   else line=candidate;
  }
  lines.push(line);
 }
 return lines.length?lines:[''];
}
function drawLabel(T,canvas,ctx,text,options){
 const {font,fontSize,padding,maxTextWidth,lineHeight,pixelRatio,background,foreground,border,borderWidth,cornerRadius,textAlign}=options;
 ctx.font=font;ctx.textAlign=textAlign;ctx.textBaseline='middle';
 const lines=wrapText(ctx,text,maxTextWidth),contentWidth=Math.max(fontSize,...lines.map(line=>ctx.measureText(line).width)),width=Math.ceil(contentWidth+padding*2),height=Math.ceil(lines.length*lineHeight+padding*2);
 canvas.width=Math.ceil(width*pixelRatio);canvas.height=Math.ceil(height*pixelRatio);
 if(typeof ctx.setTransform==='function')ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
 ctx.clearRect(0,0,width,height);
 if(background){ctx.fillStyle=background;roundedRect(ctx,0,0,width,height,cornerRadius);ctx.fill();}
 if(border&&borderWidth>0){ctx.strokeStyle=border;ctx.lineWidth=borderWidth;roundedRect(ctx,borderWidth/2,borderWidth/2,width-borderWidth,height-borderWidth,cornerRadius);ctx.stroke();}
 ctx.font=font;ctx.textAlign=textAlign;ctx.textBaseline='middle';ctx.fillStyle=foreground;
 const x=textAlign==='center'?width/2:textAlign==='right'?width-padding:padding;
 for(let i=0;i<lines.length;i++)ctx.fillText(lines[i],x,padding+lineHeight*(i+.5));
 return {width,height,aspect:width/height};
}

/**
 * Create a text-only CanvasTexture/Sprite label that follows one real Object3D
 * anchor. The scene, anchor, and Sprite's shared Three.js geometry are borrowed;
 * this handle owns only its canvas texture and SpriteMaterial.
 */
export function createAnchoredCanvasLabel(T,{
 scene,anchor,text,canvasFactory=()=>globalThis.document?.createElement?.('canvas'),
 sizeMode='world',worldHeight,viewHeight,pixelRatio=2,font=DEFAULT_FONT,fontSize=28,
 padding=12,maxTextWidth=360,lineHeight=fontSize*1.25,background='#18212ddd',foreground='#fff4dc',
 border='#d8c59a',borderWidth=1,cornerRadius=10,textAlign='left',offset=[0,0,0],center=[.5,.5],
 rotation=0,depthTest=true,opacity=1,fog=false,renderOrder=0,toneMapped=false
}={}){
 if(!T?.CanvasTexture||!T?.SpriteMaterial||!T?.Sprite||!T?.Vector3)throw new TypeError('inject the Three.js namespace with CanvasTexture, SpriteMaterial, Sprite and Vector3');
 if(!scene?.isScene||!anchor?.isObject3D||!scene.getObjectById(anchor.id))throw new TypeError('scene and an Object3D anchor attached to that scene are required');
 if(typeof text!=='string'||!text.trim())throw new TypeError('label text must be a non-empty string');
 if(sizeMode!=='world'&&sizeMode!=='view')throw new TypeError("sizeMode must be 'world' or 'view'");
 if(sizeMode==='world')positive(worldHeight,'worldHeight');else positive(viewHeight,'viewHeight',{min:1e-4,max:1});
 positive(pixelRatio,'pixelRatio',{min:1,max:4});positive(fontSize,'fontSize',{min:1,max:256});positive(padding,'padding',{min:0,max:256});positive(maxTextWidth,'maxTextWidth',{min:1,max:4096});positive(lineHeight,'lineHeight',{min:1,max:512});
 if(!Array.isArray(offset)||offset.length!==3||!offset.every(finite))throw new TypeError('offset must be a finite local [x,y,z]');
 if(!Array.isArray(center)||center.length!==2||!center.every(v=>finite(v)&&v>=0&&v<=1))throw new TypeError('center must contain two normalized values in 0..1');
 if(!finite(rotation)||!finite(opacity)||opacity<0||opacity>1||!Number.isInteger(renderOrder))throw new TypeError('rotation, opacity 0..1 and integer renderOrder are required');
 if(!finite(borderWidth)||borderWidth<0||borderWidth>64||!finite(cornerRadius)||cornerRadius<0||cornerRadius>256)throw new TypeError('borderWidth and cornerRadius must be finite nonnegative pixel values within limits');
 if(!['left','center','right'].includes(textAlign))throw new TypeError("textAlign must be 'left', 'center' or 'right'");
 const canvas=canvasFactory();if(!canvas||typeof canvas.getContext!=='function')throw new Error('canvasFactory must return a canvas with a 2D context');
 const ctx=canvas.getContext('2d');if(!ctx?.measureText||!ctx?.fillText)throw new Error('canvas must provide a usable 2D context');
 const options={font,fontSize,padding,maxTextWidth,lineHeight,pixelRatio,background,foreground,border,borderWidth,cornerRadius,textAlign};
 const layout=drawLabel(T,canvas,ctx,text,options),texture=new T.CanvasTexture(canvas);
 texture.colorSpace=T.SRGBColorSpace;texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 const material=new T.SpriteMaterial({map:texture,transparent:true,depthTest,depthWrite:false,opacity,fog,toneMapped,sizeAttenuation:sizeMode==='world',rotation});
 const sprite=new T.Sprite(material);sprite.name='anchored-canvas-label';sprite.center.set(center[0],center[1]);sprite.renderOrder=renderOrder;
 const localOffset=new T.Vector3(...offset),worldPosition=new T.Vector3();scene.add(sprite);
 let disposed=false,currentText=text;
 function alive(){if(disposed)throw new Error('anchored canvas label disposed');}
 function resize(){
  if(sizeMode==='world')sprite.scale.set(worldHeight*layout.aspect,worldHeight,1);
  else sprite.scale.set(1,1,1);
 }
 function place(){anchor.updateWorldMatrix(true,false);worldPosition.copy(localOffset);anchor.localToWorld(worldPosition);sprite.position.copy(worldPosition);}
 function update(camera){
  alive();place();
  if(sizeMode==='view'){
   if(!camera?.isCamera)throw new TypeError('view-sized labels require the active camera on every update');
   const projectionY=camera.projectionMatrix?.elements?.[5];if(!finite(projectionY)||Math.abs(projectionY)<1e-9)throw new Error('camera projection matrix is not ready');
   const height=2*viewHeight/projectionY;sprite.scale.set(height*layout.aspect,height,1);
  }
  return sprite;
 }
 function setText(next){
  alive();if(typeof next!=='string'||!next.trim())throw new TypeError('label text must be a non-empty string');
  currentText=next;Object.assign(layout,drawLabel(T,canvas,ctx,currentText,options));texture.needsUpdate=true;resize();return sprite;
 }
 function dispose(){if(disposed)return;disposed=true;sprite.removeFromParent();material.map=null;material.dispose();texture.dispose();}
 resize();place();
 return {sprite,canvas,texture,update,setText,dispose,readState:()=>({text:currentText,sizeMode,disposed,anchorId:anchor.id})};
}
