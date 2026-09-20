import { requireUser, userClient } from '../_shared/auth.ts';
import { randomToken, sha256 } from '../_shared/crypto.ts';
import { FunctionError, mapUnknownError } from '../_shared/errors.ts';
import { logSafeEvent } from '../_shared/logger.ts';
import { failure, json, requestId } from '../_shared/response.ts';

Deno.serve(async (request) => {
  const startedAt = performance.now();
  const requestIdentifier = requestId(request);
  try {
    if (request.method !== 'POST') {
      return failure(new FunctionError('METHOD_NOT_ALLOWED', 405), requestIdentifier);
    }

    const client = userClient(request);
    const user = await requireUser(client);
    if (!user.is_anonymous) throw new Error('ANONYMOUS_ACCOUNT_REQUIRED');

    const token = randomToken();
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await client.rpc('issue_account_merge_ticket', {
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    logSafeEvent({
      event: 'account_merge_ticket_issued',
      requestId: requestIdentifier,
      status: 'completed',
      durationMs: Math.round(performance.now() - startedAt),
    });
    return json({ token, expiresAt }, requestIdentifier, 201);
  } catch (error) {
    const mapped = mapUnknownError(error);
    logSafeEvent({
      event: 'account_merge_ticket_failed',
      requestId: requestIdentifier,
      status: 'failed',
      durationMs: Math.round(performance.now() - startedAt),
      safeCode: mapped.code,
    });
    return failure(mapped, requestIdentifier);
  }
});
