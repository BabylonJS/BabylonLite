// Reusable Lottie feature analyzer for the morph-player prototype.
//
//   node prototypes/lottie-morph/tools/analyze.mjs <path-to-lottie.json>
//
// Reports the file's structure and — crucially — classifies every feature it uses as
// either SUPPORTED (the player already handles it) or NEW (needs work before it renders
// correctly). This is step 1 of the per-file feature-addition loop.

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
    console.error("usage: node analyze.mjs <lottie.json>");
    process.exit(1);
}
const j = JSON.parse(readFileSync(path, "utf8"));

// ─── What the player supports today (the baseline) ───────────────────────────
const SUPPORTED = {
    layerTypes: new Set([4]), // shape only (null=3 is parsed-but-skipped)
    shapeItems: new Set(["gr", "sh", "fl", "gf", "tr"]), // group, path, solid fill, gradient fill, transform
    fillRule: new Set([1]), // nonzero winding only
    gradientTypes: new Set([1, 2]), // linear + radial
};

const LAYER_TY = { 0: "precomp", 1: "solid", 2: "image", 3: "null", 4: "shape", 5: "text", 6: "audio", 13: "camera" };
const SHAPE_TY = {
    gr: "group",
    sh: "path",
    rc: "rect",
    el: "ellipse",
    sr: "star/polystar",
    fl: "fill",
    gf: "gradientFill",
    st: "stroke",
    gs: "gradientStroke",
    tr: "transform",
    tm: "trimPath",
    rp: "repeater",
    mm: "mergePath",
    rd: "roundCorners",
    op: "offsetPath",
};

const found = {
    layerTypes: new Map(),
    shapeItems: new Map(),
    fillRules: new Set(),
    gradientTypes: new Set(),
    morphingPaths: 0,
    staticPaths: 0,
    inconsistentMorphs: [],
    flags: new Set(),
    animatedGradients: 0,
};

function note(set, key) {
    set.set(key, (set.get(key) || 0) + 1);
}

function walkShapes(items) {
    for (const it of items || []) {
        note(found.shapeItems, it.ty);
        switch (it.ty) {
            case "sh":
                if (it.ks?.a === 1) {
                    found.morphingPaths++;
                    const kfs = it.ks.k.map((k) => (k.s?.[0]?.v ? k.s[0].v.length : -1)).filter((n) => n >= 0);
                    if (new Set(kfs).size > 1) {
                        found.inconsistentMorphs.push({ nm: it.nm, counts: kfs });
                    }
                } else {
                    found.staticPaths++;
                }
                break;
            case "fl":
                if (it.r !== undefined) {
                    found.fillRules.add(it.r);
                }
                break;
            case "gf":
                found.gradientTypes.add(it.t);
                if (it.g?.k?.a === 1 || it.s?.a === 1 || it.e?.a === 1) {
                    found.animatedGradients++;
                }
                break;
            case "st":
            case "gs":
                if (it.d) {
                    found.flags.add("stroke dashes (st.d)");
                }
                if ((it.w?.a === 1 ? 1 : it.w?.k) > 0 || it.w?.a === 1) {
                    found.flags.add("visible strokes (width > 0)");
                }
                break;
        }
        if (it.x) {
            found.flags.add("expressions (.x)");
        }
        if (it.it) {
            walkShapes(it.it);
        }
    }
}

