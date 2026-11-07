import type * as THREE from 'three';

/** Three packed attributes keep merged anatomy + instance matrices within WebGL's 16-slot minimum. */
export const INSTANCE_ATTRIBUTES = { aInsectMotion: 4, aInsectAction: 4, aInsectFlags: 2 } as const;
const SOURCES = {
  uTime: 'aInsectMotion.x', uWalkWeight: 'aInsectMotion.y', uWorkWeight: 'aInsectMotion.z',
  uInsectWalk: 'aInsectMotion.w', uInsectAction: 'aInsectAction', uInsectSacSide: 'aInsectFlags.x',
};

/** Same pose functions for single meshes and batches; only their state inputs change. */
export function useInsectInstanceAttributes(material: THREE.Material): void {
  const compile = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:insect-instances-v2`;
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    for (const [name, source] of Object.entries(SOURCES)) {
      shader.vertexShader = shader.vertexShader.replace(new RegExp(`uniform (float|vec4) ${name};`), '');
      shader.vertexShader = shader.vertexShader.replace(new RegExp(`\\b${name}\\b`, 'g'), source);
    }
    shader.vertexShader = `attribute vec4 aInsectMotion;\nattribute vec4 aInsectAction;\nattribute vec2 aInsectFlags;\n${shader.vertexShader}`;
    if (shader.fragmentShader.includes('uniform float uSelected;')) {
      shader.vertexShader = `varying float vInstanceSelected;\n${shader.vertexShader}`
        .replace('void main() {', 'void main() {\nvInstanceSelected = aInsectFlags.y;');
      shader.fragmentShader = shader.fragmentShader.replace('uniform float uSelected;', 'varying float vInstanceSelected;')
        .replace(/\buSelected\b/g, 'vInstanceSelected');
    }
  };
}
