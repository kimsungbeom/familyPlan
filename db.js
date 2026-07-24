require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
