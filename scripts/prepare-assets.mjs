import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../public/assets/", import.meta.url));
await mkdir(output, { recursive: true });
const home = homedir();
const catalog = `${home}/Stackwise-launch/Stackwise/Assets.xcassets`;
const jobs = {
  // Original Rekianime face: brand mark, hero note, header.
  "reki-face.webp": [`${home}/Downloads/Rekianime/Meshy_AI_reki-mascot-face-v4.png`, 256, 85],
  // Transparent iOS mascot poses for the guided tour and paid states.
  "reki-waving.webp": [`${catalog}/RekiWaving.imageset/reki-waving.png`, 480, 88],
  "reki-pointing.webp": [`${catalog}/RekiPointing.imageset/reki-pointing.png`, 480, 88],
  "reki-thumbsup.webp": [`${catalog}/RekiThumbsUp.imageset/reki-thumbsup.png`, 480, 88],
  "reki-celebrating.webp": [`${catalog}/RekiCelebrating.imageset/reki-celebrating.png`, 480, 88],
  "reki-heart.webp": [`${catalog}/RekiHeart.imageset/reki-heart.png`, 480, 88],
};
for (const [name, [src, size, quality]] of Object.entries(jobs)) {
  await sharp(src).resize(size).webp({ quality }).toFile(`${output}${name}`);
}
console.log(`Prepared ${Object.keys(jobs).length} Reki assets. Originals unchanged.`);
