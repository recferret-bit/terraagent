import * as THREE from 'three';

let shaderPatched = false;

const SOFT_SHADOW_HELPERS_GLSL = /* glsl */ `
float taTexelCompare( sampler2D shadowMap, vec2 shadowMapSize, vec2 texelSize, vec2 uv, float compare ) {
	vec2 st = uv * shadowMapSize - 0.5;
	vec2 baseUv = ( floor( st ) + 0.5 ) * texelSize;
	vec2 f = fract( st );
	f = f * f * ( 3.0 - 2.0 * f );
	float c00 = texture2DCompare( shadowMap, baseUv, compare );
	float c10 = texture2DCompare( shadowMap, baseUv + vec2( texelSize.x, 0.0 ), compare );
	float c01 = texture2DCompare( shadowMap, baseUv + vec2( 0.0, texelSize.y ), compare );
	float c11 = texture2DCompare( shadowMap, baseUv + texelSize, compare );
	return mix( mix( c00, c10, f.x ), mix( c01, c11, f.x ), f.y );
}

float taSampleShadowSoft( sampler2D shadowMap, vec2 shadowMapSize, float shadowRadius, vec3 shadowCoord ) {
	vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
	float rScale = max( 0.25, shadowRadius );
	vec2 searchStep = texelSize * ( 1.25 * rScale );
	float d0 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy ) );
	float d1 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + vec2( searchStep.x, 0.0 ) ) );
	float d2 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy - vec2( searchStep.x, 0.0 ) ) );
	float d3 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + vec2( 0.0, searchStep.y ) ) );
	float d4 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy - vec2( 0.0, searchStep.y ) ) );
	float bSum = 0.0;
	float bCnt = 0.0;
	float g0 = shadowCoord.z - d0; if ( g0 > 0.00004 ) { bSum += g0; bCnt += 1.0; }
	float g1 = shadowCoord.z - d1; if ( g1 > 0.00008 ) { bSum += g1; bCnt += 1.0; }
	float g2 = shadowCoord.z - d2; if ( g2 > 0.00008 ) { bSum += g2; bCnt += 1.0; }
	float g3 = shadowCoord.z - d3; if ( g3 > 0.00008 ) { bSum += g3; bCnt += 1.0; }
	float g4 = shadowCoord.z - d4; if ( g4 > 0.00008 ) { bSum += g4; bCnt += 1.0; }
	// All 5 probes agree (fully lit / deep inside a shadow): no edge under the kernel, the 36 filter reads below
	// would end in the same 1 / 0 after the final smoothstep. Most pixels take this exit; only penumbrae filter.
	if ( bCnt < 0.5 ) return 1.0;
	if ( bCnt > 4.5 ) return 0.0;
	float avgGap = bCnt > 0.0 ? ( bSum / bCnt ) : 0.0;
	float penumbra = mix( 0.20, 1.15, smoothstep( 0.002, 0.045, avgGap ) ) * rScale;
	float rIn = 0.48 * penumbra;
	float rOut = 0.98 * penumbra;
	float zIn = shadowCoord.z - 0.00010 * rIn;
	float zOut = shadowCoord.z - 0.00014 * rOut;
	vec2 sIn = texelSize * rIn;
	vec2 sOut = texelSize * ( rOut * 0.70710678 );
	float s = taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy, shadowCoord.z ) * 0.34;
	s += (
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( sIn.x, 0.0 ), zIn ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy - vec2( sIn.x, 0.0 ), zIn ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( 0.0, sIn.y ), zIn ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy - vec2( 0.0, sIn.y ), zIn )
	) * 0.115;
	s += (
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( sOut.x, sOut.y ), zOut ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( -sOut.x, sOut.y ), zOut ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( sOut.x, -sOut.y ), zOut ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( -sOut.x, -sOut.y ), zOut )
	) * 0.05;
	return smoothstep( 0.08, 0.92, s );
}
`;

