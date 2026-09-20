export type AuthErrorCode =
  | 'ACCOUNT_EXISTS'
  | 'AUTH_UNAVAILABLE'
  | 'CODE_INVALID'
  | 'EMAIL_INVALID'
  | 'LINK_INVALID'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED';

export class AuthFlowError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

export function mapAuthError(error: unknown): AuthFlowError {
  if (error instanceof AuthFlowError) return error;
  if (error && typeof error === 'object') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
    const status = 'status' in error && typeof error.status === 'number' ? error.status : 0;
    if (status === 429 || code.includes('rate')) {
      return new AuthFlowError('RATE_LIMITED', 'Too many attempts. Wait a moment and try again.');
    }
    if (code === 'otp_expired' || code === 'otp_disabled' || code === 'invalid_credentials') {
      return new AuthFlowError('CODE_INVALID', 'That code is invalid or has expired.');
    }
    if (code === 'email_exists' || code === 'identity_already_exists') {
      return new AuthFlowError('ACCOUNT_EXISTS', 'That email is already connected to an account.');
    }
  }
  return new AuthFlowError('PROVIDER_ERROR', 'Sign-in could not be completed. Try again.');
}
