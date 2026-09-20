import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnvironment } from '@/config/public-env';
import { sessionStorage } from '@/services/backend/session-storage';

let client: SupabaseClient | undefined;

export function isBackendConfigured() {
  return Boolean(publicEnvironment.supabaseUrl && publicEnvironment.supabasePublishableKey);
}

export function getBackendClient(): SupabaseClient | null {
  if (!publicEnvironment.supabaseUrl || !publicEnvironment.supabasePublishableKey) return null;
  client ??= createClient(publicEnvironment.supabaseUrl, publicEnvironment.supabasePublishableKey, {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
  return client;
}
