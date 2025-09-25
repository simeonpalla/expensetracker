// supabase-config.js
const SUPABASE_URL = 'https://ygbgtjippnuznapohscs.supabase.co'  // Replace with your URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlnYmd0amlwcG51em5hcG9oc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3NzYzNzYsImV4cCI6MjA3NDM1MjM3Nn0.KELMR7mXoAYVhU_KienISuBTPLlbnhOxISEQLf7X9UY'  // Replace with your anon key

// Initialize Supabase client
const { createClient } = supabase
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Test connection
async function testConnection() {
    try {
        const { data, error } = await supabaseClient
            .from('categories')
            .select('count')
            .single()
        
        if (error) throw error
        console.log('✅ Supabase connected successfully!')
        return true
    } catch (error) {
        console.error('❌ Supabase connection failed:', error.message)
        return false
    }
}