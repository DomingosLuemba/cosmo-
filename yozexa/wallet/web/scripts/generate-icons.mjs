/**
 * Rasterise app/icon.svg into the PNGs that iOS and Android need.
 *
 * app/icon.svg is the source of truth; SVG covers every browser favicon, but
 * an iOS home-screen icon has to be a PNG, so it is exported rather than
 * hand-drawn — the two can never drift apart.
 *
 * Regenerate after changing the mark:
 *
 *   node scripts/generate-icons.mjs
 *
 * Requires Playwright and a Chromium. Neither is a dependency of the wallet —
 * install them ad hoc when the mark changes:
 *
 *   npx --yes playwright@1 install chromium
 *   node scripts/generate-icons.mjs
 *
 * Set CHROMIUM_PATH to use a Chromium that is already on the machine. The
 * generated files are committed, so a normal build never runs this.
 */
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../app/icon.svg");
const outputs = [
  { file: resolve(here, "../app/apple-icon.png"), size: 180 },
];

const svg = await readFile(source, "utf8");
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

try {
  for (const { file, size } of outputs) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    // No page background: the icon paints its own, and a transparent frame
    // around a rounded rectangle is what the platform expects.
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg.replace(
        /width="\d+" height="\d+"/,
        `width="${size}" height="${size}"`,
      )}`,
      { waitUntil: "load" },
    );
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(file, png);
    await page.close();
    console.log(`wrote ${file} (${size}×${size}, ${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
