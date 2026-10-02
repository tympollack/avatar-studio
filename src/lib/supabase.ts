import { createClient } from '@supabase/supabase-js';
import { createCookieStorage } from './cookieStorage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Check your local .env or Cloudflare Pages project settings.'
  );
}

// Compute the same storage key used by the Hub client and @supabase/ssr:
// 'sb-<project-ref>-auth-token'
const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: createCookieStorage(),
    storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
