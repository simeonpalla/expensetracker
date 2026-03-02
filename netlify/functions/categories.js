// categories.js

const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async function (event) {
  try {
    const user = await getUser(event);

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST') {
      const category = JSON.parse(event.body);
      category.user_id = user.id;

      const { error } = await supabase.from('categories').insert([category]);

      if (error) throw error;

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

  } catch (err) {
    return { statusCode: 401, body: err.message };
  }
};