import {
  confirmation,
  deletionReceipt,
  failure,
  ingredientDraft,
  operationHeaders,
  preparedImage,
  recognitionAssessment,
  requests,
  routeParameters,
  safeEvent,
  scanStatus,
  sourceImage,
  uploadCapability,
} from '../tooling/scan-phase-a/contracts';
import {
  initial,
  transition,
  visibleState,
  type Model,
} from '../tooling/scan-phase-a/state-machine';
import type { RecognitionPort } from '../tooling/scan-phase-a/recognition-port';
import { mutationDecision } from '../tooling/scan-phase-a/idempotency';

const uuid = '10000000-0000-4000-8000-000000000001';
const time = '2026-09-21T12:00:00Z';
const manualRow = {
  id: uuid,
  displayName: 'User-entered ingredient',
  normalizedName: null,
  canonicalId: null,
  selected: true,
  quantity: null,
  provenance: 'manual',
  detectionId: null,
};
const stamp = (state: Model) => ({
  imageRevision: state.imageRevision,
  generation: state.generation,
});
// Compile the private port, without implementing a fake provider.
type PortInput = Parameters<RecognitionPort['recognize']>[0];
const imageReference: PortInput = {
  imageId: uuid,
  imageRevision: 1,
  digest: 'opaque-server-digest',
  sanitizerVersion: 'phase-a-v1',
};

test('public boundaries reject private and transport data rather than stripping it silently', () => {
  expect(imageReference.imageRevision).toBe(1);
  for (const field of [
    'storagePath',
    'signedUrl',
    'imageBytes',
    'providerMetadata',
    'credentials',
    'userId',
  ]) {
    expect(routeParameters.safeParse({ scanId: uuid, [field]: 'forbidden' }).success).toBe(false);
    expect(requests.create.safeParse({ source: 'camera', [field]: 'forbidden' }).success).toBe(
      false,
    );
    expect(
      ingredientDraft.safeParse({ draftRevision: 0, ingredients: [], [field]: 'forbidden' })
        .success,
    ).toBe(false);
    expect(
      safeEvent.safeParse({
        event: 'scan_started',
        requestId: uuid,
        stage: 'creation',
        durationMs: 0,
        attempt: 0,
        [field]: 'forbidden',
      }).success,
    ).toBe(false);
  }
});

test('creation, draft and confirmation distinguish an editable empty list from a usable confirmation', () => {
  expect(requests.createManual.safeParse({ ingredients: [] }).success).toBe(true);
  expect(
    requests.saveDraft.safeParse({
      expectedVersion: 1,
      expectedDraftRevision: 0,
      ingredients: [manualRow],
    }).success,
  ).toBe(true);
  expect(
    confirmation.safeParse({
      scanId: uuid,
      confirmedRevision: 1,
      confirmedAt: time,
      ingredients: [],
    }).success,
  ).toBe(false);
  expect(
    confirmation.safeParse({
      scanId: uuid,
      confirmedRevision: 1,
      confirmedAt: time,
      ingredients: [manualRow],
    }).success,
  ).toBe(true);
  expect(requests.createManual.safeParse({ ingredients: [manualRow, manualRow] }).success).toBe(
    false,
  );
  expect(
    requests.createManual.safeParse({ ingredients: [{ ...manualRow, displayName: ' ' }] }).success,
  ).toBe(false);
});

test('prepared-image limits and the ten-minute transport contract reject weaker claims', () => {
  const image = {
    mime: 'image/jpeg',
    bytes: 4194304,
    width: 2048,
    height: 256,
    preparationVersion: 'phase-a-v1',
  };
  expect(preparedImage.safeParse(image).success).toBe(true);
  for (const changed of [
    { bytes: 4194305 },
    { width: 2049 },
    { height: 255 },
    { mime: 'image/heic' },
  ])
    expect(preparedImage.safeParse({ ...image, ...changed }).success).toBe(false);
  const capability = {
    uploadId: uuid,
    scanId: uuid,
    imageRevision: 1,
    issuedAt: time,
    expiresAt: '2026-09-21T12:10:00Z',
    method: 'PUT',
    url: 'https://storage.example.test/opaque-capability',
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '100' },
  };
  expect(uploadCapability.safeParse(capability).success).toBe(true);
  expect(
    uploadCapability.safeParse({ ...capability, expiresAt: '2026-09-21T14:00:00Z' }).success,
  ).toBe(false);
  expect(
    uploadCapability.safeParse({ ...capability, url: 'http://storage.example.test/upload' })
      .success,
  ).toBe(false);
});