/**
 * Upgrades Three.js's built-in directional shadow shader chunk so that:
 * 1) `PCFSoftShadowMap` uses a 9-tap contact-hardening smooth cubic-bilinear disk kernel (`taSampleShadowSoft`)
 *    that eliminates blocky texel stair-stepping, keeps small-object contact shadows crisp, and softens tall shadows;
 *    its 5-read blocker search exits early when every probe agrees (lit / deep shadow), so the 36-read filter only
 *    runs in penumbrae (the filter was ~90 % of the shadow cost at 4K: every screen pixel paid 41 reads per light),
 * 2) Cast directional shadows also attenuate indirect hemisphere/IBL irradiance for high-contrast outdoor readability.
 * 3) A light whose shadow intensity is 0 skips its shadow taps entirely (a uniform, so the branch is coherent): the
 *    daytime-skipped secondary shadow (F8 → PERF) costs no per-pixel work without toggling `castShadow`.
 */
export function installShadowShaderPatch(): void {
  if (shaderPatched) return;
  shaderPatched = true;
  const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (pars && !pars.includes('taSampleShadowSoft')) {
    const withHelpers = pars.replace(
      'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowRadius, vec4 shadowCoord ) {',
      `${SOFT_SHADOW_HELPERS_GLSL}\n\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowRadius, vec4 shadowCoord ) {`,
    ).replace(
      'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
      `${SOFT_SHADOW_HELPERS_GLSL}\n\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {`,
    );
    THREE.ShaderChunk.shadowmap_pars_fragment = withHelpers.replace(
      /#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \)[\s\S]*?\* \( 1\.0 \/ 9\.0 \);/,
      `#elif defined( SHADOWMAP_TYPE_PCF_SOFT )\n\t\t\tshadow = taSampleShadowSoft( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz );`,
    );
  }
  const begin = THREE.ShaderChunk.lights_fragment_begin;
  const end = THREE.ShaderChunk.lights_fragment_end;
  if (begin && end && !begin.includes('taDirShadow')) {
    THREE.ShaderChunk.lights_fragment_begin =
      `float taDirShadow = 1.0;\nfloat taShadowStrength = 0.0;\n` +
      begin.replace(
        'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
        `if ( directLight.visible && receiveShadow && directionalLightShadow.shadowIntensity > 0.0 ) {\n\t\t\tfloat sVal = getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, 1.0, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );\n\t\t\t#if defined( TA_TERRAIN_SHADER )\n\t\t\t\tfloat taSlope = 1.0 - normalize( vLN ).y;\n\t\t\t\tvec2 taCliffHorizN = vLN.xz / max( length( vLN.xz ), 1e-4 );\n\t\t\t\tvec3 taSunWorld = inverseTransformDirection( directLight.direction, viewMatrix );\n\t\t\t\tvec2 taSunHoriz = taSunWorld.xz / max( length( taSunWorld.xz ), 1e-4 );\n\t\t\t\tfloat taSelfLit = smoothstep( -0.22, 0.16, dot( taCliffHorizN, taSunHoriz ) );\n\t\t\t\tfloat taCliffBright = smoothstep( 0.0, 0.02, vRock ) * smoothstep( 0.02, 0.08, taSlope );\n\t\t\t\tfloat taCliffDark = smoothstep( 0.22, 0.75, vRock ) * smoothstep( 0.04, 0.14, taSlope );\n\t\t\t\tsVal = max( sVal, taSelfLit * taCliffBright );\n\t\t\t\tsVal = min( sVal, mix( 1.0, taSelfLit, taCliffDark ) );\n\t\t\t#endif\n\t\t\tfloat taLightS = mix( 1.0, sVal, clamp( directionalLightShadow.shadowIntensity, 0.0, 1.0 ) );\n\t\t\ttaDirShadow = min( taDirShadow, taLightS );\n\t\t\ttaShadowStrength = max( taShadowStrength, directionalLightShadow.shadowIntensity );\n\t\t\tdirectLight.color *= taLightS;\n\t\t}`,
      );
    THREE.ShaderChunk.lights_fragment_end =
      `#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )\n\tfloat taAmbOcc = mix( 1.0, 0.36, clamp( ( 1.0 - taDirShadow ) * ( 0.72 * taShadowStrength ), 0.0, 1.0 ) );\n\t#if defined( RE_IndirectDiffuse )\n\t\tirradiance *= taAmbOcc;\n\t#endif\n\t#if defined( RE_IndirectSpecular )\n\t\tiblIrradiance *= taAmbOcc;\n\t\tradiance *= mix( 1.0, taAmbOcc, 0.70 );\n\t#endif\n#endif\n` +
      end;
  }
}
