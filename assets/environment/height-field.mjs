// Original quintic value-noise fBm with analytic world-coordinate derivatives.
const finite=(n,name)=>{if(!Number.isFinite(n))throw new Error(`${name} must be finite`);return n;};
const positive=(n,name)=>{finite(n,name);if(n<=0)throw new Error(`${name} must be positive`);return n;};
const smooth=t=>t*t*t*(t*(t*6-15)+10);
const derivative=t=>30*t*t*(t-1)*(t-1);
function hash(x,z,seed){let h=Math.imul(x|0,0x1f123bb5)^Math.imul(z|0,0x5f356495)^seed;h=Math.imul(h^(h>>>16),0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);return ((h^(h>>>16))>>>0)/4294967295*2-1;}
function valueNoise(x,z,seed){
 const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,sx=smooth(fx),sz=smooth(fz);
 const a=hash(ix,iz,seed),b=hash(ix+1,iz,seed),c=hash(ix,iz+1,seed),d=hash(ix+1,iz+1,seed),lo=a+(b-a)*sx,hi=c+(d-c)*sx;
 return {value:lo+(hi-lo)*sz,dx:derivative(fx)*((b-a)*(1-sz)+(d-c)*sz),dz:derivative(fz)*(hi-lo)};
}
export function createFractalHeightField({seed=1,baseHeight=0,amplitude=4,baseFrequency=.05,octaves=4,persistence=.5,lacunarity=2}={}){
 if(!Number.isInteger(seed))throw new Error('seed must be an integer');finite(baseHeight,'baseHeight');finite(amplitude,'amplitude');if(amplitude<0)throw new Error('amplitude must be nonnegative');positive(baseFrequency,'baseFrequency');
 if(!Number.isInteger(octaves)||octaves<1||octaves>16)throw new Error('octaves must be an integer in 1..16');
 finite(persistence,'persistence');if(persistence<0||persistence>1)throw new Error('persistence must be in 0..1');positive(lacunarity,'lacunarity');
 const config=Object.freeze({seed,baseHeight,amplitude,baseFrequency,octaves,persistence,lacunarity});
 let total=0,weight=1;for(let i=0;i<octaves;i++){total+=weight;weight*=persistence;}
 const scale=amplitude/total;
 function sample(x,z){
  finite(x,'x');finite(z,'z');let height=0,dx=0,dz=0,f=baseFrequency,w=1;
  for(let i=0;i<octaves;i++){const n=valueNoise(x*f,z*f,(seed^Math.imul(i+1,0x9e3779b9))|0);height+=w*n.value;dx+=w*f*n.dx;dz+=w*f*n.dz;f*=lacunarity;w*=persistence;}
  return {height:baseHeight+scale*height,dx:scale*dx,dz:scale*dz};
 }
 return Object.freeze({config,sample,heightAt:(x,z)=>sample(x,z).height,normalAt:(x,z)=>{const s=sample(x,z),l=Math.hypot(s.dx,1,s.dz);return [s.dx===0?0:-s.dx/l,1/l,s.dz===0?0:-s.dz/l];}});
}
export function createHeightFieldGeometry(T,field,{sizeX=40,sizeZ=40,segmentsX=80,segmentsZ=80,center=[0,0]}={}){
 positive(sizeX,'sizeX');positive(sizeZ,'sizeZ');
 for(const [name,v] of Object.entries({segmentsX,segmentsZ}))if(!Number.isInteger(v)||v<1||v>2048)throw new Error(`${name} must be an integer in 1..2048`);
 if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite))throw new Error('center must be finite xz');
 const p=[],n=[],uv=[],idx=[];
 for(let j=0;j<=segmentsZ;j++)for(let i=0;i<=segmentsX;i++){
  const x=center[0]+(i/segmentsX-.5)*sizeX,z=center[1]+(j/segmentsZ-.5)*sizeZ,s=field.sample(x,z),l=Math.hypot(s.dx,1,s.dz);
  p.push(x,s.height,z);n.push(-s.dx/l,1/l,-s.dz/l);uv.push(x,z);
 }
 for(let j=0;j<segmentsZ;j++)for(let i=0;i<segmentsX;i++){const a=j*(segmentsX+1)+i,b=a+1,c=a+segmentsX+1,d=c+1;idx.push(a,c,b,b,c,d);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeBoundingBox();g.computeBoundingSphere();return g;
}
