import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../public/assets/", import.meta.url));
await mkdir(output, { recursive: true });
const home = homedir();
await sharp(`${home}/Downloads/Rekianime/Meshy_AI_reki-mascot-face-v4.png`)
  .resize(256)
  .webp({ quality: 85 })
  .toFile(`${output}reki-face.webp`);
await sharp(
  `${home}/Stackwise-launch/Stackwise/Assets.xcassets/RekiWaving.imageset/reki-waving.png`,
)
  .resize(480)
  .webp({ quality: 88 })
  .toFile(`${output}reki-waving.webp`);
console.log("Prepared two Reki assets. Originals unchanged.");
