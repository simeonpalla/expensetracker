import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// testing-library's auto-cleanup only self-registers when `afterEach` is a
// true global, which this repo doesn't enable (test.globals is off) — so
// unmount explicitly, or renders accumulate across tests in the same file.
afterEach(cleanup);
