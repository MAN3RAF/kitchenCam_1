const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function localConfiguration() {
  // Never load .env, accept a remote URL, or print CLI output (which contains secrets).
  const config = JSON.parse(
    execFileSync(path.resolve('node_modules/.bin/supabase'), ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  for (const field of ['API_URL', 'STORAGE_S3_URL']) {
    const url = new URL(config[field]);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.port !== '54321') {
      throw new Error('LOCAL_STACK_REQUIRED');
    }
  }
  return config;
}

function localClients(config) {
  return {
    admin: createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth }),
    user: () => createClient(config.API_URL, config.ANON_KEY, { auth }),
  };
}

function checked(result, label) {
  if (result.error) throw new Error(label);
  return result.data;
}

module.exports = { localConfiguration, localClients, checked };
