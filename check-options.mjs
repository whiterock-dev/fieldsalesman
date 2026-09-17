import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env', 'utf8');
const env = Object.fromEntries(envFile.split('\n').map(line => line.split('=')));

const SUPABASE_URL = env.VITE_SUPABASE_URL?.trim();
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY?.trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkOptions() {
  const { data, error } = await supabase.from('form_fields').select('key, label, options');
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log('All Form Fields:', data);
}

checkOptions();
