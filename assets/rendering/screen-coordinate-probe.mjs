/** Raw, un-tonemapped window-coordinate material for isolated pixel checks. */
export function createScreenCoordinateProbe(T,{viewportPixels}={}){
  const values=viewportPixels?.isVector4
    ? viewportPixels.toArray()
    : Array.isArray(viewportPixels)?viewportPixels:null;
  if(!T?.RawShaderMaterial||T.REVISION!=='187')throw new TypeError('Screen coordinate probe requires Three r187');
  if(!values||values.length!==4||!values.every(Number.isFinite)||values[2]<=0||values[3]<=0)
    throw new TypeError('viewportPixels must be a finite positive [x,y,width,height] pixel rectangle');
  return new T.RawShaderMaterial({
    glslVersion:T.GLSL3,
    uniforms:{uViewportPixels:{value:new T.Vector4(...values)}},
    vertexShader:`
      in vec3 position;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      void main(){
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }
    `,
    fragmentShader:`
      precision highp float;
      uniform vec4 uViewportPixels;
      out vec4 outColor;
      void main(){
        vec2 localPixels=gl_FragCoord.xy-uViewportPixels.xy;
        outColor=vec4(localPixels/uViewportPixels.zw,0.0,1.0);
      }
    `,
    toneMapped:false,
    depthTest:false,
    depthWrite:false
  });
}
