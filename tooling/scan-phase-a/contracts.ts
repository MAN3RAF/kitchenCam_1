// Executable Phase A specification only. No app imports, API handlers, or persistence.
import { z } from 'zod';

export const limits = Object.freeze({
  sourceBytes: 25 * 1024 * 1024,
  sourcePixels: 12_000_000,
  uploadBytes: 4 * 1024 * 1024,
  longEdge: 2048,
  minimumDimension: 256,
  bucketBytes: 10 * 1024 * 1024,
  uploadTtlSeconds: 600,
  transientTtlSeconds: 86400,
  ingredientCount: 50,
});

const id = z.uuid();
const revision = z.number().int().nonnegative();
const instant = z.iso.datetime();
const name = z.string().trim().min(1).max(120);
const strict = z.strictObject;
export const routeParameters = strict({ scanId: id });
export const operationHeaders = strict({ idempotencyKey: id, requestId: id });
export const revisions = strict({
  version: revision.positive(),
  imageRevision: revision,
  draftRevision: revision,
});
export const expectedRevision = strict({ expectedVersion: revision });
export const imageRevision = strict({
  expectedVersion: revision,
  imageRevision: revision.positive(),
});

// Local preparation admission only; server measurements remain authoritative for uploads.
export const sourceImage = strict({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().positive().max(limits.sourceBytes),
  width: z.number().int().min(limits.minimumDimension).max(limits.sourcePixels),
  height: z.number().int().min(limits.minimumDimension).max(limits.sourcePixels),
}).refine(
  (value) =>
    value.width * value.height <= limits.sourcePixels &&
    Math.min(value.width, value.height) *
      Math.min(1, limits.longEdge / Math.max(value.width, value.height)) >=
      limits.minimumDimension,
  'Source must fit the decode and prepared aspect-ratio limits.',
);

export const preparedImage = strict({
  mime: z.literal('image/jpeg'),
  bytes: z.number().int().positive().max(limits.uploadBytes),
  width: z.number().int().min(limits.minimumDimension).max(limits.longEdge),
  height: z.number().int().min(limits.minimumDimension).max(limits.longEdge),
  preparationVersion: z.literal('phase-a-v1'),
});

export const quantity = strict({
  value: z
    .string()
    .regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/)
    .refine((value) => Number(value) > 0),
  unit: z.enum(['g', 'ml', 'each', 'clove', 'slice', 'can', 'package', 'bunch']),
  estimated: z.boolean(),
});
export const ingredient = strict({
  id,
  displayName: name,
  normalizedName: name.nullable(),
  canonicalId: id.nullable(),
  selected: z.boolean(),
  quantity: quantity.nullable(),
  provenance: z.enum(['manual', 'detection', 'corrected']),
  detectionId: id.nullable(),
}).superRefine((value, context) => {
  if (value.provenance === 'manual' && value.detectionId !== null)
    context.addIssue({ code: 'custom', message: 'Manual rows have no detection.' });
  if (value.provenance === 'detection' && value.detectionId === null)
    context.addIssue({ code: 'custom', message: 'Detection provenance needs its reference.' });
});
export const ingredients = z
  .array(ingredient)
  .max(limits.ingredientCount)
  .superRefine((rows, context) => {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      context.addIssue({ code: 'custom', message: 'Duplicate row IDs.' });
  });
export const ingredientDraft = strict({ draftRevision: revision, ingredients });
export const confirmation = strict({
  scanId: id,
  confirmedRevision: revision.positive(),
  confirmedAt: instant,
  ingredients: ingredients.refine(
    (rows) => rows.length > 0 && rows.every((row) => row.selected),
    'Confirmed rows must all be selected.',
  ),
});

