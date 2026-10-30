/** GLSL chunks injected into MeshStandardMaterial by the Unified Colony material (see UnifiedColonyMaterial.ts). */

export const VERT_COMMON = /* glsl */ `#include <common>
        attribute vec2 aSurfacePBR;
        attribute vec4 aPartAnim;
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        uniform float uTime;
        uniform float uWalkWeight;`;

/** Pass local pos/normal & decode GPU part animations; `pluginChunk` is appended (plugin vertex transforms). */
export const vertBeginVertex = (pluginChunk: string) => /* glsl */ `#include <begin_vertex>
        vLocalPos = position;
        vObjectNormal = normal;
        vSurfacePBR = aSurfacePBR;

        // GPU Part Animation Decoding (zero CPU bone/matrix overhead)
        float animType = aPartAnim.x;
        vec3 pivot = aPartAnim.yzw;
        if (animType > 0.5 && animType < 1.5) {
          // 1: SpinY — continuous Y-axis rotation (radars, turbines, drills)
          float angle = uTime * 2.5;
          float s = sin(angle);
          float c = cos(angle);
          vec3 rel = transformed - pivot;
          transformed.x = pivot.x + rel.x * c - rel.z * s;
          transformed.z = pivot.z + rel.x * s + rel.z * c;
        } else if (animType >= 1.5 && animType < 2.5) {
          // 2: HoverBob — vertical sinusoidal oscillation
          transformed.y += sin(uTime * 4.0 + pivot.x * 3.1) * 0.05;
        } else if (animType >= 2.5 && animType < 3.5) {
          // 3: RecoilPulse — impulse along local +Z (barrels, thumpers, beacons)
          transformed.z -= pow(max(sin(uTime * 5.0 + pivot.x * 2.3), 0.0), 6.0) * 0.06;
        } else if (animType >= 3.5 && animType < 4.5) {
          // 4: BipedLeg — coupled hip pitch + knee tuck + asymmetric foot clearance
          float phase = (pivot.x >= 0.0) ? 0.0 : 3.14159265;
          float tau = uTime * 5.0 + phase;
          float s = sin(tau);
          float c = cos(tau);
          float relY = transformed.y - pivot.y;
          float relZ = transformed.z - pivot.z;
          float legT = clamp(-relY / max(pivot.y, 0.1), 0.0, 1.0);
          float kneeT = clamp((legT - 0.45) / 0.55, 0.0, 1.0);
          float hipAngle = s * 0.18 * uWalkWeight;
          float ch = cos(hipAngle);
          float sh = sin(hipAngle);
          float y1 = relY * ch - relZ * sh;
          float z1 = relY * sh + relZ * ch;
          float lift = max(0.0, c);
          y1 += legT * (abs(s) * 0.038 + lift * 0.045) * uWalkWeight;
          z1 -= kneeT * lift * 0.055 * uWalkWeight;
          transformed.y = pivot.y + y1;
          transformed.z = pivot.z + z1;
        } else if (animType >= 4.5 && animType < 5.5) {
          // 5: BipedArm — counter-phase shoulder pitch swing
          float phase = (pivot.x >= 0.0) ? 3.14159265 : 0.0;
          float tau = uTime * 5.0 + phase;
          float armAngle = sin(tau) * 0.16 * uWalkWeight;
          float ca = cos(armAngle);
          float sa = sin(armAngle);
          float ry = transformed.y - pivot.y;
          float rz = transformed.z - pivot.z;
          transformed.y = pivot.y + ry * ca - rz * sa;
          transformed.z = pivot.z + ry * sa + rz * ca;
        } else if (animType >= 5.5 && animType < 6.5) {
          // 6: SpiderLeg — alternating tripod/diagonal coxa yaw + stepping lift arc
          float phase = ((pivot.x >= 0.0) ? 0.0 : 3.14159265) + pivot.z * 4.9;
          float tau = uTime * 5.0 + phase;
          float sideSign = (pivot.x >= 0.0) ? 1.0 : -1.0;
          float yaw = sideSign * sin(tau) * 0.14 * uWalkWeight;
          float cy = cos(yaw);
          float sy = sin(yaw);
          float rx = transformed.x - pivot.x;
          float rz = transformed.z - pivot.z;
          float radial = clamp(length(vec2(rx, rz)) / 0.50, 0.0, 1.0);
          transformed.x = pivot.x + rx * cy - rz * sy;
          transformed.z = pivot.z + rx * sy + rz * cy;
          transformed.y += radial * max(0.0, cos(tau)) * 0.075 * uWalkWeight;
        } else if (animType >= 6.5 && animType < 7.5) {
          // 7: WheelSpin — continuous X-axis rolling rotation around wheel axle
          float wa = uTime * 4.0 * uWalkWeight;
          float cw = cos(wa);
          float sw = sin(wa);
          float wy = transformed.y - pivot.y;
          float wz = transformed.z - pivot.z;
          transformed.y = pivot.y + wy * cw - wz * sw;
          transformed.z = pivot.z + wy * sw + wz * cw;
        }
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
