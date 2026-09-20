import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.116.0';
import { FunctionError } from './errors.ts';
import { readServerEnvironment } from './environment.ts';

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) throw new FunctionError('AUTH_REQUIRED', 401);
  return match[1];
}

export function userClient(request: Request): SupabaseClient {
  const environment = readServerEnvironment();
  return createClient(environment.supabaseUrl, environment.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearerToken(request)}` } },
  });
}

export function adminClient(): SupabaseClient {
  const environment = readServerEnvironment();
  return createClient(environment.supabaseUrl, environment.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export async function requireUser(client: SupabaseClient): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new FunctionError('AUTH_REQUIRED', 401);
  return data.user;
}
