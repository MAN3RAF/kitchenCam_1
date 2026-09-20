type ServerEnvironment = Readonly<{
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
}>;

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error('SERVER_CONFIGURATION_INVALID');
  return value;
}

export function readServerEnvironment(): ServerEnvironment {
  return Object.freeze({
    supabaseUrl: required('SUPABASE_URL'),
    publishableKey: required('SUPABASE_ANON_KEY'),
    secretKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  });
}
