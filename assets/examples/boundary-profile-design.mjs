/** Current example's numeric section recipes, metres. No geometry or topic rules.
 * Every call returns fresh arrays. Clear widths are checked before construction.
 */
function dimensions(width,height){if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)throw new RangeError('Boundary section width/height must be positive finite');}
export function frameBoundaryProfile(width,height){dimensions(width,height);return [[0,0],[1,0],[1,.35],[.82,.35],[.82,1],[.58,1],[.50,.8],[.18,.8],[.08,.55],[0,.55]].map(([x,z])=>[x*width,z*height]);}
export function solidBoundaryProfile(width,height){dimensions(width,height);return [[0,-1],[0,-.22],[-.22,-.22],[-.22,0],[-.69,0],[-.69,-.14],[-1,-.14],[-1,-1]].map(([x,z])=>[x*width,z*height]);}
export function containerBoundaryProfile(width,height){dimensions(width,height);return [[0,0],[0,.82],[-.23,1],[-.72,1],[-1,.82],[-1,0]].map(([x,z])=>[x*width,z*height]);}
