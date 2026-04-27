import * as fs from 'fs';
import { PNG } from 'pngjs';
const lit = PNG.sync.read(fs.readFileSync('reference/scene72-nme-pbr-full/test-actual.png'));
const ref = PNG.sync.read(fs.readFileSync('reference/scene72-nme-pbr-full/babylon-ref-golden.png'));
const samples = [
    ['sphere-center', 640, 350],
    ['sphere-top-spec', 640, 250],
    ['sphere-l-edge', 540, 350],
    ['sphere-r-edge', 740, 350],
    ['sphere-bot-refr', 640, 420],
    ['ground-near', 640, 500],
    ['ground-far', 400, 500],
    ['sky', 100, 100],
];
for (const [name, x, y] of samples) {
    const i = (y * lit.width + x) * 4;
    const lr = lit.data[i], lg = lit.data[i + 1], lb = lit.data[i + 2];
    const rr = ref.data[i], rg = ref.data[i + 1], rb = ref.data[i + 2];
    console.log(name.padEnd(18), `L=(${lr},${lg},${lb})`.padEnd(22), `B=(${rr},${rg},${rb})`.padEnd(22), `dL=(${lr - rr},${lg - rg},${lb - rb})`);
}
