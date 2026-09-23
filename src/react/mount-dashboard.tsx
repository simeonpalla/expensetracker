// mount-dashboard.tsx — dynamically imported from main.js. See
// mount-accounts.tsx for why (keeps React out of the login-screen bundle).
import { createRoot } from 'react-dom/client';
import DashboardPage from './pages/DashboardPage';

export function mountDashboardPage(container: HTMLElement) {
    createRoot(container).render(<DashboardPage />);
}
