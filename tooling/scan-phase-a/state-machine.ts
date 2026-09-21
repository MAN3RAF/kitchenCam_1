// Pure executable specification for review. Not wired to screens or backend jobs.
export const states = [
  'idle',
  'permission-required',
  'camera',
  'captured',
  'preparing',
  'uploading',
  'sanitizing',
  'queued',
  'recognizing',
  'needs-confirmation',
  'confirmed',
  'failed',
  'cancelled',
] as const;
export type Stage = (typeof states)[number];
export const transitions: Readonly<Record<Stage, readonly Stage[]>> = {
  idle: ['permission-required', 'camera', 'captured', 'needs-confirmation', 'cancelled'],
  'permission-required': ['camera', 'captured', 'needs-confirmation', 'failed', 'cancelled'],
  camera: ['permission-required', 'captured', 'needs-confirmation', 'failed', 'cancelled'],
  captured: ['camera', 'preparing', 'needs-confirmation', 'failed', 'cancelled'],
  preparing: ['uploading', 'needs-confirmation', 'failed', 'cancelled'],
  uploading: ['sanitizing', 'needs-confirmation', 'failed', 'cancelled'],
  sanitizing: ['queued', 'needs-confirmation', 'failed', 'cancelled'],
  queued: ['recognizing', 'needs-confirmation', 'failed', 'cancelled'],
  recognizing: ['queued', 'needs-confirmation', 'failed', 'cancelled'],
  'needs-confirmation': ['confirmed', 'cancelled'],
  confirmed: ['needs-confirmation'],
  failed: [
    'permission-required',
    'camera',
    'captured',
    'preparing',
    'uploading',
    'sanitizing',
    'queued',
    'needs-confirmation',
    'cancelled',
  ],
  cancelled: [],
};

export type Model = Readonly<{
  stage: Stage;
  imageRevision: number;
  draftRevision: number;
  generation: number;
  serverVersion: number;
  online: boolean | null;
  foreground: boolean;
  cancellationPending: boolean;
  manual: boolean;
}>;
export const initial: Model = {
  stage: 'idle',
  imageRevision: 0,
  draftRevision: 0,
  generation: 0,
  serverVersion: 0,
  online: null,
  foreground: true,
  cancellationPending: false,
  manual: false,
};
export type Stamp = Pick<Model, 'imageRevision' | 'generation'>;
type Evidence = Readonly<{
  permissionGranted?: boolean;
  cameraReady?: boolean;
  imagePrepared?: boolean;
  uploadAuthorized?: boolean;
  uploadVerified?: boolean;
  sanitized?: boolean;
  providerAvailable?: boolean;
  validAssessment?: boolean;
  confirmationAcknowledged?: boolean;
  selectedCount?: number;
  draftRevision?: number;
  retryAuthorized?: boolean;
  artifactAvailable?: boolean;
  attemptsRemaining?: boolean;
}>;
export type Event =
  | { type: 'identity-reset' }
  | { type: 'connectivity'; online: boolean | null }
  | { type: 'lifecycle'; foreground: boolean }
  | { type: 'photo'; stamp: Stamp }
  | { type: 'manual' }
  | { type: 'edit' }
  | { type: 'cancel' }
  | { type: 'cancel-ack'; generation: number }
  | { type: 'advance'; to: Stage; stamp: Stamp; serverVersion?: number; evidence?: Evidence };

const networkStages = new Set<Stage>(['uploading', 'sanitizing', 'queued', 'recognizing']);
const current = (state: Model, stamp: Stamp) =>
  state.imageRevision === stamp.imageRevision && state.generation === stamp.generation;
export function visibleState(state: Model): Stage | 'offline' {
  return state.online === false && (networkStages.has(state.stage) || state.cancellationPending)
    ? 'offline'
    : state.stage;
}

