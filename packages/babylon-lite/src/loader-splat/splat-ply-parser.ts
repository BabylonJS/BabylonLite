/** .ply Gaussian-Splatting parser.
 *
 *  Pure function: ArrayBuffer (.ply asset) → ArrayBuffer in the standard
 *  `splat` row layout used by the rest of the loader (32 bytes / splat:
 *    bytes  0..11  → float32 position (x, y, z)
 *    bytes 12..23  → float32 scale    (sx, sy, sz, exp-mapped)
 *    bytes 24..27  → uint8   colour   (r, g, b, a)
 *    bytes 28..31  → uint8   rotation (qw, qx, qy, qz, normalised, biased by 128)
 *
 *  Mirrors the algorithm BJS uses in `GaussianSplattingMesh.ConvertPLYToSplat`
 *  (originally adapted from gsplat.js, MIT). If the input is not a recognisable
 *  PLY header the original buffer is returned unchanged so callers can layer
 *  the .splat fast-path on top without re-sniffing. */

const SH_C0 = 0.28209479177387814;

/** True when the buffer starts with a PLY ASCII header that contains `end_header\n`. */
export function isPly(data: ArrayBuffer): boolean {
    const ubuf = new Uint8Array(data, 0, Math.min(data.byteLength, 1024 * 10));
    const header = new TextDecoder().decode(ubuf);
    return header.startsWith("ply") && header.indexOf("end_header\n") >= 0;
}

/** Decode a PLY ArrayBuffer into the engine's internal splat row layout.
 *  Returns the input untouched when it isn't a PLY (caller can pass through). */
export function convertPlyToSplat(data: ArrayBuffer): ArrayBuffer {
    const ubuf = new Uint8Array(data);
    const header = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
    const headerEnd = "end_header\n";
    const headerEndIndex = header.indexOf(headerEnd);
    if (headerEndIndex < 0) {
        return data;
    }

    const vmatch = /element vertex (\d+)\n/.exec(header);
    if (!vmatch) {
        return data;
    }
    const vertexCount = parseInt(vmatch[1]!, 10);

    const offsets: Record<string, number> = { double: 8, int: 4, uint: 4, float: 4, short: 2, ushort: 2, uchar: 1 };
    const properties: { name: string; type: string; offset: number }[] = [];
    let rowOffset = 0;
    for (const line of header.slice(0, headerEndIndex).split("\n")) {
        if (!line.startsWith("property ")) {
            continue;
        }
        const [, type, name] = line.split(" ");
        if (!type || !name || offsets[type] === undefined) {
            return new ArrayBuffer(0);
        }
        properties.push({ name, type, offset: rowOffset });
        rowOffset += offsets[type]!;
    }

    const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
    const dv = new DataView(data, headerEndIndex + headerEnd.length);
    const out = new ArrayBuffer(rowLength * vertexCount);

    for (let i = 0; i < vertexCount; i++) {
        const position = new Float32Array(out, i * rowLength, 3);
        const scale = new Float32Array(out, i * rowLength + 12, 3);
        const rgba = new Uint8ClampedArray(out, i * rowLength + 24, 4);
        const rot = new Uint8ClampedArray(out, i * rowLength + 28, 4);

        let r0 = 255,
            r1 = 0,
            r2 = 0,
            r3 = 0;

        const base = i * rowOffset;
        for (let p = 0; p < properties.length; p++) {
            const prop = properties[p]!;
            let value: number;
            switch (prop.type) {
                case "float":
                    value = dv.getFloat32(prop.offset + base, true);
                    break;
                case "int":
                    value = dv.getInt32(prop.offset + base, true);
                    break;
                case "uint":
                    value = dv.getUint32(prop.offset + base, true);
                    break;
                case "uchar":
                    value = dv.getUint8(prop.offset + base);
                    break;
                case "short":
                    value = dv.getInt16(prop.offset + base, true);
                    break;
                case "ushort":
                    value = dv.getUint16(prop.offset + base, true);
                    break;
                case "double":
                    value = dv.getFloat64(prop.offset + base, true);
                    break;
                default:
                    return new ArrayBuffer(0);
            }
            switch (prop.name) {
                case "x":
                    position[0] = value;
                    break;
                case "y":
                    position[1] = value;
                    break;
                case "z":
                    position[2] = value;
                    break;
                case "scale_0":
                    scale[0] = Math.exp(value);
                    break;
                case "scale_1":
                    scale[1] = Math.exp(value);
                    break;
                case "scale_2":
                    scale[2] = Math.exp(value);
                    break;
                case "red":
                    rgba[0] = value;
                    break;
                case "green":
                    rgba[1] = value;
                    break;
                case "blue":
                    rgba[2] = value;
                    break;
                case "f_dc_0":
                    rgba[0] = (0.5 + SH_C0 * value) * 255;
                    break;
                case "f_dc_1":
                    rgba[1] = (0.5 + SH_C0 * value) * 255;
                    break;
                case "f_dc_2":
                    rgba[2] = (0.5 + SH_C0 * value) * 255;
                    break;
                case "f_dc_3":
                    rgba[3] = (0.5 + SH_C0 * value) * 255;
                    break;
                case "opacity":
                    rgba[3] = (1 / (1 + Math.exp(-value))) * 255;
                    break;
                case "rot_0":
                    r0 = value;
                    break;
                case "rot_1":
                    r1 = value;
                    break;
                case "rot_2":
                    r2 = value;
                    break;
                case "rot_3":
                    r3 = value;
                    break;
            }
        }

        // Normalise (r0,r1,r2,r3) and bias to uint8 range. Original BJS layout: w,x,y,z.
        // Bias 127.5/127.5 matches BJS's `_GetSplat` (round-trips byte-for-byte).
        const len = Math.hypot(r0, r1, r2, r3) || 1;
        const inv = 1 / len;
        rot[0] = r0 * inv * 127.5 + 127.5;
        rot[1] = r1 * inv * 127.5 + 127.5;
        rot[2] = r2 * inv * 127.5 + 127.5;
        rot[3] = r3 * inv * 127.5 + 127.5;
    }

    return out;
}
