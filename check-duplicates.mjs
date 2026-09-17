import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env', 'utf8');
const env = Object.fromEntries(envFile.split('\n').map(line => line.split('=')));

const SUPABASE_URL = env.VITE_SUPABASE_URL?.trim();
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY?.trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkDuplicates() {
  console.log('Querying customers table for duplicate phone numbers...');
  
  const { data, error } = await supabase.from('customers').select('id, name, phone').is('is_deleted', false);
  if (error) {
    console.error('Error fetching customers:', error);
    return;
  }

  const phoneMap = new Map();
  data.forEach(c => {
    if (!c.phone) return;
    const current = phoneMap.get(c.phone) || [];
    current.push(c);
    phoneMap.set(c.phone, current);
  });

  let foundDuplicates = false;
  for (const [phone, customers] of phoneMap.entries()) {
    if (customers.length > 1) {
      foundDuplicates = true;
      console.log(`\nDuplicate Phone: ${phone}`);
      customers.forEach(c => console.log(`  - ID: ${c.id}, Name: ${c.name}`));
    }
  }

  if (!foundDuplicates) {
    console.log('\nNo duplicate phone numbers found in the active database.');
  }
}

checkDuplicates();
