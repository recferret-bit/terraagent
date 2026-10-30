# Procedural Gait, Coupled Kinematics & Zero-CPU Animation Math

This reference documents the mathematical equations powering `TerraAgent`'s GPU vertex-shader animation system (`frontend/render/visuals/unified/shaderChunks.ts` and `frontend/render/kitbash/validate/poses.ts`).

---

## 1. Affine Pivot Transformation in Local Space

To rotate a rigid sub-part around an arbitrary 3D mechanical hinge $\mathbf{p}_{\text{pivot}} = (p_x, p_y, p_z)$ without `THREE.Bone` matrices:

$$\mathbf{p}' = \mathbf{p}_{\text{pivot}} + \mathbf{R}(\theta) \cdot (\mathbf{p} - \mathbf{p}_{\text{pivot}}) + \mathbf{T}_{\text{clearance}}(\mathbf{p} - \mathbf{p}_{\text{pivot}}, \tau)$$

Because `vLocalPos = position` is captured **before** `transformed` is displaced in `vertBeginVertex`, procedural triplanar surface grain (`triplanarGrain(vLocalPos, ...)`) remains locked to the metal armor plates rather than swimming through space as limbs move.

---

## 2. Coupled 2-Link Bipedal Stride (`animType = 4`) + Arm Counter-Swing (`animType = 5`)

### Phase Coupling
Bipedal balance requires left and right limbs to alternate by $\pi$ radians ($180^\circ$), and each arm to swing in opposition to its same-side leg:
- **Leg Phase (`animType = 4`):** $\phi_{\text{leg}}(p_x) = \begin{cases} 0 & p_x \ge 0 \\ \pi & p_x < 0 \end{cases}$
- **Arm Phase (`animType = 5`):** $\phi_{\text{arm}}(p_x) = \begin{cases} \pi & p_x \ge 0 \\ 0 & p_x < 0 \end{cases}$

