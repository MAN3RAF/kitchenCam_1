import { adminClient, requireUser, userClient } from '../_shared/auth.ts';
import { sha256 } from '../_shared/crypto.ts';
import { FunctionError, mapUnknownError } from '../_shared/errors.ts';
import { logSafeEvent } from '../_shared/logger.ts';
import { failure, json, requestId } from '../_shared/response.ts';

type MergeResult = {
  source_user_id: string | null;
  preference_review_id: string | null;
  merge_ticket_id: string;
};

Deno.serve(async (request) => {
  const startedAt = performance.now();
  const requestIdentifier = requestId(request);
  try {
    if (request.method !== 'POST') throw new FunctionError('METHOD_NOT_ALLOWED', 405);
    const body: unknown = await request.json();
    const token =
      typeof body === 'object' && body !== null && 'token' in body
        ? Reflect.get(body, 'token')
        : null;
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw new FunctionError('VALIDATION', 400);
    }

    const client = userClient(request);
    const user = await requireUser(client);
    if (user.is_anonymous) throw new Error('PERMANENT_ACCOUNT_REQUIRED');

    const { data, error } = await client.rpc('consume_account_merge_ticket', {
      p_token_hash: await sha256(token),
      p_correlation_id: requestIdentifier,
    });
    if (error) throw new Error(error.message);
    const result = (data as MergeResult[] | null)?.[0];
    if (!result) throw new FunctionError('INTERNAL', 500, true);

    const admin = adminClient();
    if (result.source_user_id) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(
        result.source_user_id,
        false,
      );
      if (deleteError) throw new FunctionError('MERGE_CLEANUP_PENDING', 503, true);
    }

    const { error: completionError } = await admin.rpc('internal_complete_account_merge', {
      p_merge_ticket_id: result.merge_ticket_id,
      p_target_user_id: user.id,
      p_correlation_id: requestIdentifier,
    });
    if (completionError) throw new FunctionError('MERGE_CLEANUP_PENDING', 503, true);

    logSafeEvent({
      event: 'account_merge_completed',
      requestId: requestIdentifier,
      status: 'completed',
      durationMs: Math.round(performance.now() - startedAt),
    });
    return json(
      { preferenceReviewRequired: result.preference_review_id !== null },
      requestIdentifier,
    );
  } catch (error) {
    const mapped = mapUnknownError(error);
    logSafeEvent({
      event: 'account_merge_failed',
      requestId: requestIdentifier,
      status: mapped.retryable ? 'pending' : 'failed',
      durationMs: Math.round(performance.now() - startedAt),
      safeCode: mapped.code,
    });
    return failure(mapped, requestIdentifier);
  }
});