const coordinate = z.number().min(0).max(1);
export const region = z.discriminatedUnion('kind', [
  strict({
    kind: z.literal('box'),
    x: coordinate,
    y: coordinate,
    width: coordinate.positive(),
    height: coordinate.positive(),
  }).refine((value) => value.x + value.width <= 1 && value.y + value.height <= 1),
  strict({
    kind: z.literal('polygon'),
    points: z
      .array(strict({ x: coordinate, y: coordinate }))
      .min(3)
      .max(32),
  }),
]);
export const detection = strict({
  id,
  displayName: name,
  normalizedName: name.nullable(),
  canonicalCandidateId: id.nullable(),
  certainty: z.enum(['likely', 'uncertain']),
  uncertainty: z
    .array(z.enum(['occluded', 'ambiguous', 'low_quality', 'unsupported_granularity', 'unmapped']))
    .max(5),
  alternatives: z.array(strict({ displayName: name, canonicalCandidateId: id.nullable() })).max(5),
  region: region.nullable(),
  quantity: quantity.nullable(),
});
export const recognitionAssessment = strict({
  schemaVersion: z.literal('1'),
  imageRevision: revision.positive(),
  assessment: z.enum(['food_detected', 'no_food', 'unusable', 'abstained']),
  detections: z.array(detection).max(50),
}).superRefine((value, context) => {
  if ((value.assessment === 'food_detected') !== value.detections.length > 0)
    context.addIssue({
      code: 'custom',
      message: 'Food assessment requires detections; other assessments must be empty.',
    });
  if (new Set(value.detections.map((row) => row.id)).size !== value.detections.length)
    context.addIssue({ code: 'custom', message: 'Duplicate detection IDs.' });
});

export const failureCode = z.enum([
  'VALIDATION',
  'AUTH_REQUIRED',
  'ACCOUNT_NOT_ACTIVE',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONSENT_REQUIRED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'UPLOAD_EXPIRED',
  'UPLOAD_INCOMPLETE',
  'IMAGE_INVALID',
  'IMAGE_UNSUPPORTED',
  'IMAGE_LIMIT_EXCEEDED',
  'SANITIZER_UNAVAILABLE',
  'SANITIZER_TIMEOUT',
  'RECOGNITION_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_OUTPUT',
  'SCAN_EXPIRED',
  'CANCELLED',
  'INTERNAL',
]);
export const failure = strict({
  code: failureCode,
  requestId: id,
  retryable: z.boolean(),
  stage: z.enum([
    'creation',
    'preparation',
    'upload',
    'sanitization',
    'recognition',
    'draft',
    'confirmation',
    'cancellation',
    'deletion',
  ]),
  retryAfterSeconds: z.number().int().min(0).max(86400).nullable(),
  quota: z.enum(['not_reserved', 'reserved', 'released', 'finalized']),
});
export const sanitization = strict({
  state: z.enum(['not_started', 'pending', 'running', 'passed', 'rejected', 'failed', 'cancelled']),
  imageRevision: revision,
  updatedAt: instant,
});
export const serverState = z.enum([
  'awaiting_upload',
  'sanitizing',
  'queued',
  'recognizing',
  'needs_confirmation',
  'confirmed',
  'failed',
  'cancelled',
  'expired',
]);
export const scanStatus = strict({
  schemaVersion: z.literal('1'),
  scanId: id,
  source: z.enum(['camera', 'gallery', 'manual']),
  state: serverState,
  revisions,
  sanitization,
  recognitionAvailable: z.boolean(),
  manualFallback: z.boolean(),
  draft: ingredientDraft.nullable(),
  result: recognitionAssessment.nullable(),
  confirmation: confirmation.nullable(),
  failure: failure.nullable(),
  createdAt: instant,
  updatedAt: instant,
  expiresAt: instant.nullable(),
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const manual = value.source === 'manual' || value.manualFallback;
  if (
    value.source === 'manual' &&
    (!value.manualFallback ||
      value.revisions.imageRevision !== 0 ||
      value.sanitization.state !== 'not_started')
  )
    issue('Manual creation has no image processing.');
  if (value.source !== 'manual' && value.revisions.imageRevision === 0)
    issue('Image scans require a positive image revision.');
  if (
    manual &&
    (['awaiting_upload', 'sanitizing', 'queued', 'recognizing'].includes(value.state) ||
      value.result !== null)
  )
    issue('Manual scans cannot carry recognition work or results.');
  if (value.sanitization.imageRevision !== value.revisions.imageRevision)
    issue('Sanitization revision mismatch.');
  if (value.draft && value.draft.draftRevision !== value.revisions.draftRevision)
    issue('Draft revision mismatch.');
  if (value.result && value.result.imageRevision !== value.revisions.imageRevision)
    issue('Result revision mismatch.');
  if (
    (value.result || ['queued', 'recognizing'].includes(value.state)) &&
    value.sanitization.state !== 'passed'
  )
    issue('Recognition requires a sanitized image.');
  if (['needs_confirmation', 'confirmed'].includes(value.state) && !value.draft)
    issue('Confirmation stages require an editable draft.');
  if (
    value.state === 'confirmed' &&
    (!value.confirmation ||
      value.confirmation.scanId !== value.scanId ||
      value.confirmation.confirmedRevision !== value.revisions.draftRevision)
  )
    issue('Confirmation revision mismatch.');
  if (value.confirmation && value.state !== 'confirmed')
    issue('Confirmation is invalidated when editing resumes.');
  if (value.state === 'failed' && !value.failure) issue('Failure requires a safe reason.');
});

