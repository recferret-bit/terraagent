export const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vC; varying float vS;
void main(){
  vObj = position; vWN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz;
  vC = modelMatrix[3].xyz; vS = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
