/** GLSL chunks injected into MeshStandardMaterial by the Unified Colony material (see UnifiedColonyMaterial.ts). */
import { COLONY_VISION_AND_LIGHTS_GLSL } from '../../lighting/ColonyVisionAndLights';

export const VERT_COMMON = /* glsl */ `#include <common>
        attribute vec2 aSurfacePBR;
        attribute vec4 aPartAnim;
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        varying vec3 vTaWorldPos;
        varying vec3 vTaWorldNormal;
        uniform float uTime;
        uniform float uWalkWeight;
        uniform float uWorkWeight;

        // Body sway shared by the biped and spider carriers: roll about Z, then pitch about X, then yaw about Y.
        vec3 rotateRollPitchYaw(vec3 r, float roll, float pitch, float yaw) {
          float cr = cos(roll), sr = sin(roll);
          float rx1 = r.x * cr - r.y * sr;
          float ry1 = r.x * sr + r.y * cr;
          float cp = cos(pitch), sp = sin(pitch);
          float ry2 = ry1 * cp - r.z * sp;
          float rz2 = ry1 * sp + r.z * cp;
          float cy = cos(yaw), sy = sin(yaw);
          float rx3 = rx1 * cy - rz2 * sy;
          float rz3 = rx1 * sy + rz2 * cy;
          return vec3(rx3, ry2, rz3);
        }

        vec3 bipedBodyTransform(vec3 p, float g, float w, float wk) {
          vec3 c = vec3(0.0, 0.92, 0.0);
          vec3 r = p - c;
          float roll = -cos(g) * 0.055 * w + sin(g) * 0.04 * wk;
          float pitch = sin(g * 2.0 - 0.4) * 0.048 * w + (0.09 + sin(g * 2.0) * 0.05) * wk;
          float yaw = -sin(g) * 0.075 * w + cos(g) * 0.08 * wk;
          float heaveY = (-cos(g * 2.0) * 0.022 - sin(g * 2.0) * 0.012) * w + (0.012 + sin(g * 2.0) * 0.012) * wk;
          float swayX = -cos(g) * 0.036 * w + sin(g) * 0.022 * wk;
          float surgeZ = sin(g * 2.0) * 0.025 * w + (0.02 + sin(g * 2.0) * 0.018) * wk;
          return c + (rotateRollPitchYaw(r, roll, pitch, yaw) + vec3(swayX, heaveY, surgeZ));
        }

        vec3 spiderBodyTransform(vec3 p, float g, float w, float wk) {
          vec3 c = vec3(0.0, 0.76, 0.0);
          vec3 r = p - c;
          float roll = sin(g - 0.25) * 0.065 * w + sin(g) * 0.035 * wk;
          float pitch = sin(g * 2.0 - 0.45) * 0.048 * w + (0.06 + sin(g * 2.0) * 0.04) * wk;
          float yaw = cos(g) * 0.050 * w + cos(g) * 0.055 * wk;
          float heaveY = (-cos(g * 2.0) * 0.032 - sin(g * 2.0) * 0.018) * w + (0.01 + sin(g * 2.0) * 0.01) * wk;
          float swayX = cos(g) * 0.030 * w + sin(g) * 0.018 * wk;
          float surgeZ = sin(g * 2.0) * 0.024 * w + (0.015 + sin(g * 2.0) * 0.015) * wk;
          return c + (rotateRollPitchYaw(r, roll, pitch, yaw) + vec3(swayX, heaveY, surgeZ));
        }`;

