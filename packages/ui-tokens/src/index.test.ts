import { describe, expect, it } from 'vitest';
import { colors, cssVariableName, motion, radius, toCssDeclarations } from './index';

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe('cssVariableName', () => {
  it('converts camelCase tokens to kebab-case variables', () => {
    expect(cssVariableName('surfaceMuted')).toBe('--lead-surface-muted');
    expect(cssVariableName('brand')).toBe('--lead-brand');
  });
});

describe('toCssDeclarations', () => {
  it('emits one declaration per token', () => {
    const lines = toCssDeclarations(colors).split('\n');
    expect(lines).toHaveLength(Object.keys(colors).length);
    expect(lines).toContain('  --lead-brand: #f97316;');
  });

  it('prefixes groups and adds units to numbers', () => {
    expect(toCssDeclarations(radius, 'radius', 'px')).toContain('  --lead-radius-xl: 22px;');
    expect(toCssDeclarations({ fast: motion.fast }, 'duration', 'ms')).toBe(
      '  --lead-duration-fast: 150ms;',
    );
  });
});

describe('colors', () => {
  it('meets WCAG AA contrast for normal text', () => {
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textMuted, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.brandText, colors.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.brandStrong, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.danger, colors.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus ring visible against white (3:1 for non-text)', () => {
    expect(contrast(colors.focus, colors.background)).toBeGreaterThanOrEqual(3);
  });
});
