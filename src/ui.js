// ui.js — small shared UI helpers (single copies of what used to be
// duplicated across script.js and both trackers).

export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function showNotification(message, type = 'success') {
    const existing = document.getElementById('toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.textContent = message;
    toast.setAttribute('role', 'status');

    const isError = type === 'error';
    toast.style.cssText = `
        position: fixed;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        width: 290px;
        background: ${isError ? 'rgba(220,38,38,0.92)' : 'rgba(17,17,34,0.92)'};
        border: 1px solid ${isError ? 'rgba(255,92,114,0.4)' : 'rgba(124,106,255,0.3)'};
        color: #fff;
        padding: 11px 18px;
        border-radius: 14px;
        font-family: 'Outfit', sans-serif;
        font-size: 0.83rem;
        font-weight: 500;
        text-align: center;
        z-index: 99999;
        opacity: 0;
        transition: opacity 0.2s ease;
        box-shadow: 0 8px 28px rgba(0,0,0,0.35);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        pointer-events: none;
        letter-spacing: 0.01em;
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 220);
    }, 3500);
}

// Flips the UI back to the login screen (e.g. when the session expires).
export function showAuthScreen() {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.querySelector('.container');
    if (authContainer) authContainer.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
}

// ---- accessible modal helpers ----
// openModal shows an overlay as a dialog: focuses the first control, traps
// Tab inside it, closes on Escape (via onDismiss so callers can clear their
// state), and restores focus to the opener on close.

let lastFocusedElement = null;

function focusableIn(overlay) {
    return [
        ...overlay.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
    ].filter(el => !el.disabled && el.offsetParent !== null);
}

export function openModal(overlay, onDismiss) {
    lastFocusedElement = document.activeElement;
    overlay.style.display = 'flex';

    const els = focusableIn(overlay);
    if (els.length) els[0].focus();

    const onKeydown = e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (onDismiss) onDismiss();
            else closeModal(overlay);
            return;
        }
        if (e.key !== 'Tab') return;
        const focusables = focusableIn(overlay);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
    overlay._modalKeydown = onKeydown;
    document.addEventListener('keydown', onKeydown);
}

export function closeModal(overlay) {
    overlay.style.display = 'none';
    if (overlay._modalKeydown) {
        document.removeEventListener('keydown', overlay._modalKeydown);
        overlay._modalKeydown = null;
    }
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
        lastFocusedElement.focus();
    }
    lastFocusedElement = null;
}

// Generic confirm modal shared by the time and workout trackers.
export function showGenericConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('generic-confirm-modal-overlay');
    document.getElementById('generic-confirm-title').textContent = title;
    document.getElementById('generic-confirm-message').textContent = message;
    const yes = document.getElementById('generic-confirm-yes');
    const no = document.getElementById('generic-confirm-no');
    const newYes = yes.cloneNode(true);
    const newNo = no.cloneNode(true);
    yes.parentNode.replaceChild(newYes, yes);
    no.parentNode.replaceChild(newNo, no);
    const close = () => closeModal(overlay);
    newYes.addEventListener('click', () => {
        close();
        onConfirm();
    });
    newNo.addEventListener('click', close);
    overlay.addEventListener(
        'click',
        e => {
            if (e.target === overlay) close();
        },
        { once: true }
    );
    openModal(overlay, close);
}

// Disables a button (with a busy label) for the duration of an async action,
// so double-clicks can't double-submit.
export async function withBusy(button, busyLabel, action) {
    if (!button) return action();
    if (button.dataset.busy === '1') return undefined;
    const original = button.textContent;
    button.dataset.busy = '1';
    button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    try {
        return await action();
    } finally {
        button.dataset.busy = '';
        button.disabled = false;
        button.textContent = original;
    }
}
