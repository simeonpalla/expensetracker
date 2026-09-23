// mount-account.tsx — dynamically imported from main.js. See
// mount-accounts.tsx for why (keeps React out of the login-screen bundle).
import { createRoot } from 'react-dom/client';
import AccountPage from './pages/AccountPage';
import OnboardingCard from './pages/OnboardingCard';

export function mountAccountPage(container: HTMLElement) {
    createRoot(container).render(<AccountPage />);
}

export function mountOnboardingCard(container: HTMLElement) {
    createRoot(container).render(<OnboardingCard />);
}
