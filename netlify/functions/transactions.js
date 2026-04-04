// transactions.js

const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async function (event) {
  try {
    const user = await getUser(event);
    const { id } = event.queryStringParameters || {};

    // --- GET: Fetch all transactions for user ---
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false });

      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    // --- POST: Create a new transaction ---
    if (event.httpMethod === 'POST') {
      const tx = JSON.parse(event.body);
      tx.user_id = user.id; // enforce ownership

      const { error } = await supabase.from('transactions').insert([tx]);

      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // --- PUT: Update an existing transaction ---
    if (event.httpMethod === 'PUT') {
      if (!id) throw new Error('Transaction ID is required');
      
      const updates = JSON.parse(event.body);
      // Ensure the user cannot change the user_id via update
      delete updates.user_id; 

      const { data, error } = await supabase
        .from('transactions')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id); // Security: must own the record

      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ ok: true, data }) };
    }

    // --- DELETE: Remove a transaction ---
    if (event.httpMethod === 'DELETE') {
      if (!id) throw new Error('Transaction ID is required');

      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id); // Security: must own the record

      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };

  } catch (err) {
    // 401 for auth errors, 400 for missing IDs, 500 for DB errors
    const statusCode = err.message.includes('auth') ? 401 : 400;
    return { statusCode, body: JSON.stringify({ error: err.message }) };
  }
};