for (const L of j.layers || []) {
    note(found.layerTypes, L.ty);
    if (L.parent !== undefined) {
        found.flags.add("layer parenting (parent)");
    }
    if (L.tt !== undefined || L.td !== undefined) {
        found.flags.add("track mattes (tt/td)");
    }
    if (L.hasMask || (L.masksProperties && L.masksProperties.length)) {
        found.flags.add("masks (masksProperties)");
    }
    if (L.ef && L.ef.length) {
        found.flags.add("effects (ef)");
    }
    if (L.bm) {
        found.flags.add("blend modes (bm)");
    }
    if (L.ks?.p?.s === true) {
        found.flags.add("split position (p.s)");
    }
    if (L.ks?.sk?.k || L.ks?.sa?.k) {
        found.flags.add("skew (sk/sa)");
    }
    if (L.ty === 5) {
        found.flags.add("text layers (ty 5)");
    }
    if (L.ty === 0) {
        found.flags.add("precomp layers (ty 0)");
    }
    if (L.ty === 2) {
        found.flags.add("image layers (ty 2)");
    }
    if (L.shapes) {
        walkShapes(L.shapes);
    }
}
if (j.assets && j.assets.length) {
    found.flags.add(`assets (${j.assets.length})`);
}
if (j.chars && j.chars.length) {
    found.flags.add("embedded font chars");
}

// ─── Report ──────────────────────────────────────────────────────────────────
const ok = (s) => `  \x1b[32m✓ supported\x1b[0m  ${s}`;
const neu = (s) => `  \x1b[33m+ NEW\x1b[0m       ${s}`;

console.log(`\n=== ${path.split(/[\\/]/).pop()} ===`);
console.log(`  v${j.v}  ${j.w}x${j.h}  frames ${j.ip}-${j.op} @ ${j.fr}fps  layers ${j.layers?.length ?? 0}  assets ${j.assets?.length ?? 0}`);

console.log(`\nLayer types:`);
for (const [ty, n] of found.layerTypes) {
    const line = `${LAYER_TY[ty] ?? "ty" + ty} x${n}`;
    console.log(SUPPORTED.layerTypes.has(ty) || ty === 3 ? ok(line) : neu(line));
}

console.log(`\nShape items:`);
for (const [ty, n] of found.shapeItems) {
    const line = `${SHAPE_TY[ty] ?? ty} x${n}`;
    console.log(SUPPORTED.shapeItems.has(ty) ? ok(line) : neu(line));
}

console.log(`\nPaths:  ${found.morphingPaths} morphing, ${found.staticPaths} static`);
if (found.inconsistentMorphs.length) {
    console.log(neu(`morphs with INCONSISTENT vertex counts (needs vertex resampling): ${found.inconsistentMorphs.length}`));
    for (const m of found.inconsistentMorphs.slice(0, 5)) {
        console.log(`      "${m.nm}" counts=${JSON.stringify(m.counts)}`);
    }
}

if (found.fillRules.size) {
    console.log(`\nFill rules:`);
    for (const r of found.fillRules) {
        console.log(SUPPORTED.fillRule.has(r) ? ok(r === 1 ? "nonzero (1)" : String(r)) : neu(r === 2 ? "even-odd (2)" : "rule " + r));
    }
}

if (found.gradientTypes.size) {
    console.log(`\nGradients:`);
    for (const t of found.gradientTypes) {
        console.log(SUPPORTED.gradientTypes.has(t) ? ok(t === 1 ? "linear" : "radial") : neu("type " + t));
    }
    if (found.animatedGradients) {
        console.log(neu(`animated gradient stops/endpoints x${found.animatedGradients} (currently sampled static)`));
    }
}

console.log(`\nOther features:`);
if (found.flags.size === 0) {
    console.log(ok("none beyond the baseline"));
} else {
    for (const f of [...found.flags].sort()) {
        console.log(neu(f));
    }
}

const newCount =
    [...found.layerTypes].filter(([t]) => !SUPPORTED.layerTypes.has(t) && t !== 3).length +
    [...found.shapeItems].filter(([t]) => !SUPPORTED.shapeItems.has(t)).length +
    found.flags.size +
    (found.inconsistentMorphs.length ? 1 : 0);
console.log(`\n${newCount === 0 ? "\x1b[32mFully supported today — should render as-is.\x1b[0m" : `\x1b[33m${newCount} new feature area(s) to add.\x1b[0m`}\n`);
