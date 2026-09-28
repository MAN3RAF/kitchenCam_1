import { fail } from './policy.ts';
import { id } from './storage.ts';
import type { Category, Dimensions } from './policy.ts';
import type { Metrics } from './runtime.ts';
export type Job = Readonly<{
  jobId: string;
  scanId: string;
  leaseToken: string;
  imageRevision: number;
  generation: number;
  deadline: number;
  inputId: string;
  inputDigest: string;
  outputId: string;
}>;
export type Verified = Dimensions & {
  bytes: number;
  digest: string;
  sanitizerVersion: string;
  imageId: string;
};
export type Result =
  | {
      status: 'SUCCESS';
      trust: 'SANITIZED';
      jobId: string;
      imageRevision: number;
      output: Verified;
      metrics: Metrics[];
    }
  | {
      status: 'REJECTED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
      trust: 'REJECTED';
      category: Category;
      jobId: string;
    }
  | { status: 'PENDING'; trust: 'SANITIZING'; category: 'INTERNAL'; jobId: string };
export interface Lifecycle {
  // Must atomically fence against authoritative revision, generation, lease and owner lifecycle.
  finish(job: Job, result: Verified | { error: string }): Promise<boolean>;
}
export function validateJob(job: Job) {
  for (const value of [job.jobId, job.scanId, job.leaseToken, job.inputId, job.outputId]) id(value);
  if (
    ![job.imageRevision, job.generation].every((n) => Number.isSafeInteger(n) && n > 0) ||
    !Number.isSafeInteger(job.deadline) ||
    !/^[0-9a-f]{64}$/.test(job.inputDigest) ||
    job.inputId === job.outputId
  )
    fail('STALE_REVISION');
}
export function databaseError(category: Category) {
  if (category === 'UNSUPPORTED_FORMAT') return 'IMAGE_UNSUPPORTED';
  if (category === 'IMAGE_TOO_LARGE' || category === 'RESOURCE_LIMIT')
    return 'IMAGE_LIMIT_EXCEEDED';
  if (category === 'TIMEOUT') return 'SANITIZER_TIMEOUT';
  if (['INTERNAL', 'OUTPUT_VERIFICATION', 'BUSY'].includes(category))
    return 'SANITIZER_UNAVAILABLE';
  return 'IMAGE_INVALID';
}
