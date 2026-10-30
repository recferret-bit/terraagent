import { GLSL_NOISE } from './glslNoise';

export const DOME_VERT = /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; }`;

export const DOME_FRAG = /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uZenith, uHorizon, uCloudColor, uSunDir, uSunColor, uBandColor, uNebA, uNebB;
      uniform float uSpace, uCloud, uSunDisc, uHorizonH, uBandUp, uBandI, uNebI, uTime, uOpt;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 sky = vec3(0.0);
        if (uOpt < 0.5 || uSpace < 0.999) {
          float h = d.y;
          float hh = clamp((h - uHorizonH) / max(1.0 - uHorizonH, 0.2), 0.0, 1.0);
          sky = mix(uHorizon, uZenith, pow(hh, 0.42));
          float band = exp(-(((h - uHorizonH - uBandUp) / 0.14) * ((h - uHorizonH - uBandUp) / 0.14)));
          sky += uBandColor * band * uBandI;
        }
        // deep space: faint base + galactic band + nebula wisps
        vec3 bn = normalize(vec3(0.3, 0.8, -0.5));
        float gal = exp(-(dot(d, bn) * 2.6) * (dot(d, bn) * 2.6));
        float n1 = uOpt > 0.5 ? fbm3Dome(d * 2.4 + 3.0) : fbm3lo(d * 2.4 + 3.0);
        float w1 = smoothstep(0.38, 0.85, n1);
        float n2 = (uOpt > 0.5 && w1 < 0.002 && gal < 0.04) ? 0.5 : (uOpt > 0.5 ? fbm3Dome(d * 5.0 - 7.0) : fbm3lo(d * 5.0 - 7.0));
        vec3 neb = mix(uNebA, uNebB, smoothstep(0.35, 0.7, n2)) * pow(w1, 2.2) * (0.35 + gal * 1.4);
        vec3 space = vec3(0.004, 0.005, 0.011) + neb * uNebI + vec3(0.5,0.55,0.7) * gal * (n2 * n2 * n2) * 0.05;
        vec3 col = mix(sky, space, uSpace);
        col = mix(col, uCloudColor, uCloud);
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 14.0 + pow(sd, 60.0) * 0.5 + pow(sd, 6.0) * 0.07 * (1.0 - uSpace * 0.6)) * uSunDisc * (1.0 - uCloud);
        gl_FragColor = vec4(col, 1.0);
      }`;

export const STAR_POINT_VERT = /* glsl */ `
      attribute vec3 aCol; attribute float aSize; attribute float aPh;
      uniform float uTime, uPR; varying vec3 vC;
      void main(){
        float tw = 0.82 + 0.18 * sin(uTime * (0.8 + aPh * 0.3) + aPh * 9.0);
        vC = aCol * tw; gl_PointSize = aSize * uPR;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`;


export const STAR_POINT_FRAG = /* glsl */ `
      uniform float uOpacity; varying vec3 vC;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0; float a = smoothstep(1.0, 0.0, r); a *= a;
        gl_FragColor = vec4(vC * a * uOpacity, 1.0); }`;
