#!/usr/bin/env node
// .agents/skills/ai-mesh-pipeline/scripts/sanitize-glb.mjs
import { parseArgs } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  weld,
  simplify,
  dedup,
  prune,
  textureCompress,
  center,
  normals,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

/**
 * Sanitizes a raw AI-generated or Blender-exported .glb file for Three.js RTS performance.
 */
export async function sanitizeAiGlb({
  inputPath,
  outputPath,
  maxTris = 3500,
  texSize = 512,
  minRoughness = 0.45,
  maxMetalness = 0.75,
}) {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(inputPath);

  // Count initial triangles
  const countTriangles = (doc) => {
    let tris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const pos = prim.getAttribute('POSITION');
        tris += indices ? indices.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
      }
    }
    return Math.round(tris);
  };

  const initialTris = countTriangles(document);
  const targetRatio = initialTris > maxTris ? Math.max(0.02, maxTris / initialTris) : 1.0;

  await document.transform(
    dedup(),
    weld({ tolerance: 0.0005 }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: targetRatio,
      error: 0.015,
    }),
    normals({ overwrite: false }),
    // Snap pivot to bottom-center (Y = 0) so buildings sit flush on hex tiles
    center({ pivot: 'below' }),
    textureCompress({
      targetFormat: 'webp',
      resize: [texSize, texSize],
    }),
    prune()
  );

  // Normalize PBR materials so AI models don't look like wet plastic
  for (const material of document.getRoot().listMaterials()) {
    const r = material.getRoughnessFactor();
    const m = material.getMetallicFactor();
    material.setRoughnessFactor(Math.max(r, minRoughness));
    material.setMetallicFactor(Math.min(m, maxMetalness));
  }

  await io.write(outputPath, document);
  const finalTris = countTriangles(document);

  console.log(
    `[sanitize-glb] ${inputPath} -> ${outputPath} | Tris: ${initialTris} -> ${finalTris} | Tex: <=${texSize}px WebP`
  );
  return { initialTris, finalTris, outputPath };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      'max-tris': { type: 'string', default: '3500' },
      'tex-size': { type: 'string', default: '512' },
      'min-roughness': { type: 'string', default: '0.45' },
    },
  });

  if (!values.input || !values.output) {
    console.error(
      'Usage: node sanitize-glb.mjs --input <raw.glb> --output <clean.glb> [--max-tris 3500] [--tex-size 512]'
    );
    process.exit(1);
  }

  sanitizeAiGlb({
    inputPath: values.input,
    outputPath: values.output,
    maxTris: Number(values['max-tris']),
    texSize: Number(values['tex-size']),
    minRoughness: Number(values['min-roughness']),
  }).catch((err) => {
    console.error('[sanitize-glb] Failed:', err);
    process.exit(1);
  });
}
