import type { MetadataRoute } from "next";

/**
 * The web app manifest.
 *
 * A wallet is used from a home screen, not a browser tab. Without this, "add to
 * home screen" produces a bookmark with a screenshot for an icon and browser
 * chrome over the top; with it, it opens standalone, on the app's own
 * background, with the YOZEXA mark.
 *
 * `theme_color` and `background_color` must stay equal to --yzx-bg in
 * globals.css and to themeColor in layout.tsx: they paint the OS chrome and
 * the launch screen, and a drift shows as a seam.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YOZEXA Wallet",
    short_name: "YOZEXA",
    description: "Own. Move. Build. Self-custody wallet for the YOZEXA Network.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07080d",
    theme_color: "#07080d",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      // Android's launcher needs a raster icon; apple-icon.png is exported
      // from icon.svg by scripts/generate-icons.mjs.
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180", purpose: "maskable" },
    ],
  };
}
