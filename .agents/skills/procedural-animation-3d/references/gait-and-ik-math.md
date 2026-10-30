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

### Coupled Hip-Knee-Ankle Field (`animType = 4`)
For a vertex at rest coordinate $(x, y, z)$ belonging to a leg with hip socket $\mathbf{p}_{\text{pivot}} = (p_x, p_y, p_z)$:
1. Normalized distance down the leg ($0$ at hip, $1$ at foot sole):
   $$\text{legT} = \text{clamp}\left(\frac{-(y - p_y)}{\max(p_y, 0.1)}, 0, 1\right)$$
2. Normalized distance below the knee ($0$ above knee, $0 \to 1$ from knee to foot):
   $$\text{kneeT} = \text{clamp}\left(\frac{\text{legT} - 0.45}{0.55}, 0, 1\right)$$
3. Sagittal hip pitch rotation ($\theta_{\text{hip}} = 0.18 \cdot w_{\text{walk}} \sin\tau$) plus asymmetric ground-clearance lift and knee retraction:
   $$\begin{aligned}
   y_1 &= (y - p_y)\cos\theta_{\text{hip}} - (z - p_z)\sin\theta_{\text{hip}} + \text{legT} \cdot w_{\text{walk}} \cdot \left(0.038|\sin\tau| + 0.045\max(0, \cos\tau)\right) \\
   z_1 &= (y - p_y)\sin\theta_{\text{hip}} + (z - p_z)\cos\theta_{\text{hip}} - \text{kneeT} \cdot w_{\text{walk}} \cdot 0.055\max(0, \cos\tau)
   \end{aligned}$$

**Why the $0.038|\sin\tau| + 0.045\max(0, \cos\tau)$ curve matters:**
- At mid-stance ($\tau = \pi \implies \sin\tau = 0, \cos\tau = -1$), both terms vanish so the planted foot sits flush at $y = 0.000$.
- At extreme forward/backward reach ($\sin\tau = \pm 1$), the $0.038|\sin\tau|$ term compensates for the downward pitch of the toe/heel so no vertex ever dips below $y = 0.000$.
- During the forward recovery swing ($\cos\tau > 0$), $0.045\max(0, \cos\tau)$ lifts the foot in a stepping arc while $\text{kneeT}$ tucks the shin backward.

---

## 3. Multi-Legged Spider / Hexapod Gait (`animType = 6`)

### Universal Phase Formula for 4, 6, and 8 Legs
Instead of hardcoding leg indices, `SpiderLeg` derives each leg's gait phase directly from its hip socket coordinates $(p_x, p_z)$:

$$\phi_{\text{spider}}(p_x, p_z) = \begin{cases} 4.9\,p_z & p_x \ge 0 \\ \pi + 4.9\,p_z & p_x < 0 \end{cases}$$

- **Quadruped Walker ($p_z = \pm 0.32\text{ m}$, e.g. `robot.combat`):**
  $4.9 \times 0.32 = 1.568 \approx \frac{\pi}{2}$. Front-Right ($+\frac{\pi}{2}$) and Rear-Left ($\pi - \frac{\pi}{2} = +\frac{\pi}{2}$) move in exact diagonal lockstep; Front-Left ($\frac{3\pi}{2}$) and Rear-Right ($-\frac{\pi}{2}$) move $180^\circ$ out of phase.
- **Hexapod Walker ($p_z \in \{+0.42, 0.0, -0.42\}\text{ m}$):**
  Produces a $120^\circ$ ($\frac{2\pi}{3}$) phase shift between front, middle, and rear legs, yielding an alternating tripod gait.
- **Octopod Arachnid ($p_z \in \{+0.48, +0.16, -0.16, -0.48\}\text{ m}$):**
  Produces a $90^\circ$ ($\frac{\pi}{2}$) travelling metachronal wave from rear to front legs.

### Coxa Yaw + Radial Stepping Lift
For a leg extending outward from hip socket $(p_x, p_y, p_z)$:
1. Side-normalized coxa yaw angle (so $\sin\tau > 0$ swings both left and right legs toward $+Z$):
   $$\theta_{\text{yaw}} = \text{sign}(p_x) \cdot 0.14 \cdot w_{\text{walk}} \sin\tau$$
2. Outward radial weight ($0$ at hip socket, $1$ at knee/foot):
   $$r_{\text{out}} = \text{clamp}\left(\frac{\sqrt{(x - p_x)^2 + (z - p_z)^2}}{0.50}, 0, 1\right)$$
3. Displaced vertex position:
   $$\begin{aligned}
   x' &= p_x + (x - p_x)\cos\theta_{\text{yaw}} - (z - p_z)\sin\theta_{\text{yaw}} \\
   z' &= p_z + (x - p_x)\sin\theta_{\text{yaw}} + (z - p_z)\cos\theta_{\text{yaw}} \\
   y' &= y + r_{\text{out}} \cdot 0.075 \cdot w_{\text{walk}} \max(0, \cos\tau)
   \end{aligned}$$

---

## 4. Pre-Baked Vertex Animation Textures (VAT) for Non-Cyclic Motions

When a unit requires a complex non-cyclic animation (e.g., an unfolding deployment sequence or multi-stage crane assembly) without runtime CPU cost:
1. Evaluate the analytical 2-bone Inverse Kinematics (Law of Cosines) **once at startup/build time** across $N = 32$ keyframes.
2. Pack the resulting joint transforms or vertex offsets into a `THREE.DataTexture` (`RGBAFormat`, `FloatType`) or vertex attribute channels.
3. Sample the texture in the vertex shader using `uTime`, keeping runtime CPU cost at $O(1)$.
