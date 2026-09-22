// mount-categories.tsx — dynamically imported from main.js. See
// mount-accounts.tsx for why (keeps React out of the login-screen bundle).
import { createRoot } from 'react-dom/client';
import CategoriesPage from './pages/CategoriesPage';

export function mountCategoriesPage(container: HTMLElement) {
    createRoot(container).render(<CategoriesPage />);
}
