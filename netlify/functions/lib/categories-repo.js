// categories-repo.js — Supabase data access for the categories domain.
//
// Pure data access: no auth, no validation, no response shaping — those
// stay in categories.js. See transactions-repo.js for the pattern.

function listCategories(supabase, userId) {
    return supabase.from('categories').select('*').eq('user_id', userId).order('created_at', {
        ascending: true
    });
}

function insertCategory(supabase, payload) {
    return supabase.from('categories').insert([payload]);
}

module.exports = { listCategories, insertCategory };
