/** Internal state boundary for synchronous offscreen work. Captures public
 * renderer settings changed by official PMREM / reflection / post addons.
 * It does not snapshot GPU resources, shader history or arbitrary scene edits.
 */
export function captureRendererState(T,r) {
  return {target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),
    viewport:r.getViewport(new T.Vector4()),scissor:r.getScissor(new T.Vector4()),scissorTest:r.getScissorTest(),
    xr:r.xr.enabled,shadowAuto:r.shadowMap.autoUpdate,
    autoClear:r.autoClear,autoClearColor:r.autoClearColor,autoClearDepth:r.autoClearDepth,autoClearStencil:r.autoClearStencil,
    toneMapping:r.toneMapping,exposure:r.toneMappingExposure,outputColorSpace:r.outputColorSpace,
    clearColor:r.getClearColor?.(new T.Color()),clearAlpha:r.getClearAlpha?.()};
}
export function restoreRendererState(r,s) {
  r.xr.enabled=s.xr;r.shadowMap.autoUpdate=s.shadowAuto;
  r.autoClear=s.autoClear;r.autoClearColor=s.autoClearColor;r.autoClearDepth=s.autoClearDepth;r.autoClearStencil=s.autoClearStencil;
  r.toneMapping=s.toneMapping;r.toneMappingExposure=s.exposure;r.outputColorSpace=s.outputColorSpace;
  if(s.clearColor)r.setClearColor(s.clearColor,s.clearAlpha);
  r.setRenderTarget(s.target,s.face,s.mip);r.setViewport(s.viewport);r.setScissor(s.scissor);r.setScissorTest(s.scissorTest);
}
