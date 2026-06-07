# Re-apply ALL real game.ts edits from the clean HEAD baseline (no temp __dbg hook).
# Recovers last turn's boss-stomp + flag fixes (which were uncommitted) plus this turn's edits.
$game = 'lab/lite/src/demos/platformer/game.ts'
$t = [IO.File]::ReadAllText($game)
$fails = 0
function Rep([ref]$txt, $old, $new, $label) {
    if ($txt.Value.Contains($old)) { $txt.Value = $txt.Value.Replace($old, $new); Write-Output "ok: $label" }
    else { $script:fails++; Write-Output "MISS: $label" }
}

# ── Last turn: boss is stompable (hitbox matches the drawn spider) ──
Rep ([ref]$t) `
    'const BOSS_W = TILE * 2.4; // collision box (close to the drawn size)' `
    'const BOSS_W = TILE * 2.8; // collision box (tuned to cover the drawn spider body)' `
    'BOSS_W'
Rep ([ref]$t) `
    'const BOSS_H = TILE * 1.7;' `
    'const BOSS_H = TILE * 2.35; // box top reaches the drawn head so the boss is stompable' `
    'BOSS_H'
Rep ([ref]$t) `
    'const stomping = player.vy > 0 && feet - boss.box.y < boss.box.h * 0.55;' `
    'const stomping = player.vy > 0 && feet - boss.box.y < boss.box.h * 0.6;' `
    'boss stomp window'

# ── This turn: debris drops the blue-grey frames (brown chunks only) ──
Rep ([ref]$t) `
    'const particleFrames = ["particleBrick1a", "particleBrick1b", "particleBrick2a", "particleBrick2b"].map((n) => items.frameOf(n));' `
    'const particleFrames = ["particleBrick1a", "particleBrick1b"].map((n) => items.frameOf(n));' `
    'debris frames'

# ── Last+this turn: flag droops (hanging) at rest, only waves once raised ──
Rep ([ref]$t) `
    'const flagName = Math.floor(game.flagAnimT * 6) % 2 === 0 ? "flagGreen" : "flagGreen2";' `
    'const flagName = raiseK <= 0 ? "flagGreenHanging" : (Math.floor(game.flagAnimT * 6) % 2 === 1 ? "flagGreen2" : "flagGreen");' `
    'flag resting tile'

# ── This turn: cave/castle backdrop uses bg_castle.png ──
Rep ([ref]$t) `
    'import { IRIS_FRAGMENT, makeCaveBackdropDataUrl, makePipeTextureDataUrl, makeWhiteTextureDataUrl } from "./portal.js";' `
    'import { IRIS_FRAGMENT, makePipeTextureDataUrl, makeWhiteTextureDataUrl } from "./portal.js";' `
    'bg import'
Rep ([ref]$t) `
    'loadTexture2D(engine, makeCaveBackdropDataUrl(), {' `
    'loadTexture2D(engine, "/platformer/backgrounds/bg_castle.png", {' `
    'bg texture'

if ($fails -gt 0) { Write-Output "FAILS: $fails (NOT writing)" }
else { [IO.File]::WriteAllText($game, $t); Write-Output "FAILS: 0 (written)" }
