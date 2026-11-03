# Particle Validator Checks & Mathematical Thresholds

## 1. Perceptual Colour Contrast (`LOW_LAYER_CONTRAST`)
- Layer hex colours (`0xRRGGBB`) are converted from sRGB (`0..255`) to linear RGB via inverse gamma:
  $$C_{\text{lin}} = \begin{cases} C_{\text{srgb}} / 12.92 & C_{\text{srgb}} \le 0.04045 \\ ((C_{\text{srgb}} + 0.055)/1.055)^{2.4} & \text{otherwise} \end{cases}$$
- Linear RGB is transformed to CIE XYZ (D65 illuminant) and then to CIE $L^*a^*b^*$.
- Euclidean distance in $L^*a^*b^*$ space between the highest-count `primary` layer and highest-count `secondary` layer:
  $$\Delta E_{76} = \sqrt{(L_1^* - L_2^*)^2 + (a_1^* - a_2^*)^2 + (b_1^* - b_2^*)^2}$$
- **Threshold:** $\Delta E_{76} \ge 15.0$ (Error if $< 15.0$). Built-in presets maintain $\Delta E_{76} \in [38, 66]$.

## 2. 60 / 30 / 10 Role Hierarchy (`MISSING_ROLE`, `ROLE_RATIO_SKEW`)
Let $N = \sum_i \text{count}_i$ be the total instance count of a preset:
- `primaryShare` $= \sum_{i \in \text{primary}} \text{count}_i / N \in [0.42, 0.70]$ (target $\approx 0.56$)
- `secondaryShare` $= \sum_{i \in \text{secondary}} \text{count}_i / N \in [0.18, 0.42]$ (target $\approx 0.31$)
- `accentShare` $= \sum_{i \in \text{accent}} \text{count}_i / N \in [0.05, 0.25]$ (target $\approx 0.13$)

## 3. Selective HDR Bloom & Facet Shading (`EMISSIVE_TOO_LOW`, `PRIMARY_EMISSIVE_BLOWOUT`)
- The Tabletop Diorama viewport (`diorama-viewport-auditor`) configures `UnrealBloomPass` with `threshold: 1.1`.
- Every `role: 'accent'` layer and `preset.toolBeam` must have `emissiveIntensity >= 3.0` so cutting sparks and beams bloom reliably even at grazing angles.
- Conversely, `role: 'primary'` layers must keep `emissiveIntensity < 1.5` so their 3D faceted normals catch directional sunlight and ambient occlusion rather than blowing out into flat white silhouettes.

## 4. Ballistic Ground Interaction (`NO_GROUND_BOUNCE`, `PHYSICS_INVALID`)
- At least one `primary` or `secondary` layer must configure `bounce >= 0.15`.
- Every layer must satisfy:
  - `count > 0`
  - `0 < sizeRange[0] <= sizeRange[1] <= 0.8`
  - `0 < lifetimeRange[0] <= lifetimeRange[1] <= 6.0`
  - `0 < gravity <= 30`
  - `0 <= drag <= 15`
  - `0 <= bounce <= 0.95`
- Every `ToolBeamSpec` must satisfy `beamRadius > 0`, `sweepRadius >= 0`, `pulseFreq > 0`, and `emissiveIntensity >= 3.0`.

## 5. Instance & Triangle Budgets (`PARTICLE_BUDGET`)
- Total instances per work emitter: $\sum_i \text{count}_i \le 180$.
- Total instanced triangles per work emitter: $\sum_i \text{count}_i \times \text{tris}(\text{geometry}_i) \le 3,500$.
