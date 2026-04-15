/** Bake localMatrix (pivot) into vertex positions and normals.
 *  Positions: full 4x3 affine. Normals: 3x3 part + renormalize.
 *  Dynamically imported only when the scene uses localMatrix. */
export function bakeLocalMatrix(positions: Float32Array, normals: Float32Array, lm: number[]): void {
    const isIdentity =
        lm[0] === 1 &&
        lm[1] === 0 &&
        lm[2] === 0 &&
        lm[4] === 0 &&
        lm[5] === 1 &&
        lm[6] === 0 &&
        lm[8] === 0 &&
        lm[9] === 0 &&
        lm[10] === 1 &&
        lm[12] === 0 &&
        lm[13] === 0 &&
        lm[14] === 0;
    if (isIdentity) {
        return;
    }

    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!,
            y = positions[i + 1]!,
            z = positions[i + 2]!;
        positions[i] = x * lm[0]! + y * lm[4]! + z * lm[8]! + lm[12]!;
        positions[i + 1] = x * lm[1]! + y * lm[5]! + z * lm[9]! + lm[13]!;
        positions[i + 2] = x * lm[2]! + y * lm[6]! + z * lm[10]! + lm[14]!;
    }

    for (let i = 0; i < normals.length; i += 3) {
        const nx = normals[i]!,
            ny = normals[i + 1]!,
            nz = normals[i + 2]!;
        const rx = nx * lm[0]! + ny * lm[4]! + nz * lm[8]!;
        const ry = nx * lm[1]! + ny * lm[5]! + nz * lm[9]!;
        const rz = nx * lm[2]! + ny * lm[6]! + nz * lm[10]!;
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (len > 1e-10) {
            normals[i] = rx / len;
            normals[i + 1] = ry / len;
            normals[i + 2] = rz / len;
        }
    }
}
