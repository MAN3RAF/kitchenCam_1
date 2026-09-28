import type { Rpc } from './lifecycle.ts';
import { fail } from './policy.ts';
// Local Phase F harness only. Hosted transport/Storage are separate deployment gates.
export function localRpc(origin: string, key: string): Rpc {
  const url = new URL(origin);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !key
  )
    fail('INTERNAL');
  return async (name, body) => {
    try {
      const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) fail('INTERNAL');
      const text = await response.text();
      if (text.length > 65536) fail('INTERNAL');
      return JSON.parse(text) as unknown;
    } catch {
      fail('INTERNAL');
    }
  };
}
