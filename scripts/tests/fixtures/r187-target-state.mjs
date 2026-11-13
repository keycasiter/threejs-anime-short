// CPU model of r187's rectangle domains. Canvas setters use DPR; bound-target
// setters use raw target pixels. setRenderTarget restores target-owned values.
export function targetState(T) {
 const dpr=2, logicalV=new T.Vector4(1,2,103,71),logicalS=new T.Vector4(4,5,50,23);
 const v=new T.Vector4(),s=new T.Vector4();let enabled,logicalTest=false,target,face,mip;
 const gl={SCISSOR_BOX:0x0c10,SCISSOR_TEST:0x0c11,getParameter:p=>{if(p!==gl.SCISSOR_BOX)throw Error('unknown query');return s.toArray();},isEnabled:p=>{if(p!==gl.SCISSOR_TEST)throw Error('unknown capability');return enabled;}};
 const api={getContext:()=>gl,getPixelRatio:()=>dpr,getViewport:o=>o.copy(logicalV),getScissor:o=>o.copy(logicalS),getScissorTest:()=>logicalTest,
  getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,getCurrentViewport:o=>o.copy(v),
  setViewport:o=>{logicalV.copy(o);v.copy(o).multiplyScalar(target?1:dpr).round();},setScissor:o=>{logicalS.copy(o);s.copy(o).multiplyScalar(target?1:dpr).round();},setScissorTest:o=>{enabled=logicalTest=o;},
  setRenderTarget(t,f=0,m=0){target=t;face=f;mip=m;if(t){v.copy(t.viewport);s.copy(t.scissor);enabled=t.scissorTest;}else{v.copy(logicalV).multiplyScalar(dpr).floor();s.copy(logicalS).multiplyScalar(dpr).floor();enabled=logicalTest;}}};
 const caller=new T.WebGLCubeRenderTarget(64);caller.viewport.set(3,2,20,25);caller.scissor.set(5,4,12,15);caller.scissorTest=true;api.setRenderTarget(caller,3,2);return api;
}
