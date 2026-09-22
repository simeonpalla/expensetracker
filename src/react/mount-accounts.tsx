// mount-accounts.tsx — dynamically imported from main.js only after auth
// succeeds, so unauthenticated visits (the login screen) never download
// React at all. See SCALABILITY_ROADMAP.md for the page-by-page plan.
import { createRoot } from 'react-dom/client';
import AccountsPage from './pages/AccountsPage';

export function mountAccountsPage(container: HTMLElement) {
    createRoot(container).render(<AccountsPage />);
}
