// mount-add-transaction.tsx — dynamically imported from main.js. See
// mount-accounts.tsx for why (keeps React out of the login-screen bundle).
import { createRoot } from 'react-dom/client';
import AddTransactionPage from './pages/AddTransactionPage';

export function mountAddTransactionPage(container: HTMLElement) {
    createRoot(container).render(<AddTransactionPage />);
}
