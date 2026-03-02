// _auth.js

const { createClient } = require('@supabase/supabase-js');

const authClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function getUser(event) {
  const token = event.headers.authorization?.replace('Bearer ', '');

  if (!token) throw new Error('Missing token');

  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data?.user) throw new Error('Invalid token');

  return data.user;
}

module.exports = { getUser };