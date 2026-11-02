import type * as THREE from 'three';
import { glslFloat } from '../shaderInject';
import { ShaderPluginRegistry } from './registries';

/** Name of the construction scaffold shader modifier (`createUnifiedColonyMaterial({ plugins: [BUILD_SCAFFOLD] })`). */
export const BUILD_SCAFFOLD = 'buildScaffold';

/**
 * Laser cut height of each scaffold stage (0 %, 33 %, 66 %) as a fraction of the model's height. Tuned on the Command
 * Hub (6.59 m: cuts at 0.25 m, 1.65 m and 3.85 m), so the hub looks exactly as before and every other building is cut
 * at the same proportions of its own height (RN-14).
 */
export const SCAFFOLD_CUT_FRACTIONS = [0.25 / 6.59, 1.65 / 6.59, 3.85 / 6.59] as const;

const [CUT0, CUT1, CUT2] = SCAFFOLD_CUT_FRACTIONS.map(glslFloat);

/** Quantized stage (`uBuildStage`, set on the CPU by `setArchetypeBuildProgress`) → amber/cyan holo-lattice above the cut. */
const FRAG_BUILD_SCAFFOLD = /* glsl */ `
        if (uBuildStage < 0.999) {
          float cutY = uBuildHeight * (uBuildStage < 0.16 ? ${CUT0} : (uBuildStage < 0.50 ? ${CUT1} : ${CUT2}));
          float aboveCut = smoothstep(cutY - 0.06, cutY + 0.06, vLocalPos.y);
          float laserBand = exp(-abs(vLocalPos.y - cutY) * 16.0);
          vec3 gCell = abs(fract(vLocalPos * 3.5) - 0.5);
          float lattice = step(min(gCell.x, min(gCell.y, gCell.z)), 0.09);
          vec3 scaffoldColor = mix(vec3(0.08, 0.22, 0.32), vec3(3.4, 1.55, 0.25), lattice);
          diffuseColor.rgb = mix(diffuseColor.rgb, scaffoldColor, aboveCut * 0.88);
          diffuseColor.rgb += vec3(3.8, 1.8, 0.3) * laserBand;
        }`;

ShaderPluginRegistry.registerModifier({
  name: BUILD_SCAFFOLD,
  fragmentDeclarations: /* glsl */ `uniform float uBuildStage;
        uniform float uBuildHeight;`,
  // Per mesh: `uBuildStage` (quantized stage) is what the shader reads.
  createUniforms: (): Record<string, THREE.IUniform> => ({
    uBuildStage: { value: 1 },
    uBuildHeight: { value: 6.59 },
  }),
  fragmentColorChunk: FRAG_BUILD_SCAFFOLD,
});
