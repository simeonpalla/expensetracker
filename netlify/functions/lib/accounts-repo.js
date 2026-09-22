// accounts-repo.js — Supabase data access for the payment accounts domain.
//
// Pure data access: no auth, no validation, no response shaping — those
// stay in accounts.js. See transactions-repo.js for the pattern.

function listAccounts(supabase, userId) {
    return supabase
        .from('payment_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
}

function insertAccount(supabase, payload) {
    return supabase.from('payment_accounts').insert([payload]);
}

function deleteAccount(supabase, id, userId) {
    return supabase.from('payment_accounts').delete().eq('id', id).eq('user_id', userId);
}

module.exports = { listAccounts, insertAccount, deleteAccount };
