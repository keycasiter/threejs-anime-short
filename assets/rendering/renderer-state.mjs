/** Internal state boundary for synchronous offscreen work in r180. This does
 * not snapshot GPU resources, shader history or arbitrary scene/raw GL edits.
 */
export function captureRendererState(T,r) {
  const target=r.getRenderTarget();
  // The logical getters ignore the bound target. The current viewport has a
  // public getter; only GL exposes the active scissor box and enabled bit.
  let active=null;
  if(target){
    const gl=r.getContext();
    active={viewport:r.getCurrentViewport(new T.Vector4()),scissor:new T.Vector4().fromArray(gl.getParameter(gl.SCISSOR_BOX)),scissorTest:gl.isEnabled(gl.SCISSOR_TEST)};
  }
  return {target,active,face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),
    viewport:r.getViewport(new T.Vector4()),scissor:r.getScissor(new T.Vector4()),scissorTest:r.getScissorTest(),
    xr:r.xr.enabled,shadowAuto:r.shadowMap.autoUpdate,shadowNeeds:r.shadowMap.needsUpdate,
    autoClear:r.autoClear,autoClearColor:r.autoClearColor,autoClearDepth:r.autoClearDepth,autoClearStencil:r.autoClearStencil,
    toneMapping:r.toneMapping,exposure:r.toneMappingExposure,outputColorSpace:r.outputColorSpace,
    clearColor:r.getClearColor?.(new T.Color()),clearAlpha:r.getClearAlpha?.()};
}
export function restoreRendererState(r,s) {
  r.xr.enabled=s.xr;r.shadowMap.autoUpdate=s.shadowAuto;r.shadowMap.needsUpdate=s.shadowNeeds;
  r.autoClear=s.autoClear;r.autoClearColor=s.autoClearColor;r.autoClearDepth=s.autoClearDepth;r.autoClearStencil=s.autoClearStencil;
  r.toneMapping=s.toneMapping;r.toneMappingExposure=s.exposure;r.outputColorSpace=s.outputColorSpace;
  if(s.clearColor)r.setClearColor(s.clearColor,s.clearAlpha);
  const logical=()=>{r.setViewport(s.viewport);r.setScissor(s.scissor);r.setScissorTest(s.scissorTest);};
  const bind=()=>r.setRenderTarget(s.target,s.face,s.mip);
  if(!s.active){bind();logical();return;}
  logical();
  const t=s.target,a=s.active;
  if(t.viewport.equals(a.viewport)&&t.scissor.equals(a.scissor)&&t.scissorTest===a.scissorTest){bind();return;}
  // r180 setRenderTarget copies the pixel rectangles into its own current
  // vectors and WebGLState. Replay post-bind overrides *without* a second DPR
  // multiply, retaining both logical getters and original target properties.
  const v=t.viewport.clone(),c=t.scissor.clone(),test=t.scissorTest;
  try{t.viewport.copy(a.viewport);t.scissor.copy(a.scissor);t.scissorTest=a.scissorTest;bind();}
  finally{t.viewport.copy(v);t.scissor.copy(c);t.scissorTest=test;}
}
