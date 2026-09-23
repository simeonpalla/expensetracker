// mount-auth.tsx — dynamically imported from main.js boot() only when no
// session exists, so signed-in visits never download React for auth.
import { createRoot } from 'react-dom/client';
import AuthPage from './pages/AuthPage';

export function mountAuthPage(container: HTMLElement) {
    createRoot(container).render(<AuthPage />);
}
