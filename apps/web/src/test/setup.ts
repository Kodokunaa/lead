import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { closeTestStores } from './render-app';

afterEach(() => {
  cleanup();
  closeTestStores();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});
