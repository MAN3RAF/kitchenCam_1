import type { SupportedStorage } from '@supabase/supabase-js';

export const sessionStorage: SupportedStorage = {
  getItem(key) {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  },
  setItem(key, value) {
    globalThis.sessionStorage?.setItem(key, value);
  },
  removeItem(key) {
    globalThis.sessionStorage?.removeItem(key);
  },
};
