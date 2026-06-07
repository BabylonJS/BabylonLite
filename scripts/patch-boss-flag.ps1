$f = 'lab/lite/src/demos/platformer/game.ts'
$t = [IO.File]::ReadAllText($f)
$nl = if ($t.Contains("`r`n")) { "`r`n" } else { "`n" }
$fails = 0
function Rep($old, $new, $label) {
    if ($script:t.Contains($old)) { $script:t = $script:t.Replace($old, $new); Write-Output "ok: $label" }
    else { $script:fails++; Write-Output "MISS: $label" }
}

# --- Edit 1: widen boss hitbox ---
Rep 'const BOSS_W = TILE * 2.4; // collision box (close to the drawn size)' `
    'const BOSS_W = TILE * 2.8; // collision box (tuned to cover the drawn spider body)' 'BOSS_W'

# --- Edit 2: taller boss hitbox so the box top reaches the drawn head ---
Rep 'const BOSS_H = TILE * 1.7;' `
    'const BOSS_H = TILE * 2.35; // box top reaches the drawn head so the boss is stompable' 'BOSS_H'

# --- Edit 3: more forgiving stomp window ---
Rep '        const stomping = player.vy > 0 && feet - boss.box.y < boss.box.h * 0.55;' `
    '        const stomping = player.vy > 0 && feet - boss.box.y < boss.box.h * 0.6;' 'stomp window'

# --- Edit 4: flag stays static at the bottom, only waves once it rises ---
$n4 = @(
'            // Static (resting) flag while at the bottom; it only waves once it rises.',
'            const flagName = raiseK > 0 && Math.floor(game.flagAnimT * 6) % 2 === 1 ? "flagGreen2" : "flagGreen";'
) -join $nl
Rep '            const flagName = Math.floor(game.flagAnimT * 6) % 2 === 0 ? "flagGreen" : "flagGreen2";' `
    $n4 'flag flap'

# --- Edit 5: TEMP DEBUG hook (single-line anchor, EOL-safe) ---
$hook = @(
'    const __dbgPlay = (): void => { if (game.phase === "title" || game.phase === "ready") { hud.title(false); game.phase = "playing"; hud.banner(null); } };',
'    (window as unknown as { __dbg: unknown }).__dbg = {',
'        play: __dbgPlay,',
'        goCastle(): void { __dbgPlay(); loadArea("castle", "start"); },',
'        dropOnBoss(): void { __dbgPlay(); player.big = true; player.fire = true; player.box.w = bigSize.w; player.box.h = bigSize.h; player.invuln = 0; player.box.x = boss.box.x + boss.box.w / 2 - player.box.w / 2; player.box.y = boss.box.y - player.box.h - 6; player.vx = 0; player.vy = 80; },',
'        get diag(): unknown { return { hp: boss.hp, active: boss.active, bossTop: Math.round(boss.box.y), bossBot: Math.round(boss.box.y + boss.box.h), pFeet: Math.round(player.box.y + player.box.h), pVy: Math.round(player.vy), pBig: player.big, pInvuln: +player.invuln.toFixed(2) }; },',
'    };'
) -join $nl
Rep '    canvas.dataset.ready = "true";' ($hook + $nl + '    canvas.dataset.ready = "true";') 'debug hook'

if ($fails -gt 0) { Write-Output "FAILS: $fails (NOT writing)" }
else { [IO.File]::WriteAllText($f, $t); Write-Output "FAILS: 0 (written)" }
