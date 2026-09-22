// mount-budgets.tsx — dynamically imported from main.js. See
// mount-accounts.tsx for why (keeps React out of the login-screen bundle).
import { createRoot } from 'react-dom/client';
import BudgetsPage from './pages/BudgetsPage';

export function mountBudgetsPage(container: HTMLElement) {
    createRoot(container).render(<BudgetsPage />);
}
