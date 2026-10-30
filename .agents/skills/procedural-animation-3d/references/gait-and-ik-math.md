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

### Coupled Hip-Knee-Ankle Field (`animType = 4`) & Biped Body Carrier (`animType = 8`)
To give a bipedal mech visible mass, footstep impact, and hip-torso suspension (`bipedBodyTransform` around center of mass $\mathbf{c} = (0, 0.92, 0)$ with gait clock $g = 5.0 t$):
- **Double-frequency ($2\omega$) step-impact heave:** Every half-cycle (left foot strike and right foot strike), the body compresses and rebounds:
  $$\Delta y_{\text{heave}} = w_{\text{walk}} \left(-0.032\cos(2g) - 0.018\sin(2g)\right)$$
- **Lateral weight transfer, forward surge, and 3-axis inertia:**
  $$\Delta x_{\text{sway}} = -0.038 w_{\text{walk}} \cos g, \quad \Delta z_{\text{surge}} = 0.020 w_{\text{walk}} \sin(2g)$$
  $$\theta_{\text{roll}} = 0.055 w_{\text{walk}} \cos g, \quad \theta_{\text{pitch}} = 0.045 w_{\text{walk}} \sin(2g - 0.4), \quad \theta_{\text{yaw}} = -0.055 w_{\text{walk}} \sin g$$

For a vertex at rest coordinate $(x, y, z)$ belonging to a leg (`animType = 4`) with hip socket $\mathbf{p}_{\text{pivot}} = (p_x, p_y, p_z)$:
1. Smooth normalized distance down the leg ($0$ across the hip ball-joint, $1$ at the foot sole):
   $$\text{rawT} = \text{clamp}\left(\frac{-(y - p_y)}{\max(p_y, 0.1)}, 0, 1\right), \quad \text{legT} = \text{smoothstep}(0.06, 0.92, \text{rawT})$$
2. Normalized distance below the knee ($0$ above knee, $0 \to 1$ from knee to foot):
   $$\text{kneeT} = \text{clamp}\left(\frac{\text{rawT} - 0.45}{0.55}, 0, 1\right)$$
3. Planted-leg stance knee compression ($\cos\tau < 0$):
   $$\text{stanceFlex} = 0.035 \sin(\text{legT}\cdot\pi)\max(0, -\cos\tau)$$
4. Sagittal hip pitch ($\theta_{\text{hip}} = 0.20 \cdot w_{\text{walk}} \sin\tau$), asymmetric foot-clearance lift, and hip-to-ground carrier blend:
   $$\begin{aligned}
   y_1 &= (y - p_y)\cos\theta_{\text{hip}} - (z - p_z)\sin\theta_{\text{hip}} + \text{legT} \cdot w_{\text{walk}} \cdot \left(0.042|\sin\tau| + 0.065\max(0, \cos\tau)\right) \\
   z_1 &= (y - p_y)\sin\theta_{\text{hip}} + (z - p_z)\cos\theta_{\text{hip}} + w_{\text{walk}}\left(\text{stanceFlex} - 0.068\,\text{kneeT}\max(0, \cos\tau)\right) \\
   \mathbf{p}' &= \text{mix}\left(\text{bipedBodyTransform}(\mathbf{p}, g, w_{\text{walk}}), \; \mathbf{p}_{\text{leg}}, \; \text{legT}\right)
   \end{aligned}$$
   Because $\text{legT} = 0$ at the hip socket and $\text{legT} = 1$ at the foot sole, the hip socket moves 100% locked to the heaving pelvis while the planted foot remains anchored at $y = 0.000$.

---

## 3. Multi-Legged Spider / Hexapod Gait (`animType = 6`) & Spider Chassis Suspension (`animType = 9`)

### Universal Phase Formula for 4, 6, and 8 Legs
Instead of hardcoding leg indices, `SpiderLeg` derives each leg's gait phase directly from its hip socket coordinates $(p_x, p_z)$:

$$\phi_{\text{spider}}(p_x, p_z) = \begin{cases} 4.9\,p_z & p_x \ge 0 \\ \pi + 4.9\,p_z & p_x < 0 \end{cases}$$

