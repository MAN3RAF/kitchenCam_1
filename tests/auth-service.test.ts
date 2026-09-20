import { getBackendClient } from '@/services/backend/client';
import {
  completeMagicLink,
  ensureGuestSession,
  requestAccountDeletion,
  requestEmailCode,
  verifyEmailCode,
} from '@/features/auth/auth-service';
import { sessionStorage } from '@/services/backend/session-storage';

jest.mock('@/services/backend/client', () => ({ getBackendClient: jest.fn() }));
jest.mock('@/services/backend/session-storage', () => ({
  sessionStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const mockedGetBackendClient = jest.mocked(getBackendClient);
const mockedSessionStorage = jest.mocked(sessionStorage);

function createClient() {
  return {
    auth: {
      getSession: jest.fn(),
      signInAnonymously: jest.fn(),
      updateUser: jest.fn(),
      signOut: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      exchangeCodeForSession: jest.fn(),
    },
    functions: { invoke: jest.fn() },
  };
}

describe('authentication service', () => {
  it('creates an anonymous identity only when continuity is requested', async () => {
    const session = { access_token: 'local-test-session' };
    const client = createClient();
    client.auth.getSession.mockResolvedValue({ data: { session: null } });
    client.auth.signInAnonymously.mockResolvedValue({ data: { session }, error: null });
    mockedGetBackendClient.mockReturnValue(client as never);

    await expect(ensureGuestSession()).resolves.toBe(session);
    expect(client.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('uses an authenticated merge ticket before signing into an existing account', async () => {
    const client = createClient();
    client.auth.getSession.mockResolvedValue({
      data: { session: { user: { is_anonymous: true } } },
    });
    client.auth.updateUser.mockResolvedValue({ error: { code: 'email_exists' } });
    client.functions.invoke.mockResolvedValue({
      data: { data: { token: 'a'.repeat(64) } },
      error: null,
    });
    client.auth.signOut.mockResolvedValue({ error: null });
    client.auth.signInWithOtp.mockResolvedValue({ error: null });
    mockedGetBackendClient.mockReturnValue(client as never);

    await expect(requestEmailCode(' Person@Example.Test ')).resolves.toEqual({
      email: 'person@example.test',
      type: 'email',
      mergeToken: 'a'.repeat(64),
      expiresAt: expect.any(String),
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('account-merge-ticket', {
      method: 'POST',
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'person@example.test',
      options: { shouldCreateUser: false },
    });
    expect(mockedSessionStorage.setItem).toHaveBeenCalledWith(
      'kitchencam.pending-email-auth.v1',
      expect.stringContaining('person@example.test'),
    );
  });

  it('verifies the OTP before consuming a pending merge ticket', async () => {
    const client = createClient();
    client.auth.verifyOtp.mockResolvedValue({ error: null });
    client.functions.invoke.mockResolvedValue({
      data: { data: { preferenceReviewRequired: true } },
      error: null,
    });
    mockedGetBackendClient.mockReturnValue(client as never);

    await expect(
      verifyEmailCode(
        {
          email: 'person@example.test',
          type: 'email',
          mergeToken: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        '123456',
      ),
    ).resolves.toEqual({ preferenceReviewRequired: true });
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.test',
      token: '123456',
      type: 'email',
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('account-merge', {
      method: 'POST',
      body: { token: 'b'.repeat(64) },
    });
    expect(mockedSessionStorage.removeItem).toHaveBeenCalledWith(
      'kitchencam.pending-email-auth.v1',
    );
  });

  it('resumes a pending guest merge after a magic-link callback', async () => {
    const client = createClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.functions.invoke.mockResolvedValue({
      data: { data: { preferenceReviewRequired: false } },
      error: null,
    });
    mockedSessionStorage.getItem.mockResolvedValue(
      JSON.stringify({
        email: 'person@example.test',
        type: 'email',
        mergeToken: 'c'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    mockedGetBackendClient.mockReturnValue(client as never);

    await expect(completeMagicLink({ code: 'local-auth-code' })).resolves.toEqual({
      preferenceReviewRequired: false,
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('account-merge', {
      method: 'POST',
      body: { token: 'c'.repeat(64) },
    });
  });

  it('signs out locally only after the deletion function accepts the request', async () => {
    const client = createClient();
    client.functions.invoke.mockResolvedValue({
      data: { data: { requestId: '40000000-0000-4000-8000-000000000001' } },
      error: null,
    });
    client.auth.signOut.mockResolvedValue({ error: null });
    mockedGetBackendClient.mockReturnValue(client as never);

    await expect(requestAccountDeletion()).resolves.toBe('40000000-0000-4000-8000-000000000001');
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