const VERT_SUB_ANIM = /* glsl */ `
        // 1..3: Local secondary animations (standalone 1..3, or 18..39 mounted on a moving body carrier 8/9)
        bool hasBodyCarrier = animType > 7.5;
        if (abs(animType - 1.0) < 0.1 || (hasBodyCarrier && abs(subAnim - 1.0) < 0.1)) {
          float angle = hasBodyCarrier ? g * (1.0 + uWorkWeight) : uTime * (2.5 + 10.0 * uWorkWeight);
          float s = sin(angle);
          float c = cos(angle);
          vec3 rel = transformed - pivot;
          transformed.x = pivot.x + rel.x * c - rel.z * s;
          transformed.z = pivot.z + rel.x * s + rel.z * c;
        } else if (abs(animType - 2.0) < 0.1 || (hasBodyCarrier && abs(subAnim - 2.0) < 0.1)) {
          float bobAmp = hasBodyCarrier ? 0.025 : 0.05;
          float bobFreq = hasBodyCarrier ? g : uTime * 4.0;
          transformed.y += sin(bobFreq + pivot.x * 3.1) * bobAmp;
        } else if (abs(animType - 3.0) < 0.1 || (hasBodyCarrier && abs(subAnim - 3.0) < 0.1)) {
          float recoilWave = sin(g * (1.0 + uWorkWeight) + pivot.x * 2.3);
          transformed.z -= pow(max(recoilWave, 0.0), 6.0) * 0.06;
        }`;

