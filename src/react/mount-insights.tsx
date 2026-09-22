// mount-insights.tsx — dynamically imported from main.js. See
// mount-accounts.tsx for why (keeps React out of the login-screen bundle).
import { createRoot } from 'react-dom/client';
import InsightsPage from './pages/InsightsPage';

export function mountInsightsPage(container: HTMLElement) {
    createRoot(container).render(<InsightsPage />);
}
