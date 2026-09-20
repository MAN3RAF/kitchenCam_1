import { z } from 'zod';
import { getBackendClient } from '@/services/backend/client';
import { sessionStorage } from '@/services/backend/session-storage';
import { AuthFlowError, mapAuthError } from '@/features/auth/auth-errors';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const otpSchema = z.string().regex(/^\d{6}$/);
const pendingAuthenticationKey = 'kitchencam.pending-email-auth.v1';
const pendingAuthenticationSchema = z.object({
  email: z.email(),
  type: z.enum(['email', 'email_change']),
  mergeToken: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  expiresAt: z.iso.datetime(),
});

export type EmailOtpType = 'email' | 'email_change';

export type PendingEmailAuthentication = Readonly<{
  email: string;
  type: EmailOtpType;
  mergeToken?: string;
  expiresAt: string;
}>;

function configuredClient() {
  const client = getBackendClient();
  if (!client)
    throw new AuthFlowError('AUTH_UNAVAILABLE', 'Sign-in is not configured in this build.');
  return client;
}

async function persistPendingAuthentication(pending: PendingEmailAuthentication) {
  await sessionStorage.setItem(pendingAuthenticationKey, JSON.stringify(pending));
  return pending;
}

export async function loadPendingEmailAuthentication(): Promise<PendingEmailAuthentication | null> {
  const raw = await sessionStorage.getItem(pendingAuthenticationKey);
  if (!raw) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    candidate = null;
  }
  const parsed = pendingAuthenticationSchema.safeParse(candidate);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) {
    await sessionStorage.removeItem(pendingAuthenticationKey);
    return null;
  }
  return parsed.data;
}

export async function clearPendingEmailAuthentication() {
  await sessionStorage.removeItem(pendingAuthenticationKey);
}

async function consumeMergeTicket(mergeToken?: string) {
  if (!mergeToken) return { preferenceReviewRequired: false };
  const client = configuredClient();
  const { data, error } = await client.functions.invoke('account-merge', {
    method: 'POST',
    body: { token: mergeToken },
  });
  if (error) throw mapAuthError(error);
  return { preferenceReviewRequired: data?.data?.preferenceReviewRequired === true };
}

export async function ensureGuestSession() {
  const client = configuredClient();
  const { data: current } = await client.auth.getSession();
  if (current.session) return current.session;
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) throw mapAuthError(error);
  return data.session;
}

export async function requestEmailCode(rawEmail: string): Promise<PendingEmailAuthentication> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw new AuthFlowError('EMAIL_INVALID', 'Enter a valid email address.');
  const email = parsed.data;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const client = configuredClient();
  const { data: current } = await client.auth.getSession();

  if (current.session?.user.is_anonymous) {
    const { error } = await client.auth.updateUser({ email });
    if (!error) return persistPendingAuthentication({ email, type: 'email_change', expiresAt });
    const mapped = mapAuthError(error);
    if (mapped.code !== 'ACCOUNT_EXISTS') throw mapped;

    const { data: ticketResponse, error: ticketError } = await client.functions.invoke(
      'account-merge-ticket',
      { method: 'POST' },
    );
    const token = ticketResponse?.data?.token;
    if (ticketError || typeof token !== 'string') throw mapAuthError(ticketError);
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError) throw mapAuthError(signOutError);
    const { error: signInError } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (signInError) throw mapAuthError(signInError);
    return persistPendingAuthentication({ email, type: 'email', mergeToken: token, expiresAt });
  }

  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw mapAuthError(error);
  return persistPendingAuthentication({ email, type: 'email', expiresAt });
}

export async function verifyEmailCode(
  pending: PendingEmailAuthentication,
  rawCode: string,
): Promise<{ preferenceReviewRequired: boolean }> {
  const parsed = otpSchema.safeParse(rawCode.trim());
  if (!parsed.success) throw new AuthFlowError('CODE_INVALID', 'Enter the six-digit code.');
  const client = configuredClient();
  const { error } = await client.auth.verifyOtp({
    email: pending.email,
    token: parsed.data,
    type: pending.type,
  });
  if (error) throw mapAuthError(error);

  const result = await consumeMergeTicket(pending.mergeToken);
  await clearPendingEmailAuthentication();
  return result;
}

export async function completeMagicLink(input: {
  code?: string;
  tokenHash?: string;
  type?: string;
}) {
  const client = configuredClient();
  if (input.code) {
    const { error } = await client.auth.exchangeCodeForSession(input.code);
    if (error) throw mapAuthError(error);
  } else if (input.tokenHash && (input.type === 'email' || input.type === 'email_change')) {
    const { error } = await client.auth.verifyOtp({
      token_hash: input.tokenHash,
      type: input.type,
    });
    if (error) throw mapAuthError(error);
  } else {
    throw new AuthFlowError('LINK_INVALID', 'This sign-in link is invalid or incomplete.');
  }
  const pending = await loadPendingEmailAuthentication();
  const result = await consumeMergeTicket(pending?.mergeToken);
  await clearPendingEmailAuthentication();
  return result;
}

export async function signOut() {
  const client = configuredClient();
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw mapAuthError(error);
}

export async function requestAccountDeletion() {
  const client = configuredClient();
  const { data, error } = await client.functions.invoke('account-delete', { method: 'POST' });
  if (error) throw mapAuthError(error);
  await client.auth.signOut({ scope: 'local' });
  return data?.data?.requestId as string | undefined;
}
