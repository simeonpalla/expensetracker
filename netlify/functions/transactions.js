const { supabase } = require('./_supabase');

exports.handler = async function (event) {

  if (event.httpMethod === 'GET') {

    const userId = event.queryStringParameters?.user_id;

    if (!userId) {
      return { statusCode: 400, body: 'Missing user_id' };
    }

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false });

    if (error) {
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  }

  if (event.httpMethod === 'POST') {

    const tx = JSON.parse(event.body);

    const { error } = await supabase
      .from('transactions')
      .insert([tx]);

    if (error) {
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }
};