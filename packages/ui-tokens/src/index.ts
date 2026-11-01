/**
 * Design tokens. The web app reads them as CSS variables (dist/tokens.css);
 * the mobile app imports the objects directly.
 *
 * City College of Calapan look: white background, orange accent (#f97316) from the college
 * seal, Poppins. Text on orange is dark brown and orange text uses a deeper shade, because
 * white on #f97316 (2.8:1) and #f97316 on white fail WCAG AA contrast for normal text.
 */

export interface ColorScheme {
  readonly background: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  /** Accent fill: buttons, active navigation, highlights. */
  readonly brand: string;
  /** Text and icons on a brand fill (5.6:1 on brand). */
  readonly brandText: string;
  /** Orange for text and links on white (5.2:1). */
  readonly brandStrong: string;
  /** Pale orange wash behind active or selected items. */
  readonly brandSoft: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  /** Focus ring; strong enough against white for non-text contrast (3:1). */
  readonly focus: string;
}

export const colors: ColorScheme = {
  background: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#fafaf9',
  border: '#e7e5e4',
  text: '#1c1917',
  textMuted: '#57534e',
  brand: '#f97316',
  brandText: '#431407',
  brandStrong: '#c2410c',
  brandSoft: '#fff7ed',
  success: '#15803d',
  warning: '#a16207',
  danger: '#b91c1c',
  focus: '#c2410c',
};

export const fontFamily = {
  sans: "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  /** The large sign-in card. */
  xl: 22,
  full: 9999,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px rgba(28, 25, 23, 0.06)',
  raised: '0 12px 32px rgba(28, 25, 23, 0.12)',
  overlay: '0 20px 60px rgba(28, 25, 23, 0.25)',
  brandGlow: '0 8px 24px rgba(249, 115, 22, 0.35)',
} as const;

/** Durations in milliseconds and easing curves for transitions and entrance animations. */
export const motion = {
  fast: 150,
  base: 250,
  slow: 600,
  emphasized: 'cubic-bezier(0.22, 1, 0.36, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/** Converts camelCase token names to kebab-case CSS variable names (`--lead-*`). */
export function cssVariableName(token: string): string {
  return `--lead-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** One `--lead-*` declaration per token; numbers become px or ms by group. */
export function toCssDeclarations<T extends { readonly [K in keyof T]: string | number }>(
  tokens: T,
  prefix = '',
  unit = '',
): string {
  return Object.entries<string | number>(tokens)
    .map(([token, value]) => {
      const name = prefix ? `${prefix}${token.charAt(0).toUpperCase()}${token.slice(1)}` : token;
      const css = typeof value === 'number' ? `${value}${unit}` : value;
      return `  ${cssVariableName(name)}: ${css};`;
    })
    .join('\n');
}
