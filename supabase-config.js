// supabase-config.js
const SUPABASE_URL = 'https://ygbgtjippnuznapohscs.supabase.co'  // Replace with your URL
const SUPABASE_PUBLISHABLE_KEY  = "sb_publishable_tTedmrGjXEwuOLE-v4QR4w_RAIt3FS8"// Replace with your anon key

// Initialize Supabase client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY );

// Test connection
async function testConnection() {
    try {
        // Just check if we can fetch categories
        const { data, error } = await supabaseClient
            .from('categories')
            .select('*')
            .limit(1)

        if (error) throw error

        console.log('✅ Supabase connected successfully!')
        document.getElementById('status-dot').className = 'status-dot connected'
        document.getElementById('status-text').textContent = 'Connected to database'
        return true
    } catch (error) {
        console.error('❌ Supabase connection failed:', error.message)
        document.getElementById('status-dot').className = 'status-dot error'
        document.getElementById('status-text').textContent = 'Database connection failed'
        return false
    }
}

// Run test on load
testConnection()