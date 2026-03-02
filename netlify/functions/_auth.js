// _auth.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

async function getUser(event) {

  const token = event.headers.authorization?.replace('Bearer ', '');

  if (!token) throw new Error('Missing token');

  const { data, error } = await supabase.auth.getUser(token);

  if (error) throw error;

  return data.user;
}

module.exports = { getUser };