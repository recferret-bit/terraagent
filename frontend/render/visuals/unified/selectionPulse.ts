import { ShaderPluginRegistry } from './registries';

export const SELECTION_PULSE = 'selectionPulse';
ShaderPluginRegistry.registerModifier({
  name: SELECTION_PULSE,
  fragmentDeclarations: 'uniform float uSelected; uniform float uSelectionTime;',
  createUniforms: () => ({ uSelected: { value: 0 }, uSelectionTime: { value: 0 } }),
  fragmentColorChunk: `
    float selectionPulse = 0.5 + 0.5 * sin(uSelectionTime * 4.0);
    diffuseColor.rgb += uSelected * vec3(1.0, 0.25, 0.025) * (0.18 + 0.35 * selectionPulse);
  `,
});