export const requests = {
  create: strict({ source: z.enum(['camera', 'gallery']) }),
  createManual: strict({ ingredients }),
  authorizeUpload: strict({
    scanId: id,
    expectedVersion: revision,
    imageRevision: revision.positive(),
    image: preparedImage,
    processingNoticeVersion: z.string().regex(/^[a-z0-9.-]{1,40}$/),
  }),
  completeUpload: strict({ ...imageRevision.shape, uploadId: id }),
  recognize: imageRevision,
  replacePhoto: expectedRevision,
  manualFallback: imageRevision,
  saveDraft: strict({ expectedVersion: revision, expectedDraftRevision: revision, ingredients }),
  confirm: strict({ expectedVersion: revision, draftRevision: revision.positive() }),
  cancel: expectedRevision,
  delete: expectedRevision,
} as const;

// Transport-only envelope. NEVER persist in status, drafts, navigation, telemetry, or Query caches.
export const uploadCapability = strict({
  uploadId: id,
  scanId: id,
  imageRevision: revision.positive(),
  issuedAt: instant,
  expiresAt: instant,
  method: z.literal('PUT'),
  url: z.url().refine((value) => new URL(value).protocol === 'https:'),
  headers: strict({
    'Content-Type': z.literal('image/jpeg'),
    'Content-Length': z.string().regex(/^[1-9]\d*$/),
  }),
}).refine((value) => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
  return (
    duration > 0 &&
    duration <= limits.uploadTtlSeconds * 1000 &&
    Number(value.headers['Content-Length']) <= limits.uploadBytes
  );
}, 'Actual capability lifetime must not exceed ten minutes.');

export const deletionReceipt = strict({
  deletionId: id,
  acceptedAt: instant,
  status: z.enum(['accepted', 'completed']),
  mediaDeleteBy: instant,
}).refine((value) => {
  const duration = Date.parse(value.mediaDeleteBy) - Date.parse(value.acceptedAt);
  return duration >= 0 && duration <= limits.transientTtlSeconds * 1000;
});
export const safeEvent = strict({
  event: z.enum([
    'scan_started',
    'scan_uploaded',
    'scan_completed',
    'scan_failed',
    'ingredient_edited',
  ]),
  requestId: id,
  stage: failure.shape.stage,
  durationMs: z.number().int().nonnegative(),
  code: failureCode.optional(),
  attempt: z.number().int().min(0).max(3),
});

export type ScanStatus = z.infer<typeof scanStatus>;
export type Ingredient = z.infer<typeof ingredient>;
