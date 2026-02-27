const { supabase } = require('./_supabase');

exports.handler = async function (event) {

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase.from('transactions').select('*');

    if (error) return { statusCode: 500, body: JSON.stringify(error) };

    return { statusCode: 200, body: JSON.stringify(data) };
  }

  if (event.httpMethod === 'POST') {
    const tx = JSON.parse(event.body);

    const { error } = await supabase.from('transactions').insert([tx]);

    if (error) return { statusCode: 500, body: JSON.stringify(error) };

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }
};