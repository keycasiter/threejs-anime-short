// Real headless Chrome integration tests. No mocked browser, screenshots or CDP.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../render_film.mjs',import.meta.url));

async function fixture(t,body){
 const dir=await mkdtemp(join(tmpdir(),'film-contract-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const html=join(dir,'film.html'),out=join(dir,'rendered');
 await writeFile(html,`<!doctype html><meta charset="utf-8"><style>body{margin:0;overflow:hidden}canvas{display:block}#title{position:absolute;top:8px;left:8px;color:white;font:20px sans-serif}</style>${body}`);
 return {html,out};
}
function exportFilm(f,extra=[],times='0,0.5'){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script,'--html',f.html,'--out',f.out,'--times',times,'--width','320','--height','180',...extra],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Exporter did not finish within 45 seconds'));},45000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,output});});
 });
}
const stable=`<canvas id="stage" width="320" height="180"></canvas><div id="title"></div><script>
window.__FILM={duration:2,fps:2};
window.renderAt=t=>{const c=document.getElementById('stage').getContext('2d');c.fillStyle=t<1?'navy':'teal';c.fillRect(0,0,320,180);document.getElementById('title').textContent='Time '+t.toFixed(2);};
window.renderAt(0);window.__ready=true;
</script>`;

test('exports deterministic final viewport without requiring a canvas ID',async t=>{
 const f=await fixture(t,stable);const r=await exportFilm(f);assert.equal(r.code,0,r.output);
 const m=JSON.parse(await readFile(join(f.out,'manifest.json'),'utf8'));
 assert.equal(m.deterministic,true);assert.equal(m.determinism.scope,'viewport');
 assert.deepEqual(m.samples.map(s=>s.t),[0,.5]);
 for(const s of m.samples){
  assert.match(s.sha256,/^[a-f0-9]{64}$/);
  const png=await readFile(join(f.out,s.file));assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),180);
 }
});

test('rejects history-dependent DOM titles even when the canvas is unchanged',async t=>{
 const f=await fixture(t,`<canvas id="film" width="320" height="180"></canvas><div id="title"></div><script>
let n=0;window.__FILM={duration:2,fps:2};window.renderAt=t=>{const c=document.getElementById('film').getContext('2d');c.fillStyle='navy';c.fillRect(0,0,320,180);document.getElementById('title').textContent='Title '+(++n);};window.renderAt(0);window.__ready=true;</script>`);
 const r=await exportFilm(f);assert.notEqual(r.code,0,r.output);assert.match(r.output,/Random-access frame changed/);
 await assert.rejects(readFile(join(f.out,'manifest.json')),{code:'ENOENT'});
});

test('rejects history-dependent canvas pixels',async t=>{
 const f=await fixture(t,`<canvas id="film" width="320" height="180"></canvas><script>
let n=0;window.__FILM={duration:2,fps:2};window.renderAt=t=>{const c=document.getElementById('film').getContext('2d');c.fillStyle='rgb('+(++n*20)+',0,80)';c.fillRect(0,0,320,180);};window.renderAt(0);window.__ready=true;</script>`);
 const r=await exportFilm(f);assert.notEqual(r.code,0,r.output);assert.match(r.output,/Random-access frame changed/);
});

test('rejects asynchronous renderAt with an explicit contract error',async t=>{
 const f=await fixture(t,`<canvas id="film"></canvas><script>window.__FILM={duration:2,fps:2};window.renderAt=async t=>{};window.__ready=true;</script>`);
 const r=await exportFilm(f);assert.notEqual(r.code,0,r.output);assert.match(r.output,/renderAt.*synchronous/i);
});

test('retains runtime error gating before accepting a completed export',async t=>{
 const f=await fixture(t,stable.replace("window.__ready=true;","console.error('Required asset failed');window.__ready=true;"));
 const r=await exportFilm(f);assert.notEqual(r.code,0,r.output);assert.match(r.output,/Required asset failed/);
});

test('invalidates prior success when a new export fails in the same directory',async t=>{
 const f=await fixture(t,stable);const first=await exportFilm(f);assert.equal(first.code,0,first.output);
 const original=await readFile(f.html,'utf8');
 await writeFile(f.html,original.replace("document.getElementById('title').textContent='Time '+t.toFixed(2)","document.getElementById('title').textContent='History '+Math.random()"));
 const retry=await exportFilm(f);assert.notEqual(retry.code,0,retry.output);assert.match(retry.output,/Random-access frame changed/);
 await assert.rejects(readFile(join(f.out,'manifest.json')),{code:'ENOENT'});
});

test('keeps adjacent sample files distinct and their hashes traceable',async t=>{
 const f=await fixture(t,stable.replace('toFixed(2)','toFixed(4)'));
 const r=await exportFilm(f,[],'0,0.0004');assert.equal(r.code,0,r.output);
 const m=JSON.parse(await readFile(join(f.out,'manifest.json'),'utf8'));
 assert.equal(new Set(m.samples.map(s=>s.file)).size,2);
 for(const s of m.samples){const saved=await readFile(join(f.out,s.file));assert.equal(createHash('sha256').update(saved).digest('hex'),s.sha256);}
});

test('shorter video rerender excludes stale frames from the previous export',async t=>{
 const audio=`window.renderWav=rate=>{const b=new Uint8Array(44+rate*4),v=new DataView(b.buffer);const text=(i,s)=>{for(let j=0;j<s.length;j++)v.setUint8(i+j,s.charCodeAt(j));};text(0,'RIFF');v.setUint32(4,b.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,b.length-44,true);return b;};`;
 const f=await fixture(t,stable.replace('window.__ready=true;',audio+'window.__ready=true;'));
 const first=await exportFilm(f,['--video']);assert.equal(first.code,0,first.output);
 const original=await readFile(f.html,'utf8');await writeFile(f.html,original.replace('duration:2,fps:2','duration:0.5,fps:2'));
 const second=await exportFilm(f,['--video']);assert.equal(second.code,0,second.output);
 const m=JSON.parse(await readFile(join(f.out,'manifest.json'),'utf8'));
 const video=m.video.streams.find(s=>s.codec_type==='video');assert.equal(video.nb_frames,'1');assert.equal(Number(video.duration),.5);
});

test('leaves the sampled time before checking a single seek sample',async t=>{
 const f=await fixture(t,`<canvas id="stage" width="320" height="180"></canvas><script>
let previous=-1,n=0;window.__FILM={duration:2,fps:2};window.renderAt=t=>{if(t!==previous){n++;previous=t;}const c=document.getElementById('stage').getContext('2d');c.fillStyle='rgb('+(n*30)+',0,80)';c.fillRect(0,0,320,180);};window.renderAt(0);window.__ready=true;</script>`);
 const r=await exportFilm(f,[],'1.86');assert.notEqual(r.code,0,r.output);assert.match(r.output,/Random-access frame changed/);
});
