/**
 * Standard fog receiver WGSL — the `calcFogFactor` helper plus the fog blend block.
 *
 * Dynamically imported by `standard-group-builder` ONLY when `scene.fog` is set, then threaded into
 * the Standard template as plain strings (mirrors the PBR fog path in `pbr-fog-wgsl.ts`). This keeps
 * every byte of fog WGSL out of the bundles of Standard scenes that don't use fog — a static `import`
 * of the helper into `standard-template` would defeat tree-shaking and inflate every Standard scene
 * (see GUIDANCE §4c′). This is the ONLY module that statically holds the fog WGSL for Standard.
 *
 * Parity notes (matches Babylon.js `default.fragment` exactly):
 *  - Standard mixes fog into the final LDR colour at the end of the fragment (after the lit colour is
 *    clamped to non-negative), with the raw (non-linearised) `vFogColor` — no gamma round-trip, unlike PBR.
 *  - The fog FACTOR is the linear/exp/exp2 distance falloff from `calcFogFactor` (no `pow(.., 2.2)`).
 *  - The runtime `vFogInfos.x > 0.0` guard lets `fogMode` toggle none/linear/exp/exp2 at runtime.
 */

import { WGSL_FOG } from "../../shader/wgsl-helpers.js";

/** `calcFogFactor` + `E_FOG` helper WGSL (reads `scene.vFogInfos`). */
export const STD_FOG_HELPER = WGSL_FOG;

/** Fog blend block, emitted at the end of the Standard fragment (operates on the final LDR `color`). */
export const STD_FOG_BLOCK = "if(scene.vFogInfos.x>0.0){let fog=calcFogFactor(input.vf);color=vec4<f32>(mix(scene.vFogColor.rgb,color.rgb,fog),color.a);}";
