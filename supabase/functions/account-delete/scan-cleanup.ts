import type { adminClient } from '../_shared/auth.ts';
import { FunctionError } from '../_shared/errors.ts';

type CleanupTarget = { imageId: string; bucket: string; path: string; token: string };

function targets(value: unknown): CleanupTarget[] {
  if (!Array.isArray(value)) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
  return value.map((row: unknown) => {
    if (
      typeof row !== 'object' ||
      row === null ||
      !('imageId' in row) ||
      typeof row.imageId !== 'string' ||
      !('bucket' in row) ||
      typeof row.bucket !== 'string' ||
      !('path' in row) ||
      typeof row.path !== 'string' ||
      !('token' in row) ||
      typeof row.token !== 'string' ||
      !['scan-raw-private', 'scan-retained-private'].includes(row.bucket)
    )
      throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
    return { imageId: row.imageId, bucket: row.bucket, path: row.path, token: row.token };
  });
}

export async function removeRegisteredScanObjects(
  admin: ReturnType<typeof adminClient>,
  requestId: string,
): Promise<void> {
  // Bounded request work. A larger inventory remains durable for the next retry.
  for (let page = 0; page < 10; page += 1) {
    const { data, error } = await admin.rpc('internal_account_scan_cleanup', {
      p_request: requestId,
    });
    if (error) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
    const batch = targets(data);
    if (batch.length === 0) break;
    for (const target of batch) {
      const { error: removeError } = await admin.storage.from(target.bucket).remove([target.path]);
      if (removeError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
      const { error: ackError } = await admin.rpc('internal_scan_ack_cleanup', {
        p_image: target.imageId,
        p_token: target.token,
      });
      if (ackError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
    }
  }
  const { data: ready, error } = await admin.rpc('internal_account_scan_cleanup_ready', {
    p_request: requestId,
  });
  if (error || ready !== true) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
  const { error: reconcileError } = await admin.rpc('internal_scan_reconcile_deletions');
  if (reconcileError) throw new FunctionError('ACCOUNT_CLEANUP_PENDING', 503, true);
}