const VERT_GAIT_ANIM = /* glsl */ `
        // 4..9: 100% Rigid-body locomotion gaits & full-body step-reaction carriers (zero part distortion)
        if (abs(animType - 4.0) < 0.1) {
          // 4 (Thigh), 14 (Shin+Ankle) & 24 (Foot): Rigid 3-link bipedal kinematic chain
          float phase = (pivot.x >= 0.0) ? 0.0 : 3.14159265;
          float tau = g + phase;
          float s = sin(tau);
          float lift = max(0.0, cos(tau));
          vec3 dh = bipedBodyTransform(pivot, g, uWalkWeight, uWorkWeight) - pivot;
          float hipAngle = s * 0.22 * uWalkWeight;
          float ch = cos(hipAngle), sh = sin(hipAngle);
          float ky0 = -0.3173 * pivot.y;
          vec3 kneeRest = vec3(pivot.x, pivot.y + ky0, pivot.z);
          vec3 kneeMoved = vec3(pivot.x + dh.x, pivot.y + dh.y + ky0 * ch, pivot.z + dh.z + ky0 * sh);
          float shinAngle = hipAngle + lift * 0.52 * uWalkWeight;
          float cs = cos(shinAngle), ss = sin(shinAngle);
          if (subAnim < 0.5) {
            float ry = transformed.y - pivot.y;
            float rz = transformed.z - pivot.z;
            transformed = vec3(
              transformed.x + dh.x,
              pivot.y + dh.y + ry * ch - rz * sh,
              pivot.z + dh.z + ry * sh + rz * ch
            );
          } else if (subAnim < 1.5) {
            float uy = transformed.y - kneeRest.y;
            float uz = transformed.z - kneeRest.z;
            transformed = vec3(
              transformed.x + dh.x,
              kneeMoved.y + uy * cs - uz * ss,
              kneeMoved.z + uy * ss + uz * cs
            );
          } else {
            float ay0 = -0.5769 * pivot.y;
            vec3 ankleRest = vec3(pivot.x, kneeRest.y + ay0, pivot.z);
            vec3 ankleMoved = vec3(pivot.x + dh.x, kneeMoved.y + ay0 * cs, kneeMoved.z + ay0 * ss);
            transformed = ankleMoved + (transformed - ankleRest);
          }
        } else if (abs(animType - 5.0) < 0.1) {
          // 5: BipedArm — rigid counter-phase shoulder pitch swing + active dual-axis work sweep riding on BipedBody
          float phase = (pivot.x >= 0.0) ? 3.14159265 : 0.0;
          float sideSign = (pivot.x >= 0.0) ? 1.0 : -1.0;
          float tau = g + phase;
          float workAngle = (-0.62 + sin(g * 2.0 + phase * 0.5) * 0.26) * uWorkWeight;
          float workYaw = sideSign * (-0.10 + cos(g * 2.0 + phase * 0.5) * 0.08) * uWorkWeight;
          float armAngle = sin(tau) * 0.22 * uWalkWeight + workAngle;
          float ca = cos(armAngle), sa = sin(armAngle);
          float cy = cos(workYaw), sy = sin(workYaw);
          vec3 rel = transformed - pivot;
          float ry1 = rel.y * ca - rel.z * sa;
          float rz1 = rel.y * sa + rel.z * ca;
          float rx2 = rel.x * cy - rz1 * sy;
          float rz2 = rel.x * sy + rz1 * cy;
          transformed = pivot + vec3(rx2, ry1, rz2);
          transformed = bipedBodyTransform(transformed, g, uWalkWeight, uWorkWeight);
        } else if (abs(animType - 6.0) < 0.1) {
          // 6 (Femur) & 16 (Tibia+Foot): Rigid 2-link spider kinematic chain
          float phase = ((pivot.x >= 0.0) ? 0.0 : 3.14159265) + pivot.z * 4.9;
          float tau = g + phase;
          float sideSign = (pivot.x >= 0.0) ? 1.0 : -1.0;
          float yaw = sideSign * sin(tau) * 0.18 * uWalkWeight;
          float cy = cos(yaw), sy = sin(yaw);
          vec3 dh = spiderBodyTransform(pivot, g, uWalkWeight, uWorkWeight) - pivot;
          float stepLift = pow(max(0.0, cos(tau)), 0.8) * 0.085 * uWalkWeight;
          float femAngle = sideSign * (stepLift - dh.y + 0.004 * uWalkWeight) / max(abs(pivot.x), 0.25);
          float cf = cos(femAngle), sf = sin(femAngle);
          if (subAnim < 0.5) {
            vec3 r = transformed - pivot;
            float rx1 = r.x * cf - r.y * sf;
            float ry1 = r.x * sf + r.y * cf;
            transformed = pivot + dh + vec3(rx1 * cy - r.z * sy, ry1, rx1 * sy + r.z * cy);
          } else {
            vec3 k0 = vec3(pivot.x, 0.24, 0.5 * pivot.z);
            float kx1 = k0.x * cf - k0.y * sf;
            float ky1 = k0.x * sf + k0.y * cf;
            vec3 kneeMoved = pivot + dh + vec3(kx1 * cy - k0.z * sy, ky1, kx1 * sy + k0.z * cy);
            vec3 u = transformed - (pivot + k0);
            transformed = kneeMoved + vec3(u.x * cy - u.z * sy, u.y, u.x * sy + u.z * cy);
          }
        } else if (abs(animType - 7.0) < 0.1) {
          // 7: WheelSpin — continuous X-axis rolling rotation around wheel axle + bracing rock when working
          float wa = uTime * 4.0 * uWalkWeight + sin(g) * 0.35 * uWorkWeight;
          float cw = cos(wa);
          float sw = sin(wa);
          float wy = transformed.y - pivot.y;
          float wz = transformed.z - pivot.z;
          transformed.y = pivot.y + wy * cw - wz * sw;
          transformed.z = pivot.z + wy * sw + wz * cw;
        } else if (abs(animType - 8.0) < 0.1) {
          // 8 (and 18, 28, 38): BipedBody step-reaction & work-effort carrier
          transformed = bipedBodyTransform(transformed, g, uWalkWeight, uWorkWeight);
        } else if (abs(animType - 9.0) < 0.1) {
          // 9 (and 19, 29, 39): SpiderBody step-reaction & work-effort carrier
          transformed = spiderBodyTransform(transformed, g, uWalkWeight, uWorkWeight);
        }`;

/** Pass local pos/normal & decode GPU part animations; `pluginChunk` is appended (plugin vertex transforms). */
export const vertBeginVertex = (pluginChunk: string) => /* glsl */ `#include <begin_vertex>
        vLocalPos = position;
        vObjectNormal = normal;
        vSurfacePBR = aSurfacePBR;

        // GPU Part Animation Decoding (zero CPU bone/matrix overhead)
        float rawAnim = floor(aPartAnim.x + 0.5);
        float subAnim = floor(rawAnim / 10.0);
        float animType = rawAnim - subAnim * 10.0;
        vec3 pivot = aPartAnim.yzw;
        float g = uTime * 5.0;
        ${VERT_SUB_ANIM}
        ${VERT_GAIT_ANIM}
        ${pluginChunk}
        vTaWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTaWorldNormal = normalize(mat3(modelMatrix) * normal);
        `;

