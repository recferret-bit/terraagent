/** GLSL chunks injected into MeshStandardMaterial by the Unified Colony material (see UnifiedColonyMaterial.ts). */

export const VERT_COMMON = /* glsl */ `#include <common>
        attribute vec2 aSurfacePBR;
        attribute vec4 aPartAnim;
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        uniform float uTime;`;

/** Pass local pos/normal & decode GPU part animations; `pluginChunk` is appended (plugin vertex transforms). */
export const vertBeginVertex = (pluginChunk: string) => /* glsl */ `#include <begin_vertex>
        vLocalPos = position;
        vObjectNormal = normal;
        vSurfacePBR = aSurfacePBR;

        // GPU Part Animation Decoding
        float animType = aPartAnim.x;
        vec3 pivot = aPartAnim.yzw;
        if (animType > 0.5 && animType < 1.5) {
          float angle = uTime * 2.5;
          float s = sin(angle);
          float c = cos(angle);
          vec3 rel = transformed - pivot;
          transformed.x = pivot.x + rel.x * c - rel.z * s;
          transformed.z = pivot.z + rel.x * s + rel.z * c;
        } else if (animType >= 1.5 && animType < 2.5) {
          transformed.y += sin(uTime * 4.0 + pivot.x * 3.1) * 0.05;
        } else if (animType >= 2.5 && animType < 3.5) {
          // Recoil / pulse along local +Z (barrels, thumpers, engine pulse)
          transformed.z -= pow(max(sin(uTime * 5.0 + pivot.x * 2.3), 0.0), 6.0) * 0.06;
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