export function transition(state: Model, event: Event): Model {
  if (event.type === 'identity-reset')
    return {
      ...initial,
      generation: state.generation + 1,
      online: state.online,
      foreground: state.foreground,
    };
  if (event.type === 'connectivity') return { ...state, online: event.online };
  if (event.type === 'lifecycle') return { ...state, foreground: event.foreground };
  if (event.type === 'cancel-ack') {
    if (!state.cancellationPending || state.generation !== event.generation) return state;
    return { ...state, stage: 'cancelled', cancellationPending: false };
  }
  if (state.stage === 'cancelled' || state.cancellationPending) return state;
  if (event.type === 'cancel') {
    if (state.stage === 'confirmed') throw new Error('DELETE_REQUIRED');
    return {
      ...state,
      generation: state.generation + 1,
      cancellationPending: state.serverVersion > 0,
      stage: state.serverVersion > 0 ? state.stage : 'cancelled',
    };
  }
  if (event.type === 'photo') {
    if (!current(state, event.stamp)) return state;
    if (!['idle', 'permission-required', 'camera', 'captured', 'failed'].includes(state.stage))
      throw new Error('INVALID_TRANSITION');
    if (!state.foreground) throw new Error('CAMERA_NOT_ACTIVE');
    return {
      ...state,
      stage: 'captured',
      imageRevision: state.imageRevision + 1,
      draftRevision: 0,
      generation: state.generation + 1,
      manual: false,
    };
  }
  if (event.type === 'manual') {
    if (state.stage === 'confirmed') throw new Error('EDIT_REQUIRED');
    return {
      ...state,
      stage: 'needs-confirmation',
      manual: true,
      generation: state.generation + 1,
    };
  }
  if (event.type === 'edit') {
    if (!['needs-confirmation', 'confirmed'].includes(state.stage))
      throw new Error('INVALID_TRANSITION');
    return {
      ...state,
      stage: 'needs-confirmation',
      draftRevision: state.draftRevision + 1,
      generation: state.generation + 1,
    };
  }
  if (!current(state, event.stamp)) return state;
  if (event.serverVersion !== undefined && event.serverVersion <= state.serverVersion) return state;
  if (!transitions[state.stage].includes(event.to)) throw new Error('INVALID_TRANSITION');
  if (event.to === 'captured') throw new Error('USE_PHOTO_EVENT');
  const evidence = event.evidence ?? {};
  if (
    state.stage === 'failed' &&
    networkStages.has(event.to) &&
    !(evidence.retryAuthorized && evidence.artifactAvailable && evidence.attemptsRemaining)
  )
    throw new Error('RETRY_NOT_AUTHORIZED');
  if (
    event.to === 'camera' &&
    !(evidence.permissionGranted && evidence.cameraReady && state.foreground)
  )
    throw new Error('CAMERA_NOT_READY');
  if (
    event.to === 'uploading' &&
    !(
      state.online !== false &&
      !state.manual &&
      evidence.imagePrepared &&
      evidence.uploadAuthorized &&
      evidence.providerAvailable
    )
  )
    throw new Error('UPLOAD_NOT_AUTHORIZED');
  if (event.to === 'sanitizing' && !evidence.uploadVerified) throw new Error('UPLOAD_NOT_VERIFIED');
  if (
    ['queued', 'recognizing'].includes(event.to) &&
    !(evidence.sanitized && evidence.providerAvailable && !state.manual)
  )
    throw new Error('RECOGNITION_NOT_AUTHORIZED');
  if (
    event.to === 'queued' &&
    state.stage === 'recognizing' &&
    !(evidence.retryAuthorized && evidence.attemptsRemaining)
  )
    throw new Error('RETRY_NOT_AUTHORIZED');
  if (
    event.to === 'needs-confirmation' &&
    state.stage === 'recognizing' &&
    !evidence.validAssessment
  )
    throw new Error('ASSESSMENT_REQUIRED');
  if (event.to === 'needs-confirmation' && state.stage === 'confirmed')
    throw new Error('USE_EDIT_EVENT');
  if (event.to === 'needs-confirmation' && !['recognizing', 'confirmed'].includes(state.stage))
    throw new Error('USE_MANUAL_EVENT');
  if (
    event.to === 'confirmed' &&
    !(
      evidence.confirmationAcknowledged &&
      event.serverVersion !== undefined &&
      state.draftRevision > 0 &&
      (evidence.selectedCount ?? 0) > 0 &&
      evidence.draftRevision === state.draftRevision
    )
  )
    throw new Error('CONFIRMATION_REQUIRED');
  if (
    event.to === 'needs-confirmation' &&
    state.stage === 'recognizing' &&
    !(evidence.draftRevision !== undefined && evidence.draftRevision > state.draftRevision)
  )
    throw new Error('DRAFT_REVISION_REQUIRED');
  if (networkStages.has(event.to) && event.serverVersion === undefined && event.to !== 'uploading')
    throw new Error('SERVER_ACK_REQUIRED');
  if (event.to === 'cancelled') throw new Error('USE_CANCELLATION_EVENT');
  return {
    ...state,
    stage: event.to,
    serverVersion: event.serverVersion ?? state.serverVersion,
    draftRevision:
      event.to === 'needs-confirmation'
        ? (evidence.draftRevision ?? state.draftRevision)
        : state.draftRevision,
  };
}
