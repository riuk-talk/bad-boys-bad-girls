// Generates every brand asset from the two sources in public/brand:
// logo.svg (flat monogram), logo-3d.png (supplied 3D logo, on black: Open Graph image) and
// logo-3d-transparent.png (same logo, transparent: landing).
// Run with `pnpm brand:build` after changing a source file; outputs are committed.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const INK = "#0E0E10";
const brand = new URL("../public/brand/", import.meta.url);
const app = new URL("../app/", import.meta.url);

const monogram = await readFile(new URL("logo.svg", brand), "utf8");
const inner = monogram.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// Square icon: monogram centred on the ink background. `padding` is in viewBox units.
function squareIcon(padding, rounded) {
  const size = 280 + padding * 2;
  const offsetY = padding + (280 - 210) / 2;
  const radius = rounded ? size * 0.18 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${INK}"/>
  <g transform="translate(${padding} ${offsetY})">${inner}</g>
</svg>
`;
}

const icon = squareIcon(24, true);
const maskable = squareIcon(90, false);

await writeFile(new URL("icon.svg", app), icon);
await sharp(Buffer.from(squareIcon(24, false)), { density: 400 })
  .resize(180)
  .png()
  .toFile(new URL("apple-icon.png", app).pathname);
for (const size of [192, 512]) {
  await sharp(Buffer.from(icon), { density: 400 })
    .resize(size)
    .png()
    .toFile(new URL(`icon-${size}.png`, brand).pathname);
}
await sharp(Buffer.from(maskable), { density: 400 })
  .resize(512)
  .png()
  .toFile(new URL("icon-maskable-512.png", brand).pathname);

// Landing hero (LCP element): the transparent 3D logo (black background removed, cropped,
// LANDING-DESIGN.md §1), pre-optimised AVIF with alpha, ~35 % lighter than WebP. Every browser
// supported by Next.js 16 (Safari 16.4+, Chrome/Firefox 111+) decodes AVIF. No runtime
// image optimisation (SPEC §11).
const logo3d = new URL("logo-3d.png", brand).pathname;
const logo3dTransparent = new URL("logo-3d-transparent.png", brand).pathname;
for (const width of [360, 560, 840]) {
  await sharp(logo3dTransparent)
    .resize(width)
    .avif({ quality: 55, effort: 6 })
    .toFile(new URL(`logo-3d-t-${width}.avif`, brand).pathname);
}

// Open Graph image 1200×630: the 3D logo on black (social networks render transparency badly).
const ogLogo = await sharp(logo3d).resize(630).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 3, background: INK } })
  .composite([{ input: ogLogo, left: 285, top: 0 }])
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(new URL("og.jpg", brand).pathname);

console.log("Brand assets generated.");
