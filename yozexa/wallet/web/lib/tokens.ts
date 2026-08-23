/**
 * Typed handles on the design tokens.
 *
 * These are variable *names*, not values. The values live once, in
 * app/globals.css. Importing from here means TypeScript catches a typo in a
 * token name, and it stays impossible to write a hex value into a component.
 */

export const color = {
  brand: "var(--yzx-brand)",
  brandStrong: "var(--yzx-brand-strong)",
  brandSoft: "var(--yzx-brand-soft)",
  brandBlue: "var(--yzx-brand-blue)",
  brandInk: "var(--yzx-brand-ink)",
  brandWash: "var(--yzx-brand-wash)",
  brandEdge: "var(--yzx-brand-edge)",
  brandGradient: "var(--yzx-brand-gradient)",
  brandGradientSoft: "var(--yzx-brand-gradient-soft)",

  bg: "var(--yzx-bg)",
  surface: "var(--yzx-surface)",
  surfaceRaised: "var(--yzx-surface-raised)",
  surfaceSunken: "var(--yzx-surface-sunken)",
  surfaceOverlay: "var(--yzx-surface-overlay)",

  border: "var(--yzx-border)",
  borderStrong: "var(--yzx-border-strong)",

  text: "var(--yzx-text)",
  textSecondary: "var(--yzx-text-secondary)",
  textTertiary: "var(--yzx-text-tertiary)",
  textInverse: "var(--yzx-text-inverse)",

  positive: "var(--yzx-positive)",
  positiveWash: "var(--yzx-positive-wash)",
  negative: "var(--yzx-negative)",
  negativeWash: "var(--yzx-negative-wash)",
  warning: "var(--yzx-warning)",
  warningWash: "var(--yzx-warning-wash)",
  neutralWash: "var(--yzx-neutral-wash)",
} as const;

export const type = {
  sans: "var(--yzx-font-sans)",
  mono: "var(--yzx-font-mono)",

  size2xs: "var(--yzx-text-2xs)",
  sizeXs: "var(--yzx-text-xs)",
  sizeSm: "var(--yzx-text-sm)",
  sizeBase: "var(--yzx-text-base)",
  sizeMd: "var(--yzx-text-md)",
  sizeLg: "var(--yzx-text-lg)",
  sizeXl: "var(--yzx-text-xl)",
  size2xl: "var(--yzx-text-2xl)",
  size3xl: "var(--yzx-text-3xl)",
  size4xl: "var(--yzx-text-4xl)",

  regular: "var(--yzx-weight-regular)",
  medium: "var(--yzx-weight-medium)",
  semibold: "var(--yzx-weight-semibold)",
  bold: "var(--yzx-weight-bold)",

  leadingTight: "var(--yzx-leading-tight)",
  leadingSnug: "var(--yzx-leading-snug)",
  leadingNormal: "var(--yzx-leading-normal)",

  trackingTight: "var(--yzx-tracking-tight)",
  trackingWide: "var(--yzx-tracking-wide)",
} as const;

export const space = {
  1: "var(--yzx-space-1)",
  2: "var(--yzx-space-2)",
  3: "var(--yzx-space-3)",
  4: "var(--yzx-space-4)",
  5: "var(--yzx-space-5)",
  6: "var(--yzx-space-6)",
  8: "var(--yzx-space-8)",
  10: "var(--yzx-space-10)",
  12: "var(--yzx-space-12)",
  16: "var(--yzx-space-16)",
} as const;

export const radius = {
  sm: "var(--yzx-radius-sm)",
  md: "var(--yzx-radius-md)",
  lg: "var(--yzx-radius-lg)",
  xl: "var(--yzx-radius-xl)",
  "2xl": "var(--yzx-radius-2xl)",
  full: "var(--yzx-radius-full)",
} as const;

export const shadow = {
  sm: "var(--yzx-shadow-sm)",
  md: "var(--yzx-shadow-md)",
  lg: "var(--yzx-shadow-lg)",
  brand: "var(--yzx-shadow-brand)",
  inset: "var(--yzx-shadow-inset)",
} as const;

export const motion = {
  instant: "var(--yzx-duration-instant)",
  fast: "var(--yzx-duration-fast)",
  normal: "var(--yzx-duration-normal)",
  slow: "var(--yzx-duration-slow)",
  ease: "var(--yzx-ease)",
  easeOut: "var(--yzx-ease-out)",
} as const;

export const layout = {
  appWidth: "var(--yzx-app-width)",
  tabBarHeight: "var(--yzx-tabbar-height)",
  touchTarget: "var(--yzx-touch-target)",
} as const;
