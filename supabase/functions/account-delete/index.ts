import { adminClient, requireUser, userClient } from '../_shared/auth.ts';
import { FunctionError, mapUnknownError } from '../_shared/errors.ts';
import { logSafeEvent } from '../_shared/logger.ts';
import { failure, json, requestId } from '../_shared/response.ts';
import { removeRegisteredScanObjects } from './scan-cleanup.ts';

const privateBuckets = ['scan-raw-private', 'scan-retained-private'] as const;

async function removePrivateObjects(admin: ReturnType<typeof adminClient>, userId: string) {
  async function removeFolder(bucket: string, prefix: string): Promise<void> {
    // Drain the first page repeatedly: offsets would skip objects after deletion.
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
      if (!data?.length) return;
      const paths: string[] = [];
      for (const item of data) {
        const path = `${prefix}/${item.name}`;
        if (item.id) paths.push(path);
        else await removeFolder(bucket, path);
      }
      if (paths.length > 0) {
        const { error: removeError } = await admin.storage.from(bucket).remove(paths);
        if (removeError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
      }
    }
  }
  for (const bucket of privateBuckets) await removeFolder(bucket, userId);
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
    const { error: processingError } = await admin.rpc(
      'internal_mark_account_deletion_processing',
      {
        p_request_id: deletionRequestId,
      },
    );
    if (processingError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
    await removeRegisteredScanObjects(admin, deletionRequestId);
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