export const FRAG_COMMON = /* glsl */ `#include <common>
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        varying vec3 vTaWorldPos;
        varying vec3 vTaWorldNormal;
        uniform float uTime;
        uniform vec3 uBiomeDustColor;
        uniform vec3 uRimTint;
        uniform float uWeatheringHeight;
        uniform float uWeatheringIntensity;
        uniform float uTriplanarScale;
        uniform float uRimStrength;
        ${COLONY_VISION_AND_LIGHTS_GLSL}

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float triplanarGrain(vec3 pos, vec3 norm, float scale) {
          vec3 b = pow(abs(normalize(norm)), vec3(4.0));
          b /= max(dot(b, vec3(1.0)), 0.0001);
          float gx = hash31(floor(pos.yzx * scale * 20.0));
          float gy = hash31(floor(pos.xzy * scale * 20.0));
          float gz = hash31(floor(pos.xyz * scale * 20.0));
          return gx * b.x + gy * b.y + gz * b.z;
        }`;

/** Triplanar grain, ground-up weathering, top-down gradient; `pluginChunk` (e.g. the build scaffold) is appended. */
export const fragColor = (pluginChunk: string) => /* glsl */ `#include <color_fragment>
        float grain = triplanarGrain(vLocalPos, vObjectNormal, uTriplanarScale);
        // Subtle micro-surface variation
        diffuseColor.rgb *= (0.96 + 0.08 * grain);

        // Vertical Ground-Up Biome Weathering (skipped on HDR emissive zones)
        float isEmissive = step(1.2, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        float heightMask = 1.0 - smoothstep(0.0, uWeatheringHeight, max(vLocalPos.y, 0.0));
        float weatherMix = clamp(heightMask * uWeatheringIntensity * (0.75 + 0.5 * grain), 0.0, 1.0) * (1.0 - isEmissive);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBiomeDustColor, weatherMix);

        // Top-Down Hemisphere Gradient for RTS readability
        float topGrad = mix(0.78, 1.08, clamp(vLocalPos.y * 0.6, 0.0, 1.0));
        diffuseColor.rgb *= mix(topGrad, 1.0, isEmissive);
        ${pluginChunk}
        `;

export const FRAG_ROUGHNESS = /* glsl */ `#include <roughnessmap_fragment>
        if (vSurfacePBR.x > 0.01) {
          roughnessFactor = vSurfacePBR.x;
        }
        roughnessFactor = mix(roughnessFactor, 0.90, clamp(1.0 - smoothstep(0.0, uWeatheringHeight, max(vLocalPos.y, 0.0)), 0.0, 1.0) * uWeatheringIntensity);`;

export const FRAG_METALNESS = /* glsl */ `#include <metalnessmap_fragment>
        if (vSurfacePBR.x > 0.01) {
          metalnessFactor = vSurfacePBR.y;
        }`;

/** Subtle Fresnel silhouette rim light + projector illumination + FoV shroud before output. */
export const FRAG_RIM = /* glsl */ `// Add subtle Fresnel silhouette rim light before output
        // max(): |dot| of two unit vectors rounds to 1.0000001 on view-facing faces; pow(negative) = NaN, which the
        // bloom mip chain spreads into a ~1000 px black square (the descent pod flash)
        float fresnel = pow(max(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0), 3.2);
        vec3 taProj = evalColonyProjectorLight(vTaWorldPos, normalize(vTaWorldNormal));
        outgoingLight += diffuseColor.rgb * taProj + taProj * 0.10;
        outgoingLight += uRimTint * fresnel * uRimStrength * (1.0 - clamp(uNightFactor, 0.0, 1.0) * 0.78);
        outgoingLight = applyColonyFovShroud(vTaWorldPos, outgoingLight);
        #include <opaque_fragment>`;
