// Offline animation exporter. Renders owned source artifacts, not a browser/UI audit.
// Requires Node 22+, Chrome and ffmpeg. No browser extension or npm dependency.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateVideoProbe} from './video-contract.mjs';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
if(!arg('--html'))throw Error('Usage: node render_film.mjs --html film.html --out directory [--times seconds,...] [--video]');
const html=resolve(arg('--html')),out=resolve(arg('--out','rendered')),width=Number(arg('--width',1280)),height=Number(arg('--height',720));
const sourceHash=createHash('sha256').update(await readFile(html)).digest('hex');
const chrome=process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const temp=await mkdtemp(join(tmpdir(),'film-export-'));await mkdir(out,{recursive:true});
// The manifest is a completion marker, not evidence for a failed retry.
await rm(join(out,'manifest.json'),{force:true});
let proc,ws,id=0,sessionId;const pending=new Map(),errors=[];let stderr='';
let captureMode='sync',frameTimeoutMs=120000,rpcTimeoutMs=120000;const captureCalls=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function send(method,params={},sid=sessionId){return new Promise((ok,no)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);no(Error(`CDP timeout ${method}`))},rpcTimeoutMs);pending.set(n,{ok,no,timer});ws.send(JSON.stringify({id:n,method,params,...(sid?{sessionId:sid}:{})}))})}
async function evaluate(expression){const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result?.value}
function receive(e){const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);return}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));}
function failOnErrors(){if(errors.length)throw Error('Film runtime errors: '+JSON.stringify(errors))}
async function command(file,a){const p=spawn(file,a,{stdio:['ignore','pipe','pipe']});let result='',err='';p.stdout.on('data',d=>result+=d);p.stderr.on('data',d=>err+=d);const code=await new Promise((r,j)=>{p.on('error',j);p.on('close',r)});if(code!==0)throw Error(`${file}: ${err}`);return result}
const sha256=data=>createHash('sha256').update(data).digest('hex');
async function captureAt(t){
 if(captureMode==='sync') {
  await evaluate(`(()=>{const result=window.renderAt(${t});if(result&&typeof result.then==='function')throw Error('renderAt must be synchronous unless __FILM.capture.mode is awaited');return true})()`);
 } else {
  const report=await evaluate(`(async()=>{const t=${t},limit=${frameTimeoutMs},started=performance.now();let timer;try{
   const result=await Promise.race([Promise.resolve().then(()=>window.renderAt(t)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Capture timed out at '+t+'s')),limit)})]);
   if(performance.now()-started>limit)throw Error('Capture exceeded timeout at '+t+'s');
   if(!result||result.complete!==true||result.time!==t)throw Error('Awaited renderAt must report complete:true and the requested time');
   const hasCounts=result.completedSamples!==undefined||result.requiredSamples!==undefined;
   if(hasCounts&&(!Number.isInteger(result.completedSamples)||!Number.isInteger(result.requiredSamples)||result.requiredSamples<1||result.completedSamples!==result.requiredSamples))throw Error('Capture sample budget incomplete at '+t+'s');
   return {time:t,complete:true,...(hasCounts?{completedSamples:result.completedSamples,requiredSamples:result.requiredSamples}:{})};
  }finally{clearTimeout(timer)}})()`);
  captureCalls.push(report);
 }
 failOnErrors();const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});failOnErrors();return Buffer.from(r.data,'base64');
}
async function frame(t,path){const png=await captureAt(t);await writeFile(path,png);return png}
try{
 proc=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${join(temp,'profile')}`,'--force-device-scale-factor=1','--autoplay-policy=no-user-gesture-required','about:blank'],{stdio:['ignore','ignore','pipe']});proc.stderr.on('data',d=>{stderr=(stderr+d).slice(-6000)});
 let port,route;for(let n=0;n<200;n++){if(proc.exitCode!==null)throw Error(`Chrome failed: ${stderr}`);try{[port,route]=(await readFile(join(temp,'profile/DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break}catch{}await delay(100)}if(!port)throw Error('Chrome port unavailable: '+stderr);
 ws=new WebSocket(`ws://127.0.0.1:${port}${route}`);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});ws.addEventListener('message',receive);
 const target=await send('Target.createTarget',{url:'about:blank'},null);({sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null));
 await send('Runtime.enable');await send('Page.enable');await send('Log.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:pathToFileURL(html).href+'?still=1&'+arg('--query','')});
 let ready=false;for(let n=0;n<300;n++){ready=await evaluate('Boolean(window.__ready)');failOnErrors();if(ready)break;await delay(100)}if(!ready)throw Error('Film never became ready');
 const info=await evaluate("(()=>{if(window.__ready!==true)throw Error('__ready must be true');if(typeof window.renderAt!=='function')throw Error('Missing renderAt(seconds)');document.body.classList.add('render-mode');document.querySelector('#start')?.classList.add('hidden');return window.__FILM})()");
 if(!info||!Number.isFinite(info.duration)||info.duration<=0||!Number.isFinite(info.fps)||info.fps<=0)throw Error('Missing positive __FILM duration/fps contract');
 captureMode=info.capture?.mode??'sync';
 if(!['sync','awaited'].includes(captureMode))throw Error('Unknown capture mode');
 frameTimeoutMs=info.capture?.timeoutMs??120000;
 if(!Number.isFinite(frameTimeoutMs)||frameTimeoutMs<=0)throw Error('Capture timeoutMs must be positive');
 rpcTimeoutMs=Math.max(120000,frameTimeoutMs+5000);
 await evaluate('document.fonts ? document.fonts.ready.then(()=>true) : true');
 const times=arg('--times')===undefined?[0,info.duration/2,info.duration]:arg('--times').split(',').map(Number);if(times.some(t=>!Number.isFinite(t)||t<0||t>info.duration))throw Error('Invalid sample times');
 const samples=[],sampleFiles=new Set();for(const t of times){const stem=`frame-${t.toFixed(3)}`,file=sampleFiles.has(stem+'.png')?`${stem}-${samples.length}.png`:stem+'.png';sampleFiles.add(file);const png=await frame(t,join(out,file));samples.push({t,file,sha256:sha256(png)});console.log(`Sample ${t}s`)}
 // Compare exactly what is exported: the viewport, including canvas and DOM.
 const probeCandidates=[info.duration*.93,0,info.duration,...times.map((_,i)=>info.duration*((i+.5)/(times.length+1)))];
 const seekProbe=probeCandidates.find(t=>!times.includes(t));if(seekProbe===undefined)throw Error('No distinct representable seek probe available');
 await captureAt(seekProbe);const checks=[];
 for(let i=times.length-1;i>=0;i--){const actual=sha256(await captureAt(times[i]));if(samples[i].sha256!==actual)throw Error(`Random-access frame changed at ${times[i]}s`);checks.push({t:times[i],sha256:actual})}
 const metrics=await evaluate('window.filmMetrics?.()||null');
 let video=null,videoArtifact=null,audioMode=null;
 if(args.includes('--video')){
  const hasWav=await evaluate('typeof window.renderWav==="function"');
  audioMode=info.audio??(hasWav?'wav':'none');
  if(!['none','wav'].includes(audioMode))throw Error('Audio must be none or wav');
  if(audioMode==='wav'){
   if(!hasWav)throw Error('Audio wav requires renderWav');
   const audio=await evaluate("(()=>{const b=window.renderWav(22050);if(!(b instanceof Uint8Array)||b.length<44)throw Error('renderWav must synchronously return WAV Uint8Array');let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s)})()");
   await writeFile(join(out,'score.wav'),Buffer.from(audio,'base64'));
  }
  const frames=join(out,'frames');await mkdir(frames,{recursive:true});const total=Math.ceil(info.duration*info.fps);const start=Date.now();
  for(let f=0;f<total;f++){await frame(f/info.fps,join(frames,`${String(f).padStart(5,'0')}.png`));if(f%48===0)console.log(`Frames ${f}/${total}; elapsed ${Math.round((Date.now()-start)/1000)}s`)}
  const audioInputs=audioMode==='wav'?['-i',join(out,'score.wav')]:[];
  const audioOutput=audioMode==='wav'?['-c:a','aac','-b:a','160k','-shortest']:['-an'];
  await command('ffmpeg',['-y','-loglevel','error','-framerate',String(info.fps),'-i',join(frames,'%05d.png'),...audioInputs,'-frames:v',String(total),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',...audioOutput,'-movflags','+faststart',join(out,'film.mp4')]);
  const videoPath=join(out,'film.mp4');
  video=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',videoPath]));
  const totalFrames=Math.ceil(info.duration*info.fps);
  validateVideoProbe(video,{width,height,fps:info.fps,totalFrames,audioMode});
  videoArtifact={path:'film.mp4',sha256:sha256(await readFile(videoPath))};
 }
 failOnErrors();if(sha256(await readFile(html))!==sourceHash)throw Error('Source HTML changed during export');await writeFile(join(out,'manifest.json'),JSON.stringify({status:'PASS',sourceHash,html,query:arg('--query',''),width,height,...info,samples,deterministic:true,determinism:{scope:'viewport',method:'sha256-png',sampleTimes:times,seekProbe,checks},metrics,errors,audioMode,videoArtifact,captureContract:{mode:captureMode,timeoutMs:frameTimeoutMs,calls:captureCalls},video},null,2));console.log(`Export verified: ${out}`);
}finally{
 // Cleanup must not obscure the original shader/page/render failure.
 try{if(ws?.readyState===1)await send('Browser.close',{},null)}catch{}try{ws?.close()}catch{}
 if(proc&&proc.exitCode===null){proc.kill('SIGTERM');await Promise.race([new Promise(r=>proc.once('exit',r)),delay(3000)])}
 for(const p of pending.values())clearTimeout(p.timer);
 try{await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150})}catch(e){console.warn('Profile cleanup: '+e.message)}
}
