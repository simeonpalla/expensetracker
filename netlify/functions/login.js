// login.js

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {

  const { email, password } = JSON.parse(event.body);

  // ✅ Create a fresh auth client for this request
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error("LOGIN ERROR:", error.message);
    return {
      statusCode: 401,
      body: JSON.stringify({ error: error.message })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(data.session)
  };
};