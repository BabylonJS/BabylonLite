// Generates a deterministic, stylized equirectangular "Earth-like" texture
// (blue oceans, green/tan continents, polar ice) using seeded 3D value noise so
// there are no longitude seams or pole pinching. Output is committed and loaded
// by parity scene 225 (both Lite and BJS load the same PNG → pixel parity).
//
// Usage: node scripts/gen-earth-texture.mjs
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../lab/public/textures/earth-procedural.png");

const W = 1024;
const H = 512;
const SEED = 1337;

// --- seeded 3D value noise -------------------------------------------------
function hash(ix, iy, iz) {
    let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + SEED * 1013904223) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function valueNoise3(x, y, z) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
    const c000 = hash(x0, y0, z0), c100 = hash(x0 + 1, y0, z0);
    const c010 = hash(x0, y0 + 1, z0), c110 = hash(x0 + 1, y0 + 1, z0);
    const c001 = hash(x0, y0, z0 + 1), c101 = hash(x0 + 1, y0, z0 + 1);
    const c011 = hash(x0, y0 + 1, z0 + 1), c111 = hash(x0 + 1, y0 + 1, z0 + 1);
    const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
    const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

function fbm(x, y, z) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < 6; o++) {
        sum += amp * valueNoise3(x * freq, y * freq, z * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function smoothstep(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

// Palette (linear-ish 0..1)
const DEEP = [0.015, 0.07, 0.22];
const SHALLOW = [0.05, 0.27, 0.5];
const COAST = [0.12, 0.5, 0.55];
const LOWLAND = [0.16, 0.38, 0.14];
const MIDLAND = [0.32, 0.42, 0.16];
const HIGHLAND = [0.45, 0.38, 0.27];
const SNOW = [0.92, 0.94, 0.97];

const NOISE_FREQ = 2.4;
const SEA_LEVEL = 0.56;

const png = new PNG({ width: W, height: H });

for (let py = 0; py < H; py++) {
    const lat = (0.5 - py / H) * Math.PI; // +pi/2 .. -pi/2
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let px = 0; px < W; px++) {
        const lon = (px / W) * 2 * Math.PI - Math.PI;
        // Point on unit sphere → seamless sampling.
        const nx = cosLat * Math.cos(lon);
        const ny = cosLat * Math.sin(lon);
        const nz = sinLat;

        let h = fbm(nx * NOISE_FREQ + 5, ny * NOISE_FREQ + 9, nz * NOISE_FREQ + 2);

        let col;
        if (h < SEA_LEVEL) {
            const depth = (SEA_LEVEL - h) / SEA_LEVEL; // 0 coast .. 1 deep
            col = depth < 0.12 ? mix(COAST, SHALLOW, depth / 0.12) : mix(SHALLOW, DEEP, smoothstep(0.12, 1, depth));
        } else {
            const t = (h - SEA_LEVEL) / (1 - SEA_LEVEL); // 0 .. 1
            if (t < 0.45) col = mix(LOWLAND, MIDLAND, t / 0.45);
            else if (t < 0.78) col = mix(MIDLAND, HIGHLAND, (t - 0.45) / 0.33);
            else col = mix(HIGHLAND, SNOW, (t - 0.78) / 0.22);
            // subtle high-frequency variation on land
            const v = valueNoise3(nx * 18, ny * 18, nz * 18) - 0.5;
            col = [clamp01(col[0] + v * 0.05), clamp01(col[1] + v * 0.05), clamp01(col[2] + v * 0.04)];
        }

        // Polar ice caps (blend to snow toward the poles, a bit lower on land).
        const absLatDeg = Math.abs((lat * 180) / Math.PI);
        const iceStart = h < SEA_LEVEL ? 74 : 66;
        const ice = smoothstep(iceStart, iceStart + 10, absLatDeg);
        if (ice > 0) col = mix(col, SNOW, ice);

        const idx = (py * W + px) << 2;
        png.data[idx] = Math.round(clamp01(col[0]) * 255);
        png.data[idx + 1] = Math.round(clamp01(col[1]) * 255);
        png.data[idx + 2] = Math.round(clamp01(col[2]) * 255);
        png.data[idx + 3] = 255;
    }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, PNG.sync.write(png));
console.log("wrote", OUT, `${W}x${H}`);
