import { describe, expect, it } from 'vitest';
import * as eager from '../test/eager-pages';
import * as lazyPages from './lazy';

describe('lazy pages', () => {
  // Tests run the app with test/eager-pages.ts in place of pages/lazy.tsx (vite.config.ts alias),
  // so the two must offer exactly the same pages.
  it('offers the same pages as the eager test double', () => {
    expect(Object.keys(lazyPages).sort()).toEqual(Object.keys(eager).sort());
  });
});
