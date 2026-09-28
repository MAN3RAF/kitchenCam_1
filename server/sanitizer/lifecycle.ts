import type { Job, Lifecycle, Verified } from './contracts.ts';
import { validateJob } from './contracts.ts';
import { fail } from './policy.ts';
// Dependency-injected service RPC transport. Only the trusted coordinator holds it.
// Phase F binds the registered image IDs to its local artifact store in tests;
// there is deliberately no Supabase Storage transport or mobile caller here.
export interface Rpc {
  (
    name:
      | 'internal_scan_claim_job'
      | 'internal_scan_finish_job'
      | 'internal_scan_claim_cleanup'
      | 'internal_scan_ack_cleanup',
    body: Record<string, unknown>,
  ): Promise<unknown>;
}
export class PhaseBLifecycle implements Lifecycle {
  readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
  }
  async claim(scanId: string): Promise<Job> {
    const value = await this.rpc('internal_scan_claim_job', {
      p_scan: scanId,
      p_stage: 'sanitize',
    });
    if (typeof value !== 'object' || !value) fail('INTERNAL');
    const r = value as Record<string, unknown>;
    if (typeof r.input !== 'object' || !r.input || typeof r.output !== 'object' || !r.output)
      fail('INTERNAL');
    const input = r.input as Record<string, unknown>,
      output = r.output as Record<string, unknown>;
    if (
      typeof r.jobId !== 'string' ||
      typeof r.leaseToken !== 'string' ||
      typeof r.leaseUntil !== 'string' ||
      typeof r.imageRevision !== 'number' ||
      typeof r.generation !== 'number' ||
      typeof input.id !== 'string' ||
      typeof input.digest !== 'string' ||
      typeof output.id !== 'string'
    )
      fail('INTERNAL');
    const job: Job = {
      jobId: r.jobId,
      scanId,
      leaseToken: r.leaseToken,
      imageRevision: r.imageRevision,
      generation: r.generation,
      deadline: Date.parse(r.leaseUntil),
      inputId: input.id,
      inputDigest: input.digest,
      outputId: output.id,
    };
    validateJob(job);
    return job;
  }
  async finish(job: Job, result: Verified | { error: string }) {
    validateJob(job);
    if (Date.now() >= job.deadline) return false;
    if ('imageId' in result && result.imageId !== job.outputId) return false;
    const body =
      'error' in result
        ? result
        : {
            imageId: result.imageId,
            digest: result.digest,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
            sanitizerVersion: result.sanitizerVersion,
          };
    const accepted = await this.rpc('internal_scan_finish_job', {
      p_job: job.jobId,
      p_lease: job.leaseToken,
      p_body: body,
    });
    if (typeof accepted !== 'boolean') fail('INTERNAL');
    return accepted;
  }
}