test('commands require revisions and strict operation headers', () => {
  for (const command of [
    requests.completeUpload,
    requests.recognize,
    requests.replacePhoto,
    requests.manualFallback,
    requests.saveDraft,
    requests.confirm,
    requests.cancel,
    requests.delete,
  ])
    expect(command.safeParse({}).success).toBe(false);
  expect(operationHeaders.safeParse({ idempotencyKey: uuid, requestId: uuid }).success).toBe(true);
  expect(operationHeaders.safeParse({ idempotencyKey: 'unbounded', requestId: uuid }).success).toBe(
    false,
  );
});

test('safe failures do not carry raw exceptions or provider payloads', () => {
  const value = {
    code: 'RECOGNITION_UNAVAILABLE',
    requestId: uuid,
    retryable: false,
    stage: 'recognition',
    retryAfterSeconds: null,
    quota: 'not_reserved',
  };
  expect(failure.safeParse(value).success).toBe(true);
  expect(failure.safeParse({ ...value, rawError: 'private' }).success).toBe(false);
  expect(
    recognitionAssessment.safeParse({
      schemaVersion: '1',
      imageRevision: 1,
      assessment: 'abstained',
      detections: [],
    }).success,
  ).toBe(true);
});

test('status cannot authorize unsanitized recognition or carry mismatched revisions', () => {
  const status = {
    schemaVersion: '1',
    scanId: uuid,
    source: 'camera',
    state: 'queued',
    revisions: { version: 3, imageRevision: 1, draftRevision: 0 },
    sanitization: { state: 'pending', imageRevision: 1, updatedAt: time },
    recognitionAvailable: false,
    manualFallback: false,
    draft: null,
    result: null,
    confirmation: null,
    failure: null,
    createdAt: time,
    updatedAt: time,
    expiresAt: null,
  };
  expect(scanStatus.safeParse(status).success).toBe(false);
  expect(scanStatus.safeParse({ ...status, state: 'sanitizing' }).success).toBe(true);
  expect(
    scanStatus.safeParse({
      ...status,
      state: 'sanitizing',
      sanitization: { state: 'pending', imageRevision: 2, updatedAt: time },
    }).success,
  ).toBe(false);
});

test('manual-only completion needs explicit acknowledgement and current draft', () => {
  let state = transition(initial, { type: 'manual' });
  state = transition(state, { type: 'edit' });
  expect(() =>
    transition(state, { type: 'advance', to: 'confirmed', stamp: stamp(state) }),
  ).toThrow('CONFIRMATION_REQUIRED');
  state = transition(state, { type: 'connectivity', online: true });
  state = transition(state, {
    type: 'advance',
    to: 'confirmed',
    stamp: stamp(state),
    serverVersion: 2,
    evidence: { confirmationAcknowledged: true, selectedCount: 1, draftRevision: 1 },
  });
  expect(state.stage).toBe('confirmed');
  expect(transition(state, { type: 'edit' }).stage).toBe('needs-confirmation');
});

test('superseded photos and stale callbacks cannot advance preparation', () => {
  const first = transition(initial, { type: 'photo', stamp: stamp(initial) });
  const second = transition(first, { type: 'photo', stamp: stamp(first) });
  expect(second.imageRevision).toBe(2);
  expect(transition(second, { type: 'advance', to: 'preparing', stamp: stamp(first) })).toBe(
    second,
  );
});

test('offline/background are overlays and never manufacture a durable cancellation', () => {
  const running: Model = { ...initial, stage: 'recognizing', serverVersion: 4, imageRevision: 1 };
  const offline = transition(running, { type: 'connectivity', online: false });
  expect(visibleState(offline)).toBe('offline');
  const background = transition(offline, { type: 'lifecycle', foreground: false });
  expect(background.stage).toBe('recognizing');
  const pending = transition(background, { type: 'cancel' });
  expect(pending.cancellationPending).toBe(true);
  expect(pending.stage).toBe('recognizing');
  expect(
    transition(pending, {
      type: 'advance',
      to: 'needs-confirmation',
      stamp: stamp(running),
      evidence: { validAssessment: true },
    }),
  ).toBe(pending);
  const cancelled = transition(pending, { type: 'cancel-ack', generation: pending.generation });
  expect(cancelled.stage).toBe('cancelled');
  expect(transition(cancelled, { type: 'manual' })).toBe(cancelled);
});

test('manual fallback fences recognition; edited drafts reject late confirmation', () => {
  const running: Model = { ...initial, stage: 'recognizing', imageRevision: 1, serverVersion: 4 };
  const manual = transition(running, { type: 'manual' });
  expect(
    transition(manual, {
      type: 'advance',
      to: 'needs-confirmation',
      stamp: stamp(running),
      serverVersion: 5,
      evidence: { validAssessment: true },
    }),
  ).toBe(manual);
  const edited = transition(manual, { type: 'edit' });
  expect(
    transition(edited, {
      type: 'advance',
      to: 'confirmed',
      stamp: stamp(manual),
      serverVersion: 6,
    }),
  ).toBe(edited);
});

