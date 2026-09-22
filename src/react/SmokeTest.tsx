// SmokeTest — proves the React + TypeScript + Vite pipeline works end to
// end in the live app before any real page is ported. Renders nothing
// visible (no UI/a11y surface) so it's safe to ship ahead of a real page
// migration; remove once the first real page port lands.
import { useEffect } from 'react';

export default function SmokeTest() {
    useEffect(() => {
        console.debug('[react-scaffold] mounted OK');
    }, []);

    return null;
}
