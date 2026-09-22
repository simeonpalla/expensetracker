// @vitest-environment jsdom
//
// Proves the React + TypeScript + Vite/Vitest pipeline works end to end
// (JSX transform, TS types, ESLint, jsdom rendering) without shipping
// anything to the production bundle yet — no real page has been ported.
// See SCALABILITY_ROADMAP.md's frontend track for the page-by-page plan.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import SmokeTest from '../../src/react/SmokeTest';

describe('React scaffold', () => {
    it('renders without throwing and logs a mount marker', () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const { container } = render(<SmokeTest />);

        expect(container.childNodes.length).toBe(0);
        expect(debugSpy).toHaveBeenCalledWith('[react-scaffold] mounted OK');
    });
});
