import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { closeTestStores } from './render-app';

// A file's first render is slow while every test file runs in parallel on a busy machine; the
// 1 s default for findBy* then fails tests that pass alone in well under a second.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  closeTestStores();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});
