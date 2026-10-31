import { describe, expect, it } from 'vitest';
import { colors, cssVariableName, toCssDeclarations } from './index';

describe('cssVariableName', () => {
  it('converts camelCase tokens to kebab-case variables', () => {
    expect(cssVariableName('surfaceMuted')).toBe('--lead-surface-muted');
    expect(cssVariableName('brand')).toBe('--lead-brand');
  });
});

describe('colors', () => {
  it('defines the same tokens for light and dark schemes', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });

  it('emits one declaration per token', () => {
    const lines = toCssDeclarations(colors.light).split('\n');
    expect(lines).toHaveLength(Object.keys(colors.light).length);
    expect(lines).toContain('  --lead-text: #1c2128;');
  });
});
