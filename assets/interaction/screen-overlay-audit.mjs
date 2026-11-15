const finite=Number.isFinite;
const nonnegative=value=>finite(value)&&value>=0;

function readRect(value,name){
 if(!value||![value.left,value.top,value.right,value.bottom].every(finite))throw new TypeError(`${name} must have finite left, top, right and bottom`);
 if(value.right<=value.left||value.bottom<=value.top)throw new RangeError(`${name} must have positive width and height`);
 return {left:value.left,top:value.top,right:value.right,bottom:value.bottom};
}
function readEntries(entries,name){
 if(!Array.isArray(entries))throw new TypeError(`${name} must be an array`);
 const ids=new Set();
 return entries.map((entry,index)=>{
  if(!entry||typeof entry.id!=='string'||!entry.id.trim())throw new TypeError(`${name}[${index}].id must be a non-empty string`);
  const id=entry.id.trim();if(ids.has(id))throw new TypeError(`${name} IDs must be unique: ${id}`);ids.add(id);
  return {id,rect:readRect(entry.rect,`${name}[${index}].rect`)};
 });
}
function intersectionArea(a,b){
 const width=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
 const height=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 return width*height;
}
function overflow(rect,bounds){
 return {
  left:Math.max(0,bounds.left-rect.left),top:Math.max(0,bounds.top-rect.top),
  right:Math.max(0,rect.right-bounds.right),bottom:Math.max(0,rect.bottom-bounds.bottom)
 };
}
function hasOverflow(value){return Object.values(value).some(x=>x>0)}

/**
 * Audit measured screen-space rectangles without changing their placement.
 * Coordinates are CSS pixels in one shared viewport coordinate system.
 */
export function auditScreenOverlays({viewport,items,reserved=[],safeInsets={},allowOverlap=[],minOverlapArea=0}={}){
 if(!viewport||![viewport.left,viewport.top,viewport.width,viewport.height].every(finite)||viewport.width<=0||viewport.height<=0)throw new TypeError('viewport needs finite left/top and positive width/height');
 if(!safeInsets||typeof safeInsets!=='object')throw new TypeError('safeInsets must be an object');
 const inset={left:safeInsets.left??0,top:safeInsets.top??0,right:safeInsets.right??0,bottom:safeInsets.bottom??0};
 if(!Object.values(inset).every(nonnegative)||inset.left+inset.right>=viewport.width||inset.top+inset.bottom>=viewport.height)throw new RangeError('safeInsets must leave a positive interior viewport');
 const checkSafeArea=Object.values(inset).some(value=>value>0);
 if(!finite(minOverlapArea)||minOverlapArea<0)throw new RangeError('minOverlapArea must be finite and nonnegative');
 const labels=readEntries(items,'items'),reservedEntries=readEntries(reserved,'reserved');
 const ids=new Set(labels.map(x=>x.id)),allowed=new Set();
 if(!Array.isArray(allowOverlap))throw new TypeError('allowOverlap must be an array of ID pairs');
 for(const pair of allowOverlap){
  if(!Array.isArray(pair)||pair.length!==2||pair.some(id=>typeof id!=='string'||!ids.has(id)))throw new TypeError('allowOverlap pairs must reference two existing item IDs');
  if(pair[0]===pair[1])throw new TypeError('allowOverlap pair IDs must differ');
  allowed.add([...pair].sort().join('\0'));
 }
 const bounds={left:viewport.left,top:viewport.top,right:viewport.left+viewport.width,bottom:viewport.top+viewport.height};
 const safe={left:bounds.left+inset.left,top:bounds.top+inset.top,right:bounds.right-inset.right,bottom:bounds.bottom-inset.bottom};
 const violations=[];
 for(const item of labels){
  const outside=overflow(item.rect,bounds);if(hasOverflow(outside))violations.push({type:'outside-viewport',id:item.id,overflow:outside});
  if(checkSafeArea){const unsafe=overflow(item.rect,safe);if(hasOverflow(unsafe))violations.push({type:'outside-safe-area',id:item.id,overflow:unsafe});}
  for(const zone of reservedEntries){const area=intersectionArea(item.rect,zone.rect);if(area>minOverlapArea)violations.push({type:'reserved-overlap',id:item.id,reservedId:zone.id,area});}
 }
 for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
  const a=labels[i],b=labels[j];if(allowed.has([a.id,b.id].sort().join('\0')))continue;
  const area=intersectionArea(a.rect,b.rect);if(area>minOverlapArea){const [first,second]=[a.id,b.id].sort();violations.push({type:'label-overlap',a:first,b:second,area});}
 }
 const order={'outside-viewport':0,'outside-safe-area':1,'reserved-overlap':2,'label-overlap':3};
 violations.sort((a,b)=>order[a.type]-order[b.type]||String(a.id??a.a).localeCompare(String(b.id??b.a))||String(a.reservedId??a.b??'').localeCompare(String(b.reservedId??b.b??'')));
 return {status:violations.length?'FAIL':'PASS',checked:labels.length,violations};
}