test('trust gates reject skipped sanitization, unavailable recognition and unauthorized retry', () => {
  const uploading: Model = { ...initial, stage: 'uploading', imageRevision: 1, serverVersion: 1 };
  expect(() =>
    transition(uploading, {
      type: 'advance',
      to: 'recognizing',
      stamp: stamp(uploading),
      serverVersion: 2,
    }),
  ).toThrow('INVALID_TRANSITION');
  const sanitizing: Model = { ...uploading, stage: 'sanitizing' };
  expect(() =>
    transition(sanitizing, {
      type: 'advance',
      to: 'queued',
      stamp: stamp(sanitizing),
      serverVersion: 2,
    }),
  ).toThrow('RECOGNITION_NOT_AUTHORIZED');
  const failed: Model = { ...uploading, stage: 'failed' };
  expect(() =>
    transition(failed, {
      type: 'advance',
      to: 'uploading',
      stamp: stamp(failed),
      serverVersion: 2,
    }),
  ).toThrow('RETRY_NOT_AUTHORIZED');
  expect(
    transition(uploading, {
      type: 'advance',
      to: 'sanitizing',
      stamp: stamp(uploading),
      serverVersion: 1,
      evidence: { uploadVerified: true },
    }),
  ).toBe(uploading);
});

test('idempotent acknowledgement replay precedes version checks but never authorization', () => {
  const operation = {
    authenticatedOwner: uuid,
    operation: 'confirm',
    key: uuid,
    payloadDigest: 'digest-a',
  };
  const input = {
    accountActive: true,
    resourceOwner: uuid,
    requested: operation,
    recorded: operation,
    expectedVersion: 1,
    currentVersion: 2,
  };
  expect(mutationDecision(input)).toBe('reuse-operation');
  expect(() => mutationDecision({ ...input, accountActive: false })).toThrow('ACCOUNT_NOT_ACTIVE');
  expect(() => mutationDecision({ ...input, resourceOwner: 'another-owner' })).toThrow('NOT_FOUND');
  expect(() =>
    mutationDecision({ ...input, requested: { ...operation, payloadDigest: 'digest-b' } }),
  ).toThrow('IDEMPOTENCY_CONFLICT');
  expect(() => mutationDecision({ ...input, recorded: null })).toThrow('VERSION_CONFLICT');
  expect(mutationDecision({ ...input, recorded: null, expectedVersion: 2 })).toBe('apply');
});

test('permission recovery and lifecycle do not bypass camera or image readiness', () => {
  const permission = transition(initial, {
    type: 'advance',
    to: 'permission-required',
    stamp: stamp(initial),
  });
  expect(() =>
    transition(permission, { type: 'advance', to: 'camera', stamp: stamp(permission) }),
  ).toThrow('CAMERA_NOT_READY');
  const camera = transition(permission, {
    type: 'advance',
    to: 'camera',
    stamp: stamp(permission),
    evidence: { permissionGranted: true, cameraReady: true },
  });
  const background = transition(camera, { type: 'lifecycle', foreground: false });
  expect(() => transition(background, { type: 'photo', stamp: stamp(background) })).toThrow(
    'CAMERA_NOT_ACTIVE',
  );
  const captured = transition(camera, { type: 'photo', stamp: stamp(camera) });
  const preparing = transition(captured, {
    type: 'advance',
    to: 'preparing',
    stamp: stamp(captured),
  });
  expect(() =>
    transition(preparing, {
      type: 'advance',
      to: 'uploading',
      stamp: stamp(preparing),
      evidence: { imagePrepared: true, uploadAuthorized: true },
    }),
  ).toThrow('UPLOAD_NOT_AUTHORIZED');
  expect(transition(preparing, { type: 'manual' }).stage).toBe('needs-confirmation');
});

test('manual status and completed assessments cannot bypass the image trust boundary', () => {
  const status = {
    schemaVersion: '1',
    scanId: uuid,
    source: 'manual',
    state: 'needs_confirmation',
    revisions: { version: 1, imageRevision: 0, draftRevision: 0 },
    sanitization: { state: 'not_started', imageRevision: 0, updatedAt: time },
    recognitionAvailable: false,
    manualFallback: true,
    draft: { draftRevision: 0, ingredients: [] },
    result: null,
    confirmation: null,
    failure: null,
    createdAt: time,
    updatedAt: time,
    expiresAt: null,
  };
  expect(scanStatus.safeParse(status).success).toBe(true);
  for (const changed of [{ state: 'queued' }, { manualFallback: false }, { draft: null }])
    expect(scanStatus.safeParse({ ...status, ...changed }).success).toBe(false);
  const image = {
    ...status,
    source: 'gallery',
    manualFallback: false,
    revisions: { ...status.revisions, imageRevision: 1 },
    sanitization: { ...status.sanitization, imageRevision: 1 },
    result: { schemaVersion: '1', imageRevision: 1, assessment: 'abstained', detections: [] },
  };
  expect(scanStatus.safeParse(image).success).toBe(false);
  expect(
    scanStatus.safeParse({ ...image, sanitization: { ...image.sanitization, state: 'passed' } })
      .success,
  ).toBe(true);
  // Availability may change after admission; a status remains readable during an outage.
  expect(
    scanStatus.safeParse({
      ...image,
      state: 'recognizing',
      result: null,
      sanitization: { ...image.sanitization, state: 'passed' },
    }).success,
  ).toBe(true);
});

