/** GLSL chunks injected into MeshStandardMaterial by the Unified Colony material (see UnifiedColonyMaterial.ts). */

export const VERT_COMMON = /* glsl */ `#include <common>
        attribute vec2 aSurfacePBR;
        attribute vec4 aPartAnim;
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        uniform float uTime;
        uniform float uWalkWeight;

        vec3 bipedBodyTransform(vec3 p, float g, float w) {
          vec3 c = vec3(0.0, 0.92, 0.0);
          vec3 r = p - c;
          float roll = -cos(g) * 0.055 * w;
          float pitch = sin(g * 2.0 - 0.4) * 0.048 * w;
          float yaw = -sin(g) * 0.075 * w;
          float cr = cos(roll), sr = sin(roll);
          float rx1 = r.x * cr - r.y * sr;
          float ry1 = r.x * sr + r.y * cr;
          float cp = cos(pitch), sp = sin(pitch);
          float ry2 = ry1 * cp - r.z * sp;
          float rz2 = ry1 * sp + r.z * cp;
          float cy = cos(yaw), sy = sin(yaw);
          float rx3 = rx1 * cy - rz2 * sy;
          float rz3 = rx1 * sy + rz2 * cy;
          float heaveY = (-cos(g * 2.0) * 0.022 - sin(g * 2.0) * 0.012) * w;
          float swayX = -cos(g) * 0.036 * w;
          float surgeZ = sin(g * 2.0) * 0.025 * w;
          return c + vec3(rx3 + swayX, ry2 + heaveY, rz3 + surgeZ);
        }

        vec3 spiderBodyTransform(vec3 p, float g, float w) {
          vec3 c = vec3(0.0, 0.76, 0.0);
          vec3 r = p - c;
          float roll = sin(g - 0.25) * 0.095 * w;
          float pitch = sin(g * 2.0 - 0.45) * 0.068 * w;
          float yaw = cos(g) * 0.065 * w;
          float cr = cos(roll), sr = sin(roll);
          float rx1 = r.x * cr - r.y * sr;
          float ry1 = r.x * sr + r.y * cr;
          float cp = cos(pitch), sp = sin(pitch);
          float ry2 = ry1 * cp - r.z * sp;
          float rz2 = ry1 * sp + r.z * cp;
          float cy = cos(yaw), sy = sin(yaw);
          float rx3 = rx1 * cy - rz2 * sy;
          float rz3 = rx1 * sy + rz2 * cy;
          float heaveY = (-cos(g * 2.0) * 0.044 - sin(g * 2.0) * 0.026) * w;
          float swayX = cos(g) * 0.042 * w;
          float surgeZ = sin(g * 2.0) * 0.034 * w;
          return c + vec3(rx3 + swayX, ry2 + heaveY, rz3 + surgeZ);
        }`;

const VERT_SUB_ANIM = /* glsl */ `
        // 1..3: Local secondary animations (standalone or mounted on a moving body carrier)
        if (abs(animType - 1.0) < 0.1 || abs(subAnim - 1.0) < 0.1) {
          float angle = (animType > 7.5) ? g : uTime * 2.5;
          float s = sin(angle);
          float c = cos(angle);
          vec3 rel = transformed - pivot;
          transformed.x = pivot.x + rel.x * c - rel.z * s;
          transformed.z = pivot.z + rel.x * s + rel.z * c;
        } else if (abs(animType - 2.0) < 0.1 || abs(subAnim - 2.0) < 0.1) {
          float bobAmp = (animType > 7.5) ? 0.025 : 0.05;
          float bobFreq = (animType > 7.5) ? g : uTime * 4.0;
          transformed.y += sin(bobFreq + pivot.x * 3.1) * bobAmp;
        } else if (abs(animType - 3.0) < 0.1 || abs(subAnim - 3.0) < 0.1) {
          transformed.z -= pow(max(sin(g + pivot.x * 2.3), 0.0), 6.0) * 0.06;
        }`;

const VERT_GAIT_ANIM = /* glsl */ `
        // 4..9: 100% Rigid-body locomotion gaits & full-body step-reaction carriers (zero part distortion)
        if (abs(animType - 4.0) < 0.1) {
          // 4 (Thigh), 14 (Shin+Ankle) & 24 (Foot): Rigid 3-link bipedal kinematic chain
          float phase = (pivot.x >= 0.0) ? 0.0 : 3.14159265;
          float tau = g + phase;
          float s = sin(tau);
          float lift = max(0.0, cos(tau));
          vec3 dh = bipedBodyTransform(pivot, g, uWalkWeight) - pivot;
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
          // 5: BipedArm — rigid counter-phase shoulder pitch swing riding on BipedBody
          float phase = (pivot.x >= 0.0) ? 3.14159265 : 0.0;
          float tau = g + phase;
          float armAngle = sin(tau) * 0.22 * uWalkWeight;
          float ca = cos(armAngle);
          float sa = sin(armAngle);
          float ry = transformed.y - pivot.y;
          float rz = transformed.z - pivot.z;
          transformed.y = pivot.y + ry * ca - rz * sa;
          transformed.z = pivot.z + ry * sa + rz * ca;
          transformed = bipedBodyTransform(transformed, g, uWalkWeight);
        } else if (abs(animType - 6.0) < 0.1) {
          // 6 (Femur) & 16 (Tibia+Foot): Rigid 2-link spider kinematic chain
          float phase = ((pivot.x >= 0.0) ? 0.0 : 3.14159265) + pivot.z * 4.9;
          float tau = g + phase;
          float sideSign = (pivot.x >= 0.0) ? 1.0 : -1.0;
          float yaw = sideSign * sin(tau) * 0.18 * uWalkWeight;
          float cy = cos(yaw), sy = sin(yaw);
          vec3 dh = spiderBodyTransform(pivot, g, uWalkWeight) - pivot;
          float stepLift = pow(max(0.0, cos(tau)), 0.8) * 0.10 * uWalkWeight;
          float femAngle = sideSign * (stepLift - dh.y + 0.004 * uWalkWeight) / max(abs(pivot.x), 0.20);
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
          // 7: WheelSpin — continuous X-axis rolling rotation around wheel axle
          float wa = uTime * 4.0 * uWalkWeight;
          float cw = cos(wa);
          float sw = sin(wa);
          float wy = transformed.y - pivot.y;
          float wz = transformed.z - pivot.z;
          transformed.y = pivot.y + wy * cw - wz * sw;
          transformed.z = pivot.z + wy * sw + wz * cw;
        } else if (abs(animType - 8.0) < 0.1) {
          // 8 (and 18, 28, 38): BipedBody step-reaction carrier
          transformed = bipedBodyTransform(transformed, g, uWalkWeight);
        } else if (abs(animType - 9.0) < 0.1) {
          // 9 (and 19, 29, 39): SpiderBody step-reaction carrier
          transformed = spiderBodyTransform(transformed, g, uWalkWeight);
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
        `;

export const FRAG_COMMON = /* glsl */ `#include <common>
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        uniform float uTime;
        uniform vec3 uBiomeDustColor;
        uniform vec3 uRimTint;
        uniform float uWeatheringHeight;
        uniform float uWeatheringIntensity;
        uniform float uTriplanarScale;
        uniform float uRimStrength;

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

/** Triplanar grain, ground-up weathering, top-down gradient; `pluginChunk` is appended (plugin colour chunks). */
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

/** Subtle Fresnel silhouette rim light before output. */
export const FRAG_RIM = /* glsl */ `// Add subtle Fresnel silhouette rim light before output
        float fresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.2);
        outgoingLight += uRimTint * fresnel * uRimStrength;
        #include <opaque_fragment>`;
