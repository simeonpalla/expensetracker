// account.js — data rights for the signed-in user.
// GET    -> full JSON export of everything stored about them (portability)
// DELETE -> { confirm: "DELETE" } permanently erases their data and login
//           (erasure). Uses the delete_my_account() SQL function under the
//           caller's own JWT — no service-role key involved.

const { json, requireUser, readJsonBody, clearSessionCookies, rateLimit, withLogging } = require('./_lib');
const { getSettings, exportTable, deleteMyAccount } = require('./lib/settings-repo');

const handler = async function (event) {
    try {
        const auth = await requireUser(event);
        if (!auth) return json(401, { error: 'Not signed in' });
        const { user, supabase } = auth;

        if (event.httpMethod === 'GET') {
            if (!rateLimit('account-export', user.id, 5, 60 * 60 * 1000)) {
                return json(429, { error: 'Too many export requests. Try again later.' });
            }
            const [transactions, categories, accounts, settings] = await Promise.all([
                exportTable(supabase, 'transactions', user.id),
                exportTable(supabase, 'categories', user.id),
                exportTable(supabase, 'payment_accounts', user.id),
                getSettings(supabase, user.id)
            ]);
            for (const r of [transactions, categories, accounts, settings]) {
                if (r.error) throw r.error;
            }
            return json(
                200,
                {
                    exported_at: new Date().toISOString(),
                    account: { id: user.id, email: user.email },
                    transactions: transactions.data || [],
                    categories: categories.data || [],
                    payment_accounts: accounts.data || [],
                    settings: settings.data || null
                },
                {
                    headers: {
                        'Content-Disposition': 'attachment; filename="expense-tracker-export.json"'
                    }
                }
            );
        }

        if (event.httpMethod === 'DELETE') {
            const parsed = readJsonBody(event);
            if (!parsed.ok) return parsed.response;
            if (parsed.body.confirm !== 'DELETE') {
                return json(400, { error: 'Type DELETE to confirm account deletion.' });
            }
            const { error } = await deleteMyAccount(supabase);
            if (error) throw error;
            return json(200, { ok: true }, { multiValueHeaders: { 'Set-Cookie': clearSessionCookies() } });
        }

        return json(405, { error: 'Method not allowed' });
    } catch (err) {
        console.error('account error:', err);
        return json(500, { error: 'Internal server error' });
    }
};

exports.handler = withLogging('account', handler);
