import { adminClient, requireUser, userClient } from '../_shared/auth.ts';
import { FunctionError, mapUnknownError } from '../_shared/errors.ts';
import { logSafeEvent } from '../_shared/logger.ts';
import { failure, json, requestId } from '../_shared/response.ts';

const privateBuckets = ['scan-raw-private', 'scan-retained-private'] as const;

async function removePrivateObjects(admin: ReturnType<typeof adminClient>, userId: string) {
  for (const bucket of privateBuckets) {
    const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (error) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
    const paths = (data ?? []).filter((item) => item.id).map((item) => `${userId}/${item.name}`);
    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
    }
  }
}

Deno.serve(async (request) => {
  const startedAt = performance.now();
  const requestIdentifier = requestId(request);
  try {
    if (request.method !== 'POST') throw new FunctionError('METHOD_NOT_ALLOWED', 405);
    const client = userClient(request);
    const user = await requireUser(client);
    const { data: deletionRequestId, error } = await client.rpc('request_account_deletion', {
      p_correlation_id: requestIdentifier,
    });
    if (error) throw new Error(error.message);
    if (typeof deletionRequestId !== 'string') throw new FunctionError('INTERNAL', 500, true);

    const admin = adminClient();
    await admin.rpc('internal_mark_account_deletion_processing', {
      p_request_id: deletionRequestId,
    });
    await removePrivateObjects(admin, user.id);

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, false);
    if (deleteError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);

    const { error: completionError } = await admin.rpc('internal_complete_account_deletion', {
      p_request_id: deletionRequestId,
      p_success: true,
      p_safe_error_code: null,
    });
    if (completionError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);

    logSafeEvent({
      event: 'account_deletion_completed',
      requestId: requestIdentifier,
      status: 'completed',
      durationMs: Math.round(performance.now() - startedAt),
    });
    return json({ requestId: deletionRequestId, status: 'completed' }, requestIdentifier, 202);
  } catch (error) {
    const mapped = mapUnknownError(error);
    logSafeEvent({
      event: 'account_deletion_pending',
      requestId: requestIdentifier,
      status: mapped.retryable ? 'pending' : 'failed',
      durationMs: Math.round(performance.now() - startedAt),
      safeCode: mapped.code,
    });
    return failure(mapped, requestIdentifier);
  }
});
