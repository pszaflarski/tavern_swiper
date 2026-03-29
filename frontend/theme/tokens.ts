/**
 * Design tokens extracted from the Stitch "The Enchanted Interface" design system.
 * Primary: Noto Serif (headlines) + Manrope (body/labels)
 * Palette: "Parchment and Shadow" — forest greens, royal magic, burnt gold
 */

export const Colors = {
  // Primary — Midnight Forest Glow
  primary: '#006d4e',
  primaryContainer: '#004d33',
  primaryFixed: '#88f8c8',
  primaryFixedDim: '#6bdcad',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#cce8e0',

  // Secondary — Midnight Magic
  secondary: '#823bc5',
  secondaryContainer: '#4a0080',
  secondaryFixed: '#f1dbff',
  onSecondary: '#ffffff',
  onSecondaryContainer: '#f1dbff',

  // Tertiary — Glowing Gold
  tertiary: '#d4af37',
  tertiaryContainer: '#715a00',
  tertiaryFixed: '#ffe08c',
  tertiaryFixedDim: '#e3c46a',
  onTertiary: '#3e2e00',
  onTertiaryContainer: '#ffe08c',

  // Surface — Obsidian Grimoire hierarchy
  background: '#001a11',
  surface: '#001a11',
  surfaceBright: '#343b38',
  surfaceContainer: '#1a211e',
  surfaceContainerHigh: '#242b28',
  surfaceContainerHighest: '#2f3632',
  surfaceContainerLow: '#161d1a',
  surfaceContainerLowest: '#0d110f',
  surfaceDim: '#0d110f',
  surfaceTint: '#6bdcad',
  surfaceVariant: '#3f4945',

  // On-surface — Ivory/Ink contrast
  onBackground: '#e4e1e9',
  onSurface: '#e4e1e9',
  onSurfaceVariant: '#bfc9c4',

  // Outline
  outline: '#89938f',
  outlineVariant: '#3f4945',

  // Error
  error: '#ffb4ab',
  onError: '#690005',

  // Inverse
  inverseSurface: '#e4e1e9',
  inverseOnSurface: '#001a11',
  inversePrimary: '#006d4e',
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
