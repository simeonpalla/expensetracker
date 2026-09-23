// settings-repo.js — Supabase data access for per-user settings and the
// account lifecycle (defaults seeding, export, deletion). Pure data
// access; validation and responses stay in the handlers.

function getSettings(supabase, userId) {
    return supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
}

function upsertSettings(supabase, payload) {
    return supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' });
}

function countCategories(supabase, userId) {
    return supabase.from('categories').select('id', { count: 'exact', head: true }).eq('user_id', userId);
}

function insertCategories(supabase, rows) {
    return supabase.from('categories').insert(rows);
}

function insertAccounts(supabase, rows) {
    return supabase.from('payment_accounts').upsert(rows, {
        onConflict: 'user_id,name,type',
        ignoreDuplicates: true
    });
}

function exportTable(supabase, table, userId) {
    return supabase.from(table).select('*').eq('user_id', userId);
}

function deleteMyAccount(supabase) {
    return supabase.rpc('delete_my_account');
}

module.exports = {
    getSettings,
    upsertSettings,
    countCategories,
    insertCategories,
    insertAccounts,
    exportTable,
    deleteMyAccount
};
