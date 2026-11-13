/** Stable semantic selection over real visible scene hits. OutlinePass is borrowed. */
export function createSelectionFeedback(T,{scene,camera,outlinePass,raycaster=new T.Raycaster()}={}) {
  if(!scene?.isScene||!camera?.isCamera)throw new TypeError('scene and camera are required');
  if(!T?.Vector2||!raycaster?.setFromCamera)throw new TypeError('Three.js Vector2 and Raycaster are required');
  const entries=new Map();let selectedId=null,disposed=false;
  const alive=()=>{if(disposed)throw new Error('selection feedback disposed');};
  function visibleHit(hit){
    for(let o=hit.object;o;o=o.parent){
      if(!o.visible)return false;
      if(o.isMesh){
        const material=Array.isArray(o.material)?o.material[hit.face?.materialIndex??0]:o.material;
        if(!material||material.visible===false||(material.transparent&&material.opacity<=0))return false;
      }
    }
    return true;
  }
  function semanticEntry(object){
    for(let o=object;o;o=o.parent){for(const entry of entries.values())if(entry.root===o)return entry;}
    return null;
  }
  function updateOutline(){if(outlinePass)outlinePass.selectedObjects=selectedId===null?[]:[entries.get(selectedId).root];}
  function select(id){alive();if(id!==null&&!entries.has(id))throw new RangeError(`unknown selection id: ${id}`);selectedId=id;updateOutline();return selectedId;}
  function register(id,root){
    alive();if(typeof id!=='string'||id.length===0)throw new TypeError('selection id must be a non-empty string');
    if(!root?.isObject3D||root===scene||!scene.getObjectById(root.id))throw new TypeError('selection root must be an Object3D attached to scene');
    if(entries.has(id))throw new Error(`duplicate selection id: ${id}`);
    for(const entry of entries.values())if(entry.root===root)throw new Error('selection root is already registered');
    const entry={id,root};entries.set(id,entry);
    return()=>{if(entries.get(id)!==entry)return false;entries.delete(id);if(selectedId===id)select(null);return true;};
  }
  function pick(clientX,clientY,rect){
    alive();if(![clientX,clientY,rect?.left,rect?.top,rect?.width,rect?.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)throw new TypeError('finite pointer and positive CSS rect required');
    const x=(clientX-rect.left)/rect.width,y=(clientY-rect.top)/rect.height;
    if(x<0||x>1||y<0||y>1){select(null);return {id:null,hit:null};}
    raycaster.setFromCamera(new T.Vector2(x*2-1,1-y*2),camera);
    scene.updateMatrixWorld(true);
    const hit=raycaster.intersectObject(scene,true).find(visibleHit)??null;
    const entry=hit?semanticEntry(hit.object):null;
    select(entry?.id??null);
    return {id:selectedId,hit};
  }
  function readState(){return {selectedId,registered:entries.size,disposed};}
  function dispose(){if(disposed)return;select(null);entries.clear();disposed=true;}
  return {register,select,pick,clear:()=>select(null),readState,dispose};
}
