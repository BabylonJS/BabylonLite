# Platformer Demo — Improvements & Ideas

A living backlog of ideas to grow **World 1-1** into something that is both
genuinely fun to play **and** a showcase for what Babylon **Lite** + WebGPU can
do in a tiny, tree-shaken, pure-2D bundle (no scene, camera, or mesh — just the
sprite path).

> **Iterate fast:** rebuild only this demo with
> `pnpm build:bundle-demo platformer` (add `--measure` to refresh the bundle-size
> badge), then reload `/demo-platformer.html` in `pnpm dev:lab`. The full
> `pnpm build:bundle-demos` rebuilds every demo and is much slower.

---

## Legend — engine readiness

Each idea is tagged with how much engine support it needs **today**:

- ✅ **Ready** — buildable now with shipped Lite features (additive/multiply
  blend descriptors, per-layer custom fragment shaders, opt-in `uvScroll`).
- 🟡 **Workaround** — achievable now with a sprite-space trick, but a future
  engine feature would make it cleaner/cheaper.
- 🔴 **Needs engine** — requires a capability Lite does not have yet. Listed
  here and consolidated under [Engine feature asks](#engine-feature-asks) for
  discussion before we commit.

**Scope** is relative implementation size (S / M / L), not a time estimate.

---

## Current state (baseline)

What ships today, so we know what we're building on:

- **One level** — World 1-1, scrolling left→right to a flagpole goal. No
  sub-areas or warps yet.
- **Star invincibility** — ✅ **DONE.** A per-layer custom fragment shader on the
  player (rainbow palette-cycle + sparkle pulse via `fx.time`, intensity driven
  by `setSprite2DShaderParams`) plus a 6-ghost **additive** afterimage trail on a
  second layer. Blinks as a warning in the final ~2 s. Replaced the old flat
  yellow vertex-tint. See [#1](#1-star-invincibility--make-it-dazzle-).
- **Parallax background** — ✅ **DONE.** Replaced the single `colored_grass.png`
  backdrop with a procedural multi-band parallax ([`parallax.ts`](parallax.ts)): a
  static sky gradient, drifting clouds, and two rows of rolling hills, each a
  single full-screen sprite scrolling via **`uvScroll`** at its own depth rate.
  See [#2](#2-richer-parallax--multi-band-scrolling-world-).
- **Power-ups** — mushroom (grow), ✅ **fire flower** (shoot fireballs), and star
  (invincibility). Block progression is classic: a mushroom-block gives a mushroom
  when small, a fire flower once big. See [#4](#visual-fx).
- **Enemies** — stompable shells with kick/bump behaviour.
- **Pipes** — ✅ **DONE.** A green warp pipe in the overworld now teleports the
  player (duck on top) through an iris-wipe transition to a sealed underground
  **bonus coin room** (`1-2`), with a return pipe back to `1-1`. See
  [#3](#3-several-scenes--pipe-warps--sub-areas-).
- **HUD** — DOM overlay (score, coins, time, lives). **Audio** — clean-room
  chiptune SFX. **Input** — keyboard / gamepad / touch.

---

## Requested ideas

### 1. Star invincibility — make it dazzle ✅ DONE

> **Shipped.** Implemented in [`game.ts`](game.ts) as a dual-duty custom shader on
> the player layer (at strength 0 it returns the stock sprite, so one layer covers
> both normal and powered states) plus an additive afterimage trail. The optional
> world-wide "star pulse" tint below was **not** implemented — left as a possible
> follow-up.

**What.** Replace the flat color-tint with a proper invincibility shader: a
rainbow palette-cycle sweeping over the sprite, a bright rim/flash pulse, and an
**additive sparkle trail** of afterimages behind the running player.

**Why it's a showcase.** Shows off per-layer custom fragment shaders + additive
blending driving a classic effect that normally needs a full material system —
in a pure-2D bundle.

**How (Lite APIs).**
- Give the player its own layer built with
  `createSprite2DLayer(atlas, { customShader: starShader, ... })`.
- `starShader = createSprite2DCustomShader({ fragment })` where the WGSL samples
  `atlasTex`/`atlasSamp`, then hue-rotates RGB by `fx.time` and adds a rim glow.
  Drive intensity from `setSprite2DShaderParams(layer, [strength, 0,0,0])`,
  ramping `strength` to 0 as the star timer runs out (and a faster flash in the
  final ~2 s warning).
- Sparkle trail: a small pool of player-frame sprites on an **additive** layer
  (`blendMode: spriteBlendAdditive`) sampling recent positions, fading by age.
- Optional: tint the whole world subtly during the star by setting `fx.params`
  on the terrain/block layers too (a shared "star pulse" uniform).

**Scope.** S–M.

---

### 2. Richer parallax — multi-band scrolling world ✅ DONE

> **Shipped.** Implemented in [`parallax.ts`](parallax.ts): four bands (sky
> gradient, clouds, far hills, near hills) generated procedurally with an offscreen
> 2D canvas, each a single full-screen sprite whose atlas frame has `uvMax.x > 1`
> (texture tiles across the screen under `repeat` wrap) and scrolls via
> `setSprite2DUvOffset` at a per-band parallax factor. Clouds also self-drift. The
> old 12-slot manual tile-wrapping backdrop is gone. **Not yet** done from the
> wishlist below: distant mountains as a separate band and the additive sun/haze
> — left as easy follow-ups.

**What.** Replace the single tiled background with **several depth bands** that
scroll at different rates: far sky gradient, clouds, distant mountains, mid hills,
near bushes/foreground. Add slow drifting clouds and a soft additive sun/haze.

**Why it's a showcase.** This is the textbook use of the new opt-in **`uvScroll`**
feature — infinite horizontal scroll with **zero cross-scene cost** — layered
with additive atmosphere. Big visual payoff, tiny code.

**How (Lite APIs).**
- For each band, a wide sprite (or a few wrapping tiles) on a layer created with
  `createSprite2DLayer(atlas, { uvScroll: true, order })`. Each frame, advance
  `setSprite2DUvOffset(layer, idx, [cameraX * factorBand, 0])` with a smaller
  `factor` for farther bands → parallax depth.
- Clouds: a second `uvScroll` band advancing on its own slow timer independent of
  the camera.
- Sun glow / god-rays / atmospheric haze: an **additive** sprite
  (`blendMode: spriteBlendAdditive`) pulsing via a custom shader's `fx.time`.
- Underground/cave areas (see #3) swap to dark bands + a multiply vignette.

**Scope.** M.

---

### 3. Several "scenes" — pipe warps & sub-areas ✅ DONE

> **Shipped.** Implemented across [`level.ts`](level.ts) (a sealed stone cave
> chamber appended to the same tile grid past a wide void gap, with bonus-coin
> rows and two warp pipes), [`portal.ts`](portal.ts) (procedural pipe + cave
> backdrop textures and the fullscreen **iris-wipe** WGSL), [`game.ts`](game.ts)
> (a `warping` phase that runs the iris and teleports the player at its darkest
> point, an `inCave` flag driving the dark backdrop + flag-goal guard, plus the
> duck-on-pipe trigger), and [`audio.ts`](audio.ts) (a `warp()` whoosh). The
> transition is a single fullscreen `createSprite2DCustomShader` quad — **no
> engine post-process needed** (see the corrected note in #A below).
>
> **Not yet** done from the wishlist below: multiple distinct areas beyond the one
> cave, per-area music, and the final castle approach — the area model is a simple
> two-region split today, not a general `loadArea` system. Easy to extend.

**What.** Turn the single level into a small **world** of connected areas:
overworld → enter a pipe → underground coin room → exit pipe back out (or to a
bonus area), plus a final castle approach. Each area has its own palette, music,
parallax bands, and tile set.

**Why it's a showcase.** Demonstrates that a Lite sprite game can manage multiple
"rooms" cheaply — tearing down and repopulating sprite layers per area with no
scene graph — and gives the demo real game structure.

**How (Lite APIs).**
- Model the level as a list of **areas**, each with its own tile/terrain/enemy
  data. A `loadArea(area)` clears and refills the existing layers
  (`updateSprite2DIndex` over pooled slots) — no engine teardown needed.
- A `warp` trigger tile: when the player ducks into a pipe mouth, play the
  existing **pipe** SFX, run a short "descend into pipe" tween (clip the player
  sprite as it sinks), then `loadArea(targetArea)` and reposition the player at
  the destination pipe.
- Persist score/coins/time/lives across areas in the existing game state.
- 🟡 **Transition polish.** The shipped iris-wipe is a fullscreen custom-shader
  **overlay** quad (it covers the frame; it does not re-read rendered pixels), so
  it needed **no** engine work. A transition that distorts/samples the existing
  frame (e.g. a swirl or pixelate wipe) would want a real post-process pass — see
  the corrected [Engine feature asks](#engine-feature-asks).

**Scope.** L (area system + at least one underground + one bonus area).

---

## More ideas (showcase + fun)

### Visual FX

- **4. Fire flower + fireballs ✅ DONE.** Procedural fire-flower pickup
  ([`fire.ts`](fire.ts)) emerges from a `?`-block once the player is big; collecting
  it grants the **fire** state (yellow alien via [`PLAYER_FIRE_FRAMES`](frames.ts)).
  The fire/run button (X / Shift / B) throws bouncing **fireball** projectiles drawn
  on an **additive** layer with a glowing core (capped at 2 live, rate-limited); they
  bounce along the ground, pop enemies on contact, and expire. Taking a hit drops
  fire→big→small. A `warp()`-style `fireball()` SFX was added too.
- **5. Power-state palette swaps ✅ (S).** Small / big / fire player rendered
  from one base sheet recolored by a **palette-remap custom shader** with an
  extra LUT texture (`createSprite2DCustomShader({ extraTextures: [palette] })`)
  — the same technique as parity scenes 93/95. One sheet, many looks.
- **6. Coin & stomp juice ✅ (S).** Additive sparkle bursts on coin collect and
  enemy stomp, plus floating "+100" score popups (sprite digits or DOM). Cheap,
  hugely satisfying.
- **7. Animated water / lava bands ✅ (M).** A `uvScroll` water/lava strip with a
  **multiply**-blended caustics overlay; optional gentle wave distortion via a
  custom shader sampling a scrolling noise texture.
- **8. Underground "lantern" lighting 🟡 (M).** Darken cave areas with a
  **multiply**-blend vignette sprite and a soft radial light that follows the
  player. Works now as a sprite trick; a real 2D light system would be cleaner
  (engine ask).
- **9. Heat-haze / underwater wobble 🟡 (M).** Per-layer custom shader offsetting
  UVs by a scrolling noise texture for a wobble on lava/water areas. Per-layer
  works today; a **fullscreen** version needs a post pass (engine ask).
- **10. Weather & time-of-day ✅/🔴 (M).** Rain/snow as additive particle sprites
  and a day→dusk→night sky gradient. Sprite-based version ✅; a true fullscreen
  graded sky / color-grade wants a post pass 🔴.

### Gameplay & content

- **11. Checkpoints & a tiny world map ✅ (M).** Flag checkpoints mid-level and a
  between-areas map screen — reinforces the multi-area system from #3.
- **12. More enemy types ✅ (M).** A flyer, a shell-kicker, a piranha plant rising
  from pipes (ties into #3), and a simple **boss** built from a few composited
  sprites at the castle.
- **13. Moving & one-way platforms ✅ (S–M).** Named in the blurb, not yet built;
  great for platforming variety and exercises the swept-AABB collider.
- **14. Combo / scoring system ✅ (S).** Stomp chains, coin streaks, end-of-area
  bonus tally — gives players a reason to replay.

### Tech showcase / "flex"

- **15. Sprite-throughput stress mode ✅ (S).** A toggle that spawns thousands of
  coins/particles to flaunt WebGPU instancing throughput while staying smooth.
- **16. Live debug HUD ✅ (S).** Optional overlay: sprite count, draw calls, frame
  time, and the demo's gzip bundle size — makes the "tiny + fast" story explicit.
- **17. Retro CRT / scanline filter 🔴 (M).** A full-screen scanline + slight
  barrel/vignette pass for arcade flavour. Needs a **fullscreen post pass**.
- **18. Smooth integer-scale pixel zoom 🔴 (M).** Crisp pixel-art scaling at
  fractional window sizes via **render-to-texture** at integer scale, then blit.
  Needs RTT/framegraph.

### Polish

- **19. Controller rumble + better touch controls ✅ (S).** Gamepad haptics on
  hit/stomp; larger, nicer on-screen buttons for mobile.
- **20. Title & attract screen ✅ (S).** A proper start screen with an animated
  logo (reuse the star shader) and an idle attract loop.
- **21. Accessibility ✅ (S).** Reduced-motion mode (calm the parallax/flashing),
  remappable keys, colorblind-friendly power-up shapes.

---

## Engine feature asks

Consolidated from the 🟡/🔴 ideas above — to discuss before committing.

> **Correction (verified in the engine source).** An earlier draft said RTT /
> frame-graph / post-process were "not supported." That was **wrong**: the engine
> already ships a frame-graph (`packages/babylon-lite/src/frame-graph/`),
> render targets (`engine/render-target.ts`), a post-process task, and a
> fullscreen effect renderer (`effect/effect-renderer.ts`,
> `effect/uniform-effect-renderer.ts`) — proven scene-lessly by scenes 140–144
> and the torus-states bloom demo. So the only real gap for a **pixel-reading**
> post pass is letting the pure-2D `SpriteRenderer` render into an offscreen
> color target (it currently hardcodes the swapchain view) and feeding that into
> an existing effect pass. That is a **moderate, well-scoped hook**, not new
> infrastructure.

| # | Feature | Unlocks | Status |
|---|---------|---------|--------|
| A | **SpriteRenderer → offscreen target + post pass** | CRT/scanline (#17), fullscreen heat-haze (#9), graded day/night sky (#10), screen-wide flashes | Building blocks exist (render targets, effect renderer, frame graph). Need to let the SpriteRenderer target an offscreen RT, then run an effect pass over it. The CRT effect (#17) is the ideal first user. |
| B | **Render-to-texture at integer scale + blit** | Crisp integer-scale pixel zoom (#18) | Same RT building blocks; needs an integer-scale resolve/blit path. |
| C | **2D sprite cutout (alpha-test) blend** | Hard-edged depth-sorted sprites (foliage/grates) if we ever go 2.5D | Billboard cutout already ships; 2D-sprite cutout is still TODO. Low priority for this demo. |
| D | **(Nice-to-have) lightweight 2D light/normal system** | Cleaner underground lighting (#8) | Fully fakeable with multiply sprites today; only worth it if multiple demos want real 2D lighting. |

Everything not in this table is ✅ **buildable now** — the headline effects the
demo wants most (dazzling star, multi-band parallax, **pipe-warp areas**,
additive/fire juice, palette-swap power states) need **no new engine work**.
Note the shipped **iris transition (#3)** is an overlay quad and needed nothing
from this table.

---

## Suggested first slice

A high-impact, all-✅ starting batch that needs zero engine changes:

1. **#1 Star shader** — ✅ **DONE** (immediate "wow", small scope).
2. **#2 Multi-band parallax** — ✅ **DONE** (transformed the whole look via `uvScroll`).
3. **#3 area system + one underground room** — ✅ **DONE** (pipe warp + iris + cave
   `1-2`, all overlay-side; no engine post-process needed).
4. **#6 coin/stomp juice** + **#4 fireballs** — gameplay-feel polish.
   (#4 fire flower + fireballs ✅ **DONE**; #6 coin/stomp juice **← next**).

Then the **CRT/scanline post-process (#17)** is the natural next showcase — it's
the first effect that genuinely needs the engine hook (ask A above), and would
flex the existing frame-graph stack scene-lessly through the sprite renderer.
