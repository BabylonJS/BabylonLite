# Code Review — Sprite & Billboard Animation (commit `eb992d9` WIP)

Branch: `animations-sprites` · 31 files, +1815 / −43.

This review covers the optional sprite frame-animation core
([packages/babylon-lite/src/sprite/sprite-animation.ts](packages/babylon-lite/src/sprite/sprite-animation.ts))
plus its four family helpers, the two demo scenes (58, 59),
unit + parity tests, and supporting docs/config.

It is a **read-only review** — no source files were modified.

---

## Severity legend

- **Critical** — correctness bug, will misbehave or break under realistic usage.
- **High** — design smell or duplication that materially harms maintainability.
- **Medium** — leaky abstraction, missing test, or noticeable rough edge.
- **Low** — cosmetic, performance nit, or undocumented behaviour.
- **Nit** — pure style / convention.

---

## Critical

### C1. `startSpriteAnimationManager` does not check for an active binding

[packages/babylon-lite/src/sprite/sprite-animation.ts#L199-L218](packages/babylon-lite/src/sprite/sprite-animation.ts#L199-L218)

`attachSpriteAnimationsToScene` and `attachSpriteAnimationsToRenderer` both
call `assertNoActiveBinding(manager)` to prevent double-ticking, but
`startSpriteAnimationManager` does **not**. A user who calls
`attachSpriteAnimationsToScene(scene, manager)` and then
`startSpriteAnimationManager(manager)` (or vice-versa, attach after
start) gets the manager ticking twice per frame — frames advance at
2× speed and timing becomes non-deterministic.

**Fix:** call `assertNoActiveBinding(manager)` at the top of
`startSpriteAnimationManager`, and have `attachSpriteAnimationsTo*`
reject a manager whose `running === true`. Either reuse a single
`_binding` slot for autonomous mode, or extend the guard to also
check `manager.running`.

### C2. Index-target `isAlive()` does not verify identity (swap-remove poisons unrelated sprite)

[packages/babylon-lite/src/sprite/sprite-2d-index-animation.ts#L17-L25](packages/babylon-lite/src/sprite/sprite-2d-index-animation.ts#L17-L25)
[packages/babylon-lite/src/sprite/billboard-sprite-index-animation.ts#L17-L25](packages/babylon-lite/src/sprite/billboard-sprite-index-animation.ts#L17-L25)

The index variants build a target whose `isAlive` is

```ts
isAlive: () => index >= 0 && index < layer.count
```

Sprite layers use swap-remove semantics, so after the user removes
any other sprite at a lower index, this `index` now points to a
**different** sprite. The animation will happily keep writing frame
values to that unrelated sprite — and worse, if
`removeWhenFinished` is set, it will remove the unrelated sprite
when the animation ends (see C3).

**Fix options:** either (a) drop the index variants entirely and
require handles — handles already exist and don't have this problem;
or (b) capture an identity token at creation time (e.g.
`layer._handles[index].id`) and compare against it inside
`isAlive`/`remove`/`setFrame`.

### C3. `removeWhenFinished` on index animations can remove the wrong sprite

[packages/babylon-lite/src/sprite/sprite-2d-index-animation.ts#L14-L24](packages/babylon-lite/src/sprite/sprite-2d-index-animation.ts#L14-L24)
[packages/babylon-lite/src/sprite/billboard-sprite-index-animation.ts#L14-L24](packages/babylon-lite/src/sprite/billboard-sprite-index-animation.ts#L14-L24)

Direct consequence of C2: when a finishing (non-loop) animation
completes and `removeWhenFinished === true`, `advanceSpriteAnimation`
calls `target.remove?.()`
([packages/babylon-lite/src/sprite/sprite-animation.ts#L192](packages/babylon-lite/src/sprite/sprite-animation.ts#L192)),
which calls `removeSprite2D(layer, index)` — but `index` was bound at
creation time. If anything was removed from the layer in between,
this destroys an unrelated sprite. There is no test covering this
hazard (see M5).

**Fix:** same as C2. The handle variants are unaffected because
`removeSprite2D` takes a handle and handle indices are remapped on
swap-remove.

---

## High

### H1. `sprite-animation.ts` duplicates `animation-manager-core.ts` almost verbatim

[packages/babylon-lite/src/sprite/sprite-animation.ts#L33-L78](packages/babylon-lite/src/sprite/sprite-animation.ts#L33-L78)
vs. [packages/babylon-lite/src/animation/animation-manager-core.ts](packages/babylon-lite/src/animation/animation-manager-core.ts)

`SpriteAnimationManager` re-implements the **exact** lifecycle of the
existing `AnimationManager`: same `fixedDeltaMs`, `running`,
`_rafId`, `_lastTime`, `engine`, `onUpdate`, same `requestAnimationFrame`
loop in `startSpriteAnimationManager`, same `cancelAnimationFrame`
in `stopSpriteAnimationManager`. The animation **list** type is
different (`SpriteFrameAnimation[]` vs `AnimationGroup[]`) but the
manager machinery is identical.

This violates GUIDANCE pillar "extend, don't fork": when we later fix
a bug or add a feature to the manager loop (e.g. fixed-timestep
sub-stepping, pause/resume, max delta clamp) we will silently
diverge. It also pulls a duplicate ~80 lines into the bundle for any
scene that uses both.

**Fix:** extract a generic `Manager<T>` (or thin protocol) with a
`step(deltaMs)` callback, and have both managers consume it. At
minimum, factor `startManager` / `stopManager` / `requestAnimationFrame`
helpers into a shared module.

### H2. `attachSpriteAnimationsToRenderer` monkey-patches `SpriteRenderer._update`

[packages/babylon-lite/src/sprite/sprite-animation.ts#L240-L260](packages/babylon-lite/src/sprite/sprite-animation.ts#L240-L260)

```ts
const originalUpdate = rendererInternal._update;
const wrappedUpdate = (): void => { ... originalUpdate.call(renderer); };
rendererInternal._update = wrappedUpdate;
```

Two distinct problems:

1. **Brittle dispose.** `_dispose` only restores `originalUpdate` if
   `rendererInternal._update === wrappedUpdate`. If anything else
   wraps `_update` after this attach (a perfectly legal pattern given
   the same mechanism is exposed here), `dispose` silently leaves the
   wrap in place — orphan binding + permanent leak. Two attach calls
   on the same renderer (even briefly, due to a bug elsewhere) leave
   an un-removable layer.

2. **Pillar smell.** The "no methods on interfaces" pillar
   (GUIDANCE) is partly about not having behaviour bound to
   instances. Wrapping a function field on a state object is the
   exact mutation pattern the pillar discourages, even though
   `SpriteRenderer._update` is internal.

**Fix:** give `SpriteRenderer` a small `_beforeUpdate: ((deltaMs: number) => void)[]`
array (mirroring `SceneContextInternal._beforeRender`). Attach pushes,
dispose splices. Composable, identity-safe, no monkey patches.

---

## Medium

### M1. `SpriteAnimationManagerOptions.engine` is dead state

[packages/babylon-lite/src/sprite/sprite-animation.ts#L34, L44, L72](packages/babylon-lite/src/sprite/sprite-animation.ts#L34)

`engine` is accepted in options, stored on the manager, exposed as
`readonly engine?: EngineContext`, and **never read** anywhere in
the module. Copy-paste residue from `animation-manager-core.ts` (H1).
Either consume it (e.g. derive `_currentDelta` from `engine` instead
of relying on the renderer wrap) or drop the field. Bundle bytes
spent for no behaviour.

### M2. Frame-write helpers do not update `sourceSizePx`

[packages/babylon-lite/src/sprite/sprite-2d.ts](packages/babylon-lite/src/sprite/sprite-2d.ts) — `setSprite2DFrameIndex`
[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts) — `setBillboardSpriteFrameIndex`

Both new setters update UVs but leave the sprite's
`sourceSizePx`-derived geometry untouched. For a uniform-grid atlas
(the only one in `scene-config.json` today) this is fine — every
frame has the same size. For a **non-uniform** atlas (which the
atlas loader already supports via `frames[]`), the sprite's quad
keeps its previous size while UVs jump to a different-sized frame —
visually distorted.

**Fix:** if the atlas exposes per-frame size, re-write
`sourceSizePx` to the new frame's dimensions in both setters.
Alternatively document the limitation prominently in the JSDoc.

### M3. Flip detection uses strict `>` and silently drops degenerate frames

[packages/babylon-lite/src/sprite/billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts) — `shouldSwapUvEndpoints` + `setBillboardSpriteFrameIndex`
[packages/babylon-lite/src/sprite/sprite-2d.ts](packages/babylon-lite/src/sprite/sprite-2d.ts) — `setSprite2DFrameIndex`

Flip state is reconstructed from the *stored* UV slots:

```ts
const flipX = uvSlot[5] > uvSlot[7];
const flipY = uvSlot[6] > uvSlot[8];
```

If the previous frame had `uvMin === uvMax` on either axis
(a one-pixel-wide atlas frame, or an unloaded/cleared sprite),
**both flipped and non-flipped states are indistinguishable** and
the `> ` check loses the user's intended flip. The bug is silent —
the sprite stays unflipped on the next frame change.

**Fix:** store flip as an explicit bit (e.g. on the handle), or
compare against the atlas frame's canonical min/max instead of
inferring from previously-written values.

### M4. `seekSpriteAnimationManager` is duplicated in two lab scenes

[lab/src/lite/scene58.ts#L75-L80](lab/src/lite/scene58.ts#L75-L80)
[lab/src/lite/scene59.ts#L104-L109](lab/src/lite/scene59.ts#L104-L109)

The exact same body appears in both files. Lab scenes are
intentionally self-contained per project convention, but the helper
belongs in
[lab/src/_shared/player-sprite.ts](lab/src/_shared/player-sprite.ts)
next to `getPlayerSpriteSeekStepCount` and `PLAYER_SPRITE_SEEK_STEP_MS`,
which it already imports. Moving it saves ~6 lines and prevents the
two copies from drifting.

### M5. No unit test for index-animation swap-remove poisoning (C2/C3)

[tests/unit/sprite-animation.test.ts](tests/unit/sprite-animation.test.ts)

There is a test that exercises handle-based animations surviving a
swap-remove
(["handle target stays alive across swap-remove"](tests/unit/sprite-animation.test.ts)),
but no test for the index-target hazard. Given C2 + C3 are real bugs,
this is conspicuous — once the fix lands, a regression test would
be a natural addition.

### M6. Four near-identical family helpers (`{sprite2d,billboard}-{handle,index}-animation.ts`)

[packages/babylon-lite/src/sprite/sprite-2d-handle-animation.ts](packages/babylon-lite/src/sprite/sprite-2d-handle-animation.ts)
[packages/babylon-lite/src/sprite/sprite-2d-index-animation.ts](packages/babylon-lite/src/sprite/sprite-2d-index-animation.ts)
[packages/babylon-lite/src/sprite/billboard-sprite-handle-animation.ts](packages/babylon-lite/src/sprite/billboard-sprite-handle-animation.ts)
[packages/babylon-lite/src/sprite/billboard-sprite-index-animation.ts](packages/babylon-lite/src/sprite/billboard-sprite-index-animation.ts)

Each file is ~36 LOC and differs only in:

- the four imported functions (`setX`, `removeX`, `isXAlive`),
- the `kind` string,
- the entry-point name.

This is exactly the shape of a tiny generic factory. The current
approach keeps tree-shaking very clean (good!) but at the cost of
~150 LOC of near-duplicate code. Consider a single
`createSpriteAnimationFamily(setters)` that returns a `play` function,
or just a one-line `playAnimation(manager, target, ...)` and let each
family file build its `target` inline.

(Recommendation: lean towards the second — keep four entry points,
but make them 6 lines each rather than 36.)

---

## Low

### L1. `O(N²)` dedup in `addSpriteAnimation`

[packages/babylon-lite/src/sprite/sprite-animation.ts#L111-L116](packages/babylon-lite/src/sprite/sprite-animation.ts#L111-L116)

`manager.animations.indexOf(animation) === -1` runs every add. Fine
for a handful of sprites; degrades quickly past a few hundred. Two
options: (a) trust the caller and drop the check; (b) tag the
animation with the manager (e.g. `animation._owner`) and check the
tag instead. Given Babylon ThinSprite users routinely run hundreds
of sprites, (b) is worth doing.

### L2. `SpriteAnimationTarget.kind` is never consumed

[packages/babylon-lite/src/sprite/sprite-animation.ts#L8](packages/babylon-lite/src/sprite/sprite-animation.ts#L8)

All four family helpers set `kind: "sprite2d-handle"` / etc., but
the engine never reads it. It is purely documentation. If the
intent was discriminated-union narrowing, it should also have a
`switch` somewhere; otherwise drop the field (saves 4 string
literals × bundle).

### L3. `playSpriteFrameAnimation` does not reset `onEnd` / `removeWhenFinished` on replay

[packages/babylon-lite/src/sprite/sprite-animation.ts#L130-L143](packages/babylon-lite/src/sprite/sprite-animation.ts#L130-L143)

`createSpriteFrameAnimation` accepts `options.onEnd` and
`options.removeWhenFinished`; `playSpriteFrameAnimation` re-inits
`from/to/loop/delayMs/_direction` etc. but leaves `onEnd` and
`removeWhenFinished` from the previous `create`/`play` call. This is
defensible behaviour but is **undocumented** — a caller who replays
the animation with new parameters will not expect the prior
`onEnd` to fire again. Either accept options in `playSpriteFrameAnimation`
or document the carry-over.

### L4. `manager._binding` is retained after dispose (only `active` flips)

[packages/babylon-lite/src/sprite/sprite-animation.ts#L265-L270](packages/babylon-lite/src/sprite/sprite-animation.ts#L265-L270)

`disposeSpriteAnimationBinding` sets `binding.active = false` and
runs `_dispose`, but never clears `manager._binding`. The
`assertNoActiveBinding(manager)` check uses `?.active` so it
behaves correctly, but the stale reference is confusing on
introspection and pins memory. Clearing `manager._binding = undefined`
inside `dispose` is one line.

### L5. Optional chain on a non-optional field

[packages/babylon-lite/src/sprite/sprite-animation.ts#L244](packages/babylon-lite/src/sprite/sprite-animation.ts#L244)

```ts
updateSpriteAnimationManager(manager, rendererInternal._engine?._currentDelta ?? 0);
```

`SpriteRendererInternal._engine` is non-optional in
[packages/babylon-lite/src/sprite/sprite-renderer.ts](packages/babylon-lite/src/sprite/sprite-renderer.ts);
the `?.` is misleading and hides whether `_currentDelta === 0` is a
legitimate first-frame value or a wrap-after-dispose artefact.
Either widen `_engine` to optional in the local
`SpriteRendererWithEngine` extension on purpose (and explain why),
or drop the `?.`.

### L6. `lab/src/_shared/player-sprite.ts` duplicates the engine's animation algorithm

[lab/src/_shared/player-sprite.ts](lab/src/_shared/player-sprite.ts) —
`ManualSpriteAnimation`, `advanceManualSpriteAnimation`, etc.

This is **intentional** (it is the BJS-side reference for the
parity demos), but it means any future change to
`advanceSpriteAnimation` semantics inside the engine
(e.g. switching from "strictly `>`" to "`>=`", or batched multi-frame
catch-up) must be mirrored here, otherwise scene58/59 parity tests
will diverge from reality. Worth a comment in
`player-sprite.ts` pointing back to
[packages/babylon-lite/src/sprite/sprite-animation.ts](packages/babylon-lite/src/sprite/sprite-animation.ts)
so future maintainers know to keep them in sync.

### L7. No file-level JSDoc on the four family helpers

[packages/babylon-lite/src/sprite/sprite-2d-handle-animation.ts](packages/babylon-lite/src/sprite/sprite-2d-handle-animation.ts) etc.

The existing
[sprite-2d.ts](packages/babylon-lite/src/sprite/sprite-2d.ts) and
[billboard-sprite.ts](packages/babylon-lite/src/sprite/billboard-sprite.ts)
both lead with a multi-line file header explaining intent. The four
new helpers jump straight into `import`. A two-line header per file
matches the surrounding convention.

---

## Nits

### N1. Babylon `>` (strict greater-than) timing is correct — flag for reviewers, not a bug

[packages/babylon-lite/src/sprite/sprite-animation.ts#L162-L172](packages/babylon-lite/src/sprite/sprite-animation.ts#L162-L172)

The combination `if (accumulatedMs <= delayMs) return; ...;
accumulatedMs %= delayMs;` plus "exactly one frame per tick"
matches Babylon ThinSprite. Worth a one-liner comment so the next
reader doesn't "fix" it to `>=` or multi-step.

### N2. `_rafId = 0` sentinel could collide with a real RAF id

[packages/babylon-lite/src/sprite/sprite-animation.ts#L72, L228](packages/babylon-lite/src/sprite/sprite-animation.ts#L72)

The spec says `requestAnimationFrame` returns a "non-zero" handle,
so in practice this is safe — but the assumption is implicit. A
single-line comment ("0 = inactive — RAF ids are spec-guaranteed
non-zero") prevents a future port to a runtime that doesn't honour
that guarantee.

### N3. `index.ts` has two adjacent `export type` + `export` blocks for `sprite-animation`

[packages/babylon-lite/src/index.ts](packages/babylon-lite/src/index.ts)

Cosmetic — could merge into one re-export block. Bundle output is
identical; readability slightly improved.

### N4. `attachSpriteAnimationsToScene` uses `unshift` rather than `push`

[packages/babylon-lite/src/sprite/sprite-animation.ts#L222](packages/babylon-lite/src/sprite/sprite-animation.ts#L222)

`unshift` means animations advance **before** any other
`_beforeRender` hook. This is probably intentional (so user code
that reads sprite frame state in `_beforeRender` sees the new
frame), but it is also slower (`O(N)` shift of the array) and not
documented. A comment ("animations must run first so frame writes
are visible to user hooks") would be enough.

---

## Summary table

| ID | Severity | File | One-liner |
|----|----------|------|-----------|
| C1 | Critical | sprite-animation.ts | `startSpriteAnimationManager` skips binding guard |
| C2 | Critical | sprite-2d-index-animation.ts, billboard-sprite-index-animation.ts | Index `isAlive` doesn't verify identity |
| C3 | Critical | (same as C2) | `removeWhenFinished` can remove wrong sprite |
| H1 | High | sprite-animation.ts vs animation-manager-core.ts | Manager lifecycle duplicated |
| H2 | High | sprite-animation.ts | `_update` monkey-patch is brittle |
| M1 | Medium | sprite-animation.ts | `engine` option field unused |
| M2 | Medium | sprite-2d.ts, billboard-sprite.ts | Frame setter ignores `sourceSizePx` |
| M3 | Medium | sprite-2d.ts, billboard-sprite.ts | Flip detection loses degenerate UVs |
| M4 | Medium | lab/src/lite/scene58.ts, scene59.ts | `seekSpriteAnimationManager` duplicated |
| M5 | Medium | tests/unit/sprite-animation.test.ts | Missing swap-remove poison test |
| M6 | Medium | 4 family helper files | Could be a single generic factory |
| L1 | Low | sprite-animation.ts | O(N²) dedup |
| L2 | Low | sprite-animation.ts | `kind` strings never consumed |
| L3 | Low | sprite-animation.ts | `play*` doesn't reset `onEnd`/`removeWhenFinished` |
| L4 | Low | sprite-animation.ts | `manager._binding` retained after dispose |
| L5 | Low | sprite-animation.ts | Misleading `?.` on `_engine` |
| L6 | Low | lab/src/_shared/player-sprite.ts | Duplicates engine algorithm — flag |
| L7 | Low | 4 family helper files | Missing file headers |
| N1 | Nit | sprite-animation.ts | Document strict-`>` timing |
| N2 | Nit | sprite-animation.ts | `_rafId = 0` sentinel assumption |
| N3 | Nit | index.ts | Adjacent export blocks could merge |
| N4 | Nit | sprite-animation.ts | `unshift` in `_beforeRender` is undocumented |

---

## Things done well (worth keeping)

- **Zero module-level side effects** in the new modules (no top-level
  `new Map`/`Set`/`WeakMap`). Honours GUIDANCE pillar 4.
- **Pure-state interfaces** — `SpriteFrameAnimation`,
  `SpriteAnimationManager`, `SpriteAnimationBinding` are all data;
  behaviour lives in standalone `function`s. Matches pillar 3.
- **Tree-shake-friendly factoring** — the four family helpers each
  pull in only the setters/removers they need, so a scene that only
  uses sprite2d-handle animation will not drag in billboard code.
- **Babylon-faithful timing** — the strict `>` + `% delayMs` semantics
  match Babylon ThinSprite; the parity demo will reproduce
  reference output exactly when seeded.
- **Two demo scenes registered correctly** — `scene-config.json`
  ceilings, `maxMad`, `tags`, plus `bundle-size.spec.ts`
  `SPRITE_USING_IDS` updates, plus the billboard-renderable
  required-set update for scene59. Lab gallery and bundle build
  pick them up via auto-discovery, no manual list edits needed.
- **Handles-based variants do the right thing** under swap-remove
  (handle identity is remapped by the layer) — only the index
  variants are dangerous.
