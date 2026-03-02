// transactions.js

const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async function (event) {
  try {
    const user = await getUser(event);

    if (event.httpMethod === 'GET') {

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('transaction_date', { ascending: false });

      if (error) throw error;

      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST') {

      const tx = JSON.parse(event.body);
      tx.user_id = user.id; // enforce ownership

      const { error } = await supabase.from('transactions').insert([tx]);

      if (error) throw error;

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

  } catch (err) {
    return { statusCode: 401, body: err.message };
  }
};