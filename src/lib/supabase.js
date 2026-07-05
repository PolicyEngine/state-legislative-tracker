import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://ffgngqlgfsvqartilful.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAnonKey && typeof window !== 'undefined') {
  console.warn(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY not set - database features will not work',
  );
}

export const supabase = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
