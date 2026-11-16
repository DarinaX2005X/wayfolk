// Brings figure files to the canonical form after points were edited by hand: height 100, base on
// y = 0, centre of the width on x = 0, one decimal, outer rings counter-clockwise, one layout.
//
//   node tools/art/fit.mjs             every figure
//   node tools/art/fit.mjs sun moon    only these
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CUTOUT_DIR, formatCutout, listCutoutIds, normalizeCutout, readCutout } from './lib.mjs';

const asked = process.argv.slice(2);
const ids = asked.length ? asked : listCutoutIds();
for (const id of ids) {
  const file = path.join(CUTOUT_DIR, `${id}.ts`);
  writeFileSync(file, formatCutout(normalizeCutout(readCutout(id))));
}
console.log(`fitted ${ids.length} figures`);
