/**
 * Design tokens. The web app reads them as CSS variables (dist/tokens.css);
 * the mobile app imports the objects directly.
 *
 * The brand color is a placeholder until City College of Calapan confirms its palette.
 */

export interface ColorScheme {
  readonly background: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly brand: string;
  readonly brandText: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly focus: string;
}

export const colors: Readonly<{ light: ColorScheme; dark: ColorScheme }> = {
  light: {
    background: '#f6f7f9',
    surface: '#ffffff',
    surfaceMuted: '#eef0f3',
    border: '#d9dde3',
    text: '#1c2128',
    textMuted: '#5b6472',
    brand: '#1f5fa8',
    brandText: '#ffffff',
    success: '#1e7a46',
    warning: '#9a6400',
    danger: '#b42318',
    focus: '#2f80ed',
  },
  dark: {
    background: '#12151a',
    surface: '#1a1e24',
    surfaceMuted: '#232830',
    border: '#343b46',
    text: '#e8ebef',
    textMuted: '#a3acb9',
    brand: '#6ea8ec',
    brandText: '#0d1726',
    success: '#4cc283',
    warning: '#e0a83a',
    danger: '#f07c70',
    focus: '#8bbcf5',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
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

export function toCssDeclarations(scheme: ColorScheme): string {
  return Object.entries(scheme)
    .map(([token, value]) => `  ${cssVariableName(token)}: ${value};`)
    .join('\n');
}
