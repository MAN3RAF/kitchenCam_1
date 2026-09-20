import * as SecureStore from 'expo-secure-store';
import type { SupportedStorage } from '@supabase/supabase-js';

const chunkSize = 1800;

function manifestKey(key: string) {
  return `${key}.parts`;
}

function chunkKey(key: string, index: number) {
  return `${key}.part.${index}`;
}

async function partCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function clearParts(key: string) {
  const count = await partCount(key);
  await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
  );
  await SecureStore.deleteItemAsync(manifestKey(key));
}

export const sessionStorage: SupportedStorage = {
  async getItem(key) {
    const count = await partCount(key);
    if (count === 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    );
    return parts.every((part): part is string => part !== null) ? parts.join('') : null;
  },
  async setItem(key, value) {
    await clearParts(key);
    const chunks = Array.from({ length: Math.ceil(value.length / chunkSize) }, (_, index) =>
      value.slice(index * chunkSize, (index + 1) * chunkSize),
    );
    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(manifestKey(key), String(chunks.length));
  },
  async removeItem(key) {
    await clearParts(key);
  },
};