test('empty food claims and invalid media-deletion deadlines are rejected', () => {
  expect(
    recognitionAssessment.safeParse({
      schemaVersion: '1',
      imageRevision: 1,
      assessment: 'food_detected',
      detections: [],
    }).success,
  ).toBe(false);
  const receipt = {
    deletionId: uuid,
    acceptedAt: time,
    status: 'accepted',
    mediaDeleteBy: '2026-09-22T12:00:00Z',
  };
  expect(deletionReceipt.safeParse(receipt).success).toBe(true);
  for (const mediaDeleteBy of ['2026-09-21T11:59:59Z', '2026-09-22T12:00:01Z'])
    expect(deletionReceipt.safeParse({ ...receipt, mediaDeleteBy }).success).toBe(false);
});

test('confirmation requires a new server version and editing invalidates the revision', () => {
  const draft: Model = {
    ...initial,
    stage: 'needs-confirmation',
    draftRevision: 1,
    serverVersion: 2,
  };
  const evidence = { confirmationAcknowledged: true, selectedCount: 1, draftRevision: 1 };
  expect(() =>
    transition(draft, { type: 'advance', to: 'confirmed', stamp: stamp(draft), evidence }),
  ).toThrow('CONFIRMATION_REQUIRED');
  const confirmed = transition(draft, {
    type: 'advance',
    to: 'confirmed',
    stamp: stamp(draft),
    evidence,
    serverVersion: 3,
  });
  expect(() =>
    transition(confirmed, { type: 'advance', to: 'needs-confirmation', stamp: stamp(confirmed) }),
  ).toThrow('USE_EDIT_EVENT');
  expect(transition(confirmed, { type: 'edit' }).draftRevision).toBe(2);
  expect(() =>
    transition(
      { ...draft, draftRevision: 0 },
      {
        type: 'advance',
        to: 'confirmed',
        stamp: stamp(draft),
        evidence: { ...evidence, draftRevision: 0 },
        serverVersion: 3,
      },
    ),
  ).toThrow('CONFIRMATION_REQUIRED');
});

test('unknown connectivity permits an authorized attempt but known offline blocks upload', () => {
  const state: Model = { ...initial, stage: 'preparing', imageRevision: 1 };
  const event = {
    type: 'advance' as const,
    to: 'uploading' as const,
    stamp: stamp(state),
    evidence: { imagePrepared: true, uploadAuthorized: true, providerAvailable: true },
  };
  expect(transition(state, event).stage).toBe('uploading');
  expect(() => transition({ ...state, online: false }, event)).toThrow('UPLOAD_NOT_AUTHORIZED');
});

test('identity changes fence callbacks even when the new account reuses revision numbers', () => {
  const old = transition(initial, { type: 'photo', stamp: stamp(initial) });
  const reset = transition(old, { type: 'identity-reset' });
  const next = transition(reset, { type: 'photo', stamp: stamp(reset) });
  expect(next.imageRevision).toBe(old.imageRevision);
  expect(transition(next, { type: 'advance', to: 'preparing', stamp: stamp(old) })).toBe(next);
});

test('an assessed recognition advances with its authoritative draft revision', () => {
  const state: Model = { ...initial, stage: 'recognizing', imageRevision: 1, serverVersion: 4 };
  const event = {
    type: 'advance' as const,
    to: 'needs-confirmation' as const,
    stamp: stamp(state),
    serverVersion: 5,
    evidence: { validAssessment: true, draftRevision: 1 },
  };
  expect(transition(state, event).draftRevision).toBe(1);
  expect(() => transition(state, { ...event, evidence: { validAssessment: true } })).toThrow(
    'DRAFT_REVISION_REQUIRED',
  );
});

test('source preparation enforces revised decode, byte and aspect-ratio ceilings', () => {
  const source = { mime: 'image/jpeg', bytes: 25 * 1024 * 1024, width: 4000, height: 3000 };
  expect(sourceImage.safeParse(source).success).toBe(true);
  for (const changed of [
    { bytes: source.bytes + 1 },
    { width: 4001 },
    { width: 6000, height: 4000 },
    { width: 12000, height: 1000 },
    { mime: 'image/heic' },
  ])
    expect(sourceImage.safeParse({ ...source, ...changed }).success).toBe(false);
});
