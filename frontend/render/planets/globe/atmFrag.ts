import { SQ } from './lodDetail';

export const ATM_FRAG = /* glsl */ `
${SQ}uniform vec3 uAtm, uSunDir; uniform float uAtmDensity, uRadius, uShell, uOpacity, uAtmStrength, uSunI;
varying vec3 vWP; varying vec3 vC; varying float vS;
void main(){
  vec3 ro = cameraPosition; vec3 rd = normalize(vWP - ro);
  vec3 oc = vC - ro; float tca = dot(oc, rd); float d2 = dot(oc, oc) - tca * tca; float d = sqrt(max(d2, 0.0));
  float R = uRadius * vS; float Rs = R * uShell;
  float glow; vec3 hitN;
  if (d < R) {
    float t0 = tca - sqrt(max(R * R - d2, 0.0));
    hitN = normalize(ro + rd * t0 - vC);
    float cs = sqrt(max(1.0 - d2 / (R * R), 0.0));
    glow = pow(1.0 - cs, 2.4);
  } else {
    float h = clamp((d - R) / (Rs - R), 0.0, 1.0);
    glow = (exp(-h * 5.0) - exp(-5.0)) / (1.0 - exp(-5.0));
    hitN = normalize(ro + rd * tca - vC);
  }
  float nl = dot(hitN, normalize(uSunDir));
  float lit = smoothstep(-0.3, 0.45, nl);
  float twi = exp(-sq(nl / 0.22));
  vec3 col = uAtm * glow * (0.06 + lit * 1.5) * (0.35 + uAtmDensity);
  col += vec3(1.0, 0.5, 0.26) * twi * glow * 0.45 * uAtmDensity;
  col *= uOpacity * uAtmStrength;
  col = clamp(col, 0.0, 60.0);
  gl_FragColor = vec4(col, 1.0);
}`;
