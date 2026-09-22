// transactions-repo.js — Supabase data access for the transactions domain.
//
// Pure data access: no auth, no validation, no response shaping — those
// stay in transactions.js. Each function takes an already-authenticated
// supabase client (anon key + caller JWT, per _lib.js) so RLS remains the
// enforcement boundary; the explicit user_id filters here are defence in
// depth, matching the original handler's behavior exactly.

function listTransactions(supabase, userId) {
    return supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('transaction_date', { ascending: false });
}

function insertTransaction(supabase, payload) {
    return supabase.from('transactions').insert([payload]);
}

function updateTransaction(supabase, id, userId, payload) {
    return supabase.from('transactions').update(payload).eq('id', id).eq('user_id', userId);
}

function deleteTransaction(supabase, id, userId) {
    return supabase.from('transactions').delete().eq('id', id).eq('user_id', userId);
}

module.exports = { listTransactions, insertTransaction, updateTransaction, deleteTransaction };
