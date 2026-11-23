import * as THREE from 'three';

export const R = 4000;          // globe radius (m-ish). The surface patch sits on its top at y≈0.
export const Y0 = 600;          // pod altitude while docked to the carrier
export const FOGMAX = 0.013;
export const DECK = 150;        // cloud deck altitude
export const TL = 35;           // authored timeline length; real time is scaled by duration/35
export const D2R = Math.PI / 180;

export const RTS_CAM_DIST = Math.hypot(42, 46, 42);
export const RTS_CAM_ELEV_RAD = 42 * D2R;
const _rtsHoriz = RTS_CAM_DIST * Math.cos(RTS_CAM_ELEV_RAD) * Math.SQRT1_2;
const _rtsHeight = RTS_CAM_DIST * Math.sin(RTS_CAM_ELEV_RAD);
export const FINAL_POS = new THREE.Vector3(_rtsHoriz, _rtsHeight, _rtsHoriz);
export const FINAL_TARGET = new THREE.Vector3(0, 0, 0);
