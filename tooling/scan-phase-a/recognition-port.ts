// Server-only conceptual port, not an adapter or executable recognition service.
import type { z } from 'zod';
import type { recognitionAssessment, failureCode } from './contracts';

export type SanitizedImageReference = Readonly<{
  imageId: string;
  imageRevision: number;
  digest: string;
  sanitizerVersion: string;
}>;

export type RecognitionContext = Readonly<{
  idempotencyKey: string;
  requestId: string;
  deadline: string;
  signal: AbortSignal;
}>;

export type RecognitionOutcome =
  | {
      kind: 'assessed';
      assessment: z.infer<typeof recognitionAssessment>;
      privateMetadata: PrivateRunMetadata;
    }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: z.infer<typeof failureCode>; retryable: boolean };

type PrivateRunMetadata = Readonly<{
  providerId: string;
  modelVersion: string;
  adapterVersion: string;
  promptVersion: string | null;
  providerRequestId: string | null;
  latencyMs: number;
  confidenceScores: readonly {
    detectionId: string;
    value: number;
    scale: string;
    calibrationVersion: string | null;
  }[];
}>;

export interface RecognitionPort {
  // The worker must resolve and authorize the sanitized reference at execution time.
  recognize(
    image: SanitizedImageReference,
    context: RecognitionContext,
  ): Promise<RecognitionOutcome>;
}
