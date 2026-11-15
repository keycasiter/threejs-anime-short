/**
 * Records uncaught browser/runtime errors and successful Three.js render calls.
 * It is a health probe, not a pixel-visibility or visual-quality test.
 */
export function createRuntimeHealthProbe({canvas, target=globalThis.window, now=()=>performance.now()}={}) {
  if(!target||typeof target.addEventListener!=='function'||typeof target.removeEventListener!=='function'){
    throw new TypeError('a browser-like event target is required');
  }
  if(typeof now!=='function')throw new TypeError('now must be a function');
  const observedCanvas=canvas??target.document?.querySelector?.('canvas')??null;
  const state={startedAt:now(),firstRenderAt:null,frames:0,drawCalls:null,contextLost:false,errors:[],droppedErrors:0};
  const record=(kind,detail={})=>{
    if(state.errors.length>=100){state.droppedErrors++;return;}
    state.errors.push({kind,at:now(),...detail});
  };
  const onError=event=>record('error',{
    message:String(event?.message??event?.error?.message??'Resource or script error'),
    file:event?.filename??event?.target?.src??event?.target?.href??null,
    line:Number.isFinite(event?.lineno)?event.lineno:null,
    column:Number.isFinite(event?.colno)?event.colno:null
  });
  const onRejection=event=>record('unhandledrejection',{
    message:String(event?.reason?.stack??event?.reason??'Unhandled promise rejection')
  });
  const onContextLost=()=>{state.contextLost=true;record('webglcontextlost',{message:'WebGL context lost'});};
  target.addEventListener('error',onError,true);
  target.addEventListener('unhandledrejection',onRejection);
  observedCanvas?.addEventListener?.('webglcontextlost',onContextLost);

  const probe={
    markFrame(renderer){
      state.firstRenderAt??=now();
      state.frames++;
      const calls=renderer?.info?.render?.calls;
      state.drawCalls=Number.isFinite(calls)?calls:null;
      return probe.snapshot();
    },
    snapshot(){
      const status=state.errors.length||state.droppedErrors||state.contextLost?'issue':state.frames?'clear':'pending';
      return {...state,status,errors:state.errors.map(item=>({...item}))};
    },
    dispose(){
      target.removeEventListener('error',onError,true);
      target.removeEventListener('unhandledrejection',onRejection);
      observedCanvas?.removeEventListener?.('webglcontextlost',onContextLost);
      if(target.__threeRuntimeProbe===probe)delete target.__threeRuntimeProbe;
    }
  };
  target.__threeRuntimeProbe=probe;
  return probe;
}