### Rigid 3-Link Hip-Knee-Ankle Chain (`animType = 4, 14, 24`) & Biped Body Carrier (`animType = 8`)
Every mechanical link MUST be a **100% rigid body** ($\mathbf{p}' = \mathbf{R}_{\text{link}}\mathbf{p} + \mathbf{T}_{\text{link}}$ with $\mathbf{R}_{\text{link}} \in SO(3)$ depending only on `pivot`, never on vertex position $\mathbf{p}$).

To give a bipedal mech visible mass, footstep impact, and hip-torso suspension (`bipedBodyTransform` around center of mass $\mathbf{c} = (0, 0.92, 0)$ with gait clock $g = 5.0 t$):
- **Double-frequency ($2\omega$) step-impact heave:**
  $$\Delta y_{\text{heave}} = w_{\text{walk}} \left(-0.022\cos(2g) - 0.012\sin(2g)\right)$$
- **Lateral weight transfer, forward surge, and 3-axis inertia:**
  $$\Delta x_{\text{sway}} = -0.036 w_{\text{walk}} \cos g, \quad \Delta z_{\text{surge}} = 0.025 w_{\text{walk}} \sin(2g)$$
  $$\theta_{\text{roll}} = -0.055 w_{\text{walk}} \cos g, \quad \theta_{\text{pitch}} = 0.048 w_{\text{walk}} \sin(2g - 0.4), \quad \theta_{\text{yaw}} = -0.075 w_{\text{walk}} \sin g$$

For a leg with hip socket $\mathbf{p}_{\text{hip}} = (p_x, p_y, p_z)$, let $\Delta\mathbf{h} = \text{bipedBodyTransform}(\mathbf{p}_{\text{hip}}, g, w) - \mathbf{p}_{\text{hip}}$ be the exact hip socket displacement:
1. **Link 1 (`animType = 4`: Hip + Thigh):**
   Rotates **rigidly** in $YZ$ around $\mathbf{p}_{\text{hip}}$ by $\theta_{\text{hip}} = 0.22 w_{\text{walk}} \sin\tau$:
   $$\mathbf{p}' = \mathbf{p}_{\text{hip}} + \Delta\mathbf{h} + \mathbf{R}_x(\theta_{\text{hip}})(\mathbf{p} - \mathbf{p}_{\text{hip}})$$
2. **Link 2 (`animType = 14`: Knee + Shin + Ankle):**
   With rest knee offset $\mathbf{k}_0 = (0, -0.3173 p_y, 0)$, the moving knee joint is $\mathbf{p}'_{\text{knee}} = \mathbf{p}_{\text{hip}} + \Delta\mathbf{h} + \mathbf{R}_x(\theta_{\text{hip}})\mathbf{k}_0$.
   The shin rotates **rigidly** around $\mathbf{p}'_{\text{knee}}$ by $\theta_{\text{shin}} = \theta_{\text{hip}} + 0.52 w_{\text{walk}} \max(0, \cos\tau)$:
   $$\mathbf{p}' = \mathbf{p}'_{\text{knee}} + \mathbf{R}_x(\theta_{\text{shin}})(\mathbf{p} - (\mathbf{p}_{\text{hip}} + \mathbf{k}_0))$$
3. **Link 3 (`animType = 24`: Dorsiflexed Foot + Toe Cap):**
   With rest ankle offset $\mathbf{a}_0 = (0, -0.5769 p_y, 0)$ below the knee, the moving ankle joint is $\mathbf{p}'_{\text{ankle}} = \mathbf{p}'_{\text{knee}} + \mathbf{R}_x(\theta_{\text{shin}})\mathbf{a}_0$.
   The foot translates **rigidly** with $\mathbf{p}'_{\text{ankle}}$, staying level with the ground:
   $$\mathbf{p}' = \mathbf{p}'_{\text{ankle}} + (\mathbf{p} - (\mathbf{p}_{\text{hip}} + \mathbf{k}_0 + \mathbf{a}_0))$$

---

## 3. Multi-Legged Spider / Hexapod Gait (`animType = 6, 16`) & Spider Chassis Suspension (`animType = 9`)

### Universal Phase Formula for 4, 6, and 8 Legs
Instead of hardcoding leg indices, `SpiderLeg` derives each leg's gait phase directly from its hip socket coordinates $(p_x, p_z)$:

$$\phi_{\text{spider}}(p_x, p_z) = \begin{cases} 4.9\,p_z & p_x \ge 0 \\ \pi + 4.9\,p_z & p_x < 0 \end{cases}$$

### Heavy Spider Chassis Step-Reaction Suspension (`animType = 9`)
Around the carapace center of mass $\mathbf{c} = (0, 0.76, 0)$, `spiderBodyTransform` models the mass, shock-absorber compression, and rotational inertia of a multi-ton walker on every diagonal footfall:
- **Spring-damped $2\omega$ impact heave:**
  $$\Delta y_{\text{heave}} = w_{\text{walk}} \left(-0.044\cos(2g) - 0.026\sin(2g)\right)$$
- **Phase-lagged 3-axis rotational inertia & surge:**
  $$\theta_{\text{roll}} = 0.095 w_{\text{walk}} \sin(g - 0.25), \quad \theta_{\text{pitch}} = 0.068 w_{\text{walk}} \sin(2g - 0.45), \quad \theta_{\text{yaw}} = 0.065 w_{\text{walk}} \cos g$$
  $$\Delta x_{\text{sway}} = 0.042 w_{\text{walk}} \cos g, \quad \Delta z_{\text{surge}} = 0.034 w_{\text{walk}} \sin(2g)$$

### Rigid 2-Link Spider Kinematics (`animType = 6` Femur & `animType = 16` Tibia+Foot)
For a leg with hip socket $\mathbf{p}_{\text{hip}} = (p_x, p_y, p_z)$ and rest knee offset $\mathbf{k}_0 = (p_x, 0.24, 0.5 p_z)$:
1. **Exact hip socket displacement from the moving carapace:**
   $$\Delta\mathbf{h} = \text{spiderBodyTransform}(\mathbf{p}_{\text{hip}}, g, w_{\text{walk}}) - \mathbf{p}_{\text{hip}}$$
2. **Rigid Coxa Yaw ($\theta_{\text{yaw}}$) and Shock-Absorbing Femur Elevation ($\theta_{\text{femur}}$):**
   $$\theta_{\text{yaw}} = \text{sign}(p_x) \cdot 0.18 w_{\text{walk}} \sin\tau, \quad \text{stepLift} = 0.10 w_{\text{walk}} (\max(0, \cos\tau))^{0.8}$$
   $$\theta_{\text{femur}} = \text{sign}(p_x) \frac{\text{stepLift} - \Delta h_y + 0.004 w_{\text{walk}}}{\max(|p_x|, 0.20)}$$
   Notice that whenever the carapace drops down ($\Delta h_y < 0$), $\theta_{\text{femur}}$ automatically pitches the rigid femur upward so the planted foot remains anchored at $y \approx 0.000\text{ m}$!
3. **Link 1 (`animType = 6`: Hip + Femur) — Pure 3D Rigid Rotation:**
   $$\mathbf{p}' = \mathbf{p}_{\text{hip}} + \Delta\mathbf{h} + \mathbf{R}_y(\theta_{\text{yaw}})\mathbf{R}_z(-\theta_{\text{femur}})(\mathbf{p} - \mathbf{p}_{\text{hip}})$$
4. **Link 2 (`animType = 16`: Knee + Tibia + Foot) — Pure 3D Rigid Rotation at Moving Knee:**
   $$\mathbf{p}'_{\text{knee}} = \mathbf{p}_{\text{hip}} + \Delta\mathbf{h} + \mathbf{R}_y(\theta_{\text{yaw}})\mathbf{R}_z(-\theta_{\text{femur}})\mathbf{k}_0$$
   $$\mathbf{p}' = \mathbf{p}'_{\text{knee}} + \mathbf{R}_y(\theta_{\text{yaw}})(\mathbf{p} - (\mathbf{p}_{\text{hip}} + \mathbf{k}_0))$$

---

## 4. Pre-Baked Vertex Animation Textures (VAT) for Non-Cyclic Motions

When a unit requires a complex non-cyclic animation (e.g., an unfolding deployment sequence or multi-stage crane assembly) without runtime CPU cost:
1. Evaluate the analytical 2-bone Inverse Kinematics (Law of Cosines) **once at startup/build time** across $N = 32$ keyframes.
2. Pack the resulting joint transforms or vertex offsets into a `THREE.DataTexture` (`RGBAFormat`, `FloatType`) or vertex attribute channels.
3. Sample the texture in the vertex shader using `uTime`, keeping runtime CPU cost at $O(1)$.