- **Quadruped Walker ($p_z = \pm 0.32\text{ m}$, e.g. `robot.combat`):**
  $4.9 \times 0.32 = 1.568 \approx \frac{\pi}{2}$. Front-Right ($+\frac{\pi}{2}$) and Rear-Left ($\pi - \frac{\pi}{2} = +\frac{\pi}{2}$) move in exact diagonal lockstep; Front-Left ($\frac{3\pi}{2}$) and Rear-Right ($-\frac{\pi}{2}$) move $180^\circ$ out of phase.
- **Hexapod Walker ($p_z \in \{+0.42, 0.0, -0.42\}\text{ m}$):**
  Produces a $120^\circ$ ($\frac{2\pi}{3}$) phase shift between front, middle, and rear legs, yielding an alternating tripod gait.
- **Octopod Arachnid ($p_z \in \{+0.48, +0.16, -0.16, -0.48\}\text{ m}$):**
  Produces a $90^\circ$ ($\frac{\pi}{2}$) travelling metachronal wave from rear to front legs.

### Heavy Spider Chassis Step-Reaction Suspension (`animType = 9`)
Around the carapace center of mass $\mathbf{c} = (0, 0.76, 0)$, `spiderBodyTransform` models the mass, shock-absorber compression, and rotational inertia of a multi-ton walker on every diagonal footfall:
- **Spring-damped $2\omega$ impact heave:**
  $$\Delta y_{\text{heave}} = w_{\text{walk}} \left(-0.044\cos(2g) - 0.026\sin(2g)\right)$$
- **Phase-lagged 3-axis rotational inertia & surge:**
  $$\theta_{\text{roll}} = 0.095 w_{\text{walk}} \sin(g - 0.25), \quad \theta_{\text{pitch}} = 0.068 w_{\text{walk}} \sin(2g - 0.45), \quad \theta_{\text{yaw}} = 0.065 w_{\text{walk}} \cos g$$
  $$\Delta x_{\text{sway}} = 0.032 w_{\text{walk}} \sin g, \quad \Delta z_{\text{surge}} = 0.028 w_{\text{walk}} \sin(2g - 0.2)$$

### Coxa Yaw, Snappy Step Lift & Stance Shock-Absorption Knee Flex (`animType = 6`)
For a leg extending outward from hip socket $(p_x, p_y, p_z)$:
1. Side-normalized coxa yaw angle (so $\sin\tau > 0$ swings both left and right legs toward $+Z$):
   $$\theta_{\text{yaw}} = \text{sign}(p_x) \cdot 0.16 \cdot w_{\text{walk}} \sin\tau$$
2. Smooth radial blend weight ($0$ across the hip ball-joint socket, $1$ at the outer foot):
   $$r_{\text{out}} = \text{smoothstep}\left(0.08, 0.52, \sqrt{(x - p_x)^2 + (z - p_z)^2}\right)$$
3. Snappy swing-phase foot lift and planted-phase knee shock absorption:
   $$\text{stepLift} = 0.11 \left(\max(0, \cos\tau)\right)^{0.75}, \quad \text{kneeArch} = 0.028 \sin(r_{\text{out}}\cdot\pi)\max(0, -\cos\tau)$$
4. Coupled body-to-ground vertex position:
   $$\begin{aligned}
   \mathbf{p}_{\text{leg}} &= \left(p_x + (x - p_x)\cos\theta_{\text{yaw}} - (z - p_z)\sin\theta_{\text{yaw}}, \; y + w_{\text{walk}}(r_{\text{out}}\,\text{stepLift} + \text{kneeArch}), \; p_z + (x - p_x)\sin\theta_{\text{yaw}} + (z - p_z)\cos\theta_{\text{yaw}}\right) \\
   \mathbf{p}' &= \text{mix}\left(\text{spiderBodyTransform}(\mathbf{p}, g, w_{\text{walk}}), \; \mathbf{p}_{\text{leg}}, \; r_{\text{out}}\right)
   \end{aligned}$$

---

## 4. Pre-Baked Vertex Animation Textures (VAT) for Non-Cyclic Motions

When a unit requires a complex non-cyclic animation (e.g., an unfolding deployment sequence or multi-stage crane assembly) without runtime CPU cost:
1. Evaluate the analytical 2-bone Inverse Kinematics (Law of Cosines) **once at startup/build time** across $N = 32$ keyframes.
2. Pack the resulting joint transforms or vertex offsets into a `THREE.DataTexture` (`RGBAFormat`, `FloatType`) or vertex attribute channels.
3. Sample the texture in the vertex shader using `uTime`, keeping runtime CPU cost at $O(1)$.
