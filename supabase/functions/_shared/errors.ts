export class FunctionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
    message = 'The request could not be completed.',
  ) {
    super(message);
    this.name = 'FunctionError';
  }
}

export function mapUnknownError(error: unknown): FunctionError {
  if (error instanceof FunctionError) return error;
  if (error instanceof Error) {
    const known = new Set([
      'ACCOUNT_NOT_ACTIVE',
      'ANONYMOUS_ACCOUNT_REQUIRED',
      'AUTH_REQUIRED',
      'MERGE_SOURCE_NOT_ACTIVE',
      'MERGE_SOURCE_CLAIMED',
      'MERGE_TARGET_INVALID',
      'MERGE_TICKET_ALREADY_CLAIMED',
      'MERGE_TICKET_INVALID',
      'PERMANENT_ACCOUNT_REQUIRED',
      'RECENT_AUTH_REQUIRED',
    ]);
    if (known.has(error.message)) {
      const authenticationError = error.message === 'AUTH_REQUIRED';
      const recentAuthError = error.message === 'RECENT_AUTH_REQUIRED';
      return new FunctionError(
        error.message,
        authenticationError ? 401 : recentAuthError ? 403 : 409,
      );
    }
  }
  return new FunctionError('INTERNAL', 500, true);
}
