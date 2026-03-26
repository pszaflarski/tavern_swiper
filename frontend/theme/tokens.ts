/**
 * Design tokens extracted from the Stitch "The Enchanted Interface" design system.
 * Primary: Noto Serif (headlines) + Manrope (body/labels)
 * Palette: "Parchment and Shadow" — forest greens, royal magic, burnt gold
 */

export const Colors = {
  // Primary — Dark Velvet Forest
  primary: '#012d1d',
  primaryContainer: '#1b4332',
  primaryFixed: '#c1ecd4',
  primaryFixedDim: '#a5d0b9',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#86af99',

  // Secondary — Royal Magic
  secondary: '#843ab4',
  secondaryContainer: '#cc80fd',
  secondaryFixed: '#f4d9ff',
  onSecondary: '#ffffff',
  onSecondaryContainer: '#580087',

  // Tertiary — Burnt Gold
  tertiary: '#735c00',
  tertiaryContainer: '#cba72f',
  tertiaryFixed: '#ffe088',
  tertiaryFixedDim: '#e9c349',
  onTertiary: '#ffffff',
  onTertiaryContainer: '#4e3d00',

  // Surface — Parchment hierarchy
  background: '#fff9ed',
  surface: '#fff9ed',
  surfaceBright: '#fff9ed',
  surfaceContainer: '#f7eed2',
  surfaceContainerHigh: '#f1e8cd',
  surfaceContainerHighest: '#ebe2c8',
  surfaceContainerLow: '#fcf3d8',
  surfaceContainerLowest: '#ffffff',
  surfaceDim: '#e2dabf',
  surfaceTint: '#3f6653',
  surfaceVariant: '#ebe2c8',

  // On-surface
  onBackground: '#1f1c0b',
  onSurface: '#1f1c0b',
  onSurfaceVariant: '#414844',

  // Outline
  outline: '#717973',
  outlineVariant: '#c1c8c2',

  // Error
  error: '#ba1a1a',
  onError: '#ffffff',

  // Inverse
  inverseSurface: '#35301e',
  inverseOnSurface: '#faf0d5',
  inversePrimary: '#a5d0b9',
};

export const Fonts = {
  heroic: 'NotoSerif',        // Display + headline — The Heroic Voice
  scribe: 'Manrope',          // Body + labels — The Scribe's Hand
};

export const Radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
  // "Hand-cut" asymmetric card corners (per design system)
  cardTL: 24,  // top-left / bottom-right
  cardBR: 24,
  cardTR: 12,  // top-right / bottom-left
  cardBL: 12,
};

export const Spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
};

export const Shadow = {
  // "Magical Glow" — candle-lit shadow (on_surface at 6% opacity)
  waxSeal: {
    shadowColor: '#1f1c0b',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
};
