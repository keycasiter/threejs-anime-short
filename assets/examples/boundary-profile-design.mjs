/** Current example's numeric section recipes, metres. No geometry or topic rules.
 * Every call returns fresh arrays. Clear widths are checked before construction.
 */
function dimensions(width,height){if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)throw new RangeError('Boundary section width/height must be positive finite');}
export function frameBoundaryProfile(width,height){dimensions(width,height);return [[0,0],[1,0],[1,.35],[.82,.35],[.82,1],[.58,1],[.50,.8],[.18,.8],[.08,.55],[0,.55]].map(([x,z])=>[x*width,z*height]);}
export function solidBoundaryProfile(width,height){dimensions(width,height);return [[0,-1],[0,-.22],[-.22,-.22],[-.22,0],[-.69,0],[-.69,-.14],[-1,-.14],[-1,-1]].map(([x,z])=>[x*width,z*height]);}
export function containerBoundaryProfile(width,height){dimensions(width,height);return [[0,0],[0,.82],[-.23,1],[-.72,1],[-1,.82],[-1,0]].map(([x,z])=>[x*width,z*height]);}

/** Example-author stock declaration. The bay's actual bore and section sizes
 * remain authoritative; the generic contour source only receives metric charts.
 * A bow is one bottom member plus one ordered right-jamb/head/left-jamb rail.
 */
export function frameStockCharts(stock,{variant,contour,frameWidth,frameDepth}){
 if(!stock||typeof stock!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(stock))||Reflect.ownKeys(stock).length!==1||!Object.hasOwn(stock,'mode'))throw new TypeError('Bay frameStock requires only mode');
 const {mode}=stock;
 if(!['independent-rails','continuous-bow-with-sill'].includes(mode))throw new RangeError('Bay frameStock mode is unsupported');
 dimensions(frameWidth,frameDepth);
 const rect=mode==='independent-rails',N=contour?.length;
 if((rect&&variant!=='rect')||(!rect&&variant!=='arch')||!Array.isArray(contour)||contour.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new RangeError('Bay frameStock/source topology mismatch');
 const [left,right]=contour;
 const same=(a,b)=>Math.abs(a-b)<=1e-9;
 if(!left||!right||!same(left[1],right[1])||!(right[0]>left[0]))throw new RangeError('Bay frameStock requires an ordered lower sill');
 if(rect){
  if(N!==4||!same(contour[2][0],right[0])||!same(contour[3][0],left[0])||!same(contour[2][1],contour[3][1])||!(contour[2][1]>right[1]))throw new RangeError('Bay frameStock requires four rectangular members');
 }else{
  if(N<11||!same(contour[2][0],right[0])||!same(contour[N-1][0],left[0])||!same(contour[2][1],contour[N-1][1])||!(contour[2][1]>right[1])||contour.slice(3,N-1).some((p,i)=>!(p[0]<contour[i+2][0])||!(p[1]>contour[2][1])))throw new RangeError('Bay frameStock requires ordered jambs and bow');
 }
 return {referenceOutsetM:frameWidth/2,depthDatumM:frameDepth/2,closedSeam:'reject',pieces:rect?Array.from({length:N},(_,firstSegment)=>({firstSegment,segmentCount:1,mode:'member'})):[{firstSegment:0,segmentCount:1,mode:'member'},{firstSegment:1,segmentCount:N-1,mode:'rail'}]};
}
