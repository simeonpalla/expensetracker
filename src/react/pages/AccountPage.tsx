// AccountPage — "Account & privacy": download everything we hold about the
// user, or permanently delete the account. Both act only on the signed-in
// user's own data (see netlify/functions/account.js).
import { useState } from 'react';
import { API } from '../../api.js';
import { showNotification } from '../../ui.js';

export default function AccountPage() {
    const [exporting, setExporting] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);

    async function handleExport() {
        setExporting(true);
        try {
            const data = await API.exportAccount();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'expense-tracker-export.json';
            a.click();
            URL.revokeObjectURL(url);
            showNotification('Export downloaded.');
        } catch (err) {
            showNotification('Export failed: ' + (err as Error).message, 'error');
        } finally {
            setExporting(false);
        }
    }

    async function handleDelete(e: React.FormEvent) {
        e.preventDefault();
        if (confirmText !== 'DELETE') return;
        setDeleting(true);
        try {
            await API.deleteMyAccount();
            location.reload();
        } catch (err) {
            showNotification('Could not delete account: ' + (err as Error).message, 'error');
            setDeleting(false);
        }
    }

    return (
        <>
            <h2>🔐 Account &amp; privacy</h2>
            <p className="page-subtitle">
                Your data is yours. Read our <a href="/privacy.html">Privacy Policy</a> and{' '}
                <a href="/terms.html">Terms</a>.
            </p>

            <h3>Download your data</h3>
            <p className="form-help">
                A JSON file with your transactions, categories, accounts and settings.
            </p>
            <div className="form-actions">
                <button className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
                    {exporting ? 'Preparing…' : '⬇️ Download my data'}
                </button>
            </div>

            <h3 style={{ marginTop: 28 }}>Delete account</h3>
            <p className="form-help">
                This permanently erases your login and all your transactions, categories, accounts and
                settings. It cannot be undone — download your data first if you want a copy.
            </p>
            <form className="transaction-form" onSubmit={handleDelete}>
                <div className="form-group" style={{ maxWidth: 260 }}>
                    <label htmlFor="delete-confirm">Type DELETE to confirm</label>
                    <input
                        id="delete-confirm"
                        type="text"
                        autoComplete="off"
                        value={confirmText}
                        onChange={e => setConfirmText(e.target.value)}
                    />
                </div>
                <div className="form-actions">
                    <button
                        type="submit"
                        className="btn btn-danger"
                        disabled={confirmText !== 'DELETE' || deleting}
                    >
                        {deleting ? 'Deleting…' : '🗑️ Delete my account'}
                    </button>
                </div>
            </form>
        </>
    );
}
