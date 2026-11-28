import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const output = new URL("../frontend/public/pwa/", import.meta.url);
const logo = new URL("../frontend/public/gather-dessert-invoice-logo.webp", import.meta.url);
await mkdir(output, { recursive: true });
const source = await readFile(logo);
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
  const padding = Math.round(size * 0.08);
  const image = await sharp(source)
    .resize(size - padding * 2, size - padding * 2, { fit: "contain", background: "#fff6d6" })
    .flatten({ background: "#fff6d6" })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: "#fff6d6" })
    .png().toBuffer();
  await writeFile(new URL(`${name}.png`, output), image);
}
