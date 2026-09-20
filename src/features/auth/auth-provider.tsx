import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  clearPendingEmailAuthentication,
  completeMagicLink,
  ensureGuestSession,
  loadPendingEmailAuthentication,
  requestAccountDeletion,
  requestEmailCode,
  signOut,
  verifyEmailCode,
  type PendingEmailAuthentication,
} from '@/features/auth/auth-service';
import { getBackendClient, isBackendConfigured } from '@/services/backend/client';

export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'guest' | 'permanent';

type AuthContextValue = Readonly<{
  status: AuthStatus;
  user: User | null;
  pendingEmail: PendingEmailAuthentication | null;
  createGuestSession: typeof ensureGuestSession;
  requestEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (code: string) => Promise<{ preferenceReviewRequired: boolean }>;
  completeMagicLink: typeof completeMagicLink;
  clearPendingEmail: () => Promise<void>;
  signOut: typeof signOut;
  requestAccountDeletion: typeof requestAccountDeletion;
}>;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function statusForSession(session: Session | null): AuthStatus {
  if (!session) return 'signed-out';
  return session.user.is_anonymous ? 'guest' : 'permanent';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const configured = isBackendConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [pendingEmail, setPendingEmail] = useState<PendingEmailAuthentication | null>(null);
  const [status, setStatus] = useState<AuthStatus>(configured ? 'loading' : 'unconfigured');

  useEffect(() => {
    const client = getBackendClient();
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(statusForSession(data.session));
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(statusForSession(nextSession));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadPendingEmailAuthentication().then((pending) => {
      if (active) setPendingEmail(pending);
    });
    return () => {
      active = false;
    };
  }, []);

  const beginEmail = useCallback(async (email: string) => {
    const pending = await requestEmailCode(email);
    setPendingEmail(pending);
  }, []);

  const finishEmail = useCallback(
    async (code: string) => {
      if (!pendingEmail) throw new Error('No email authentication attempt is active.');
      const result = await verifyEmailCode(pendingEmail, code);
      setPendingEmail(null);
      return result;
    },
    [pendingEmail],
  );

  const finishMagicLink = useCallback(async (input: Parameters<typeof completeMagicLink>[0]) => {
    const result = await completeMagicLink(input);
    setPendingEmail(null);
    return result;
  }, []);

  const clearPendingEmail = useCallback(async () => {
    await clearPendingEmailAuthentication();
    setPendingEmail(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      pendingEmail,
      createGuestSession: ensureGuestSession,
      requestEmailCode: beginEmail,
      verifyEmailCode: finishEmail,
      completeMagicLink: finishMagicLink,
      clearPendingEmail,
      signOut,
      requestAccountDeletion,
    }),
    [
      beginEmail,
      clearPendingEmail,
      finishEmail,
      finishMagicLink,
      pendingEmail,
      session?.user,
      status,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
