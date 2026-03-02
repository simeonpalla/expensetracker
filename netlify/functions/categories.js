// categories.js

const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async function (event) {
  try {
    const user = await getUser(event);

    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 401, body: err.message };
  }
};