import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@/features/auth/auth-provider';
import { useConnectivity } from '@/hooks/use-connectivity';
import { publicEnvironment } from '@/config/public-env';
import { getBackendClient } from '@/services/backend/client';
import type { Database } from '@/types/database.generated';
import { ScanError, type Ingredient, type ManualScan } from './scan-domain';
import { ScanEditor } from './scan-editor';
import { createScanService, type ScanService } from './scan-service';

export class ScanSession {
  readonly query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  private editors = new Map<string, ScanEditor>();
  private creation: { key: string; rows: Ingredient[]; result?: ManualScan } | null = null;
  private creating: Promise<ManualScan> | null = null;
  active = true;
  activate() {
    this.active = true;
  }
  constructor(
    readonly service: ScanService,
    readonly ownerId: string,
  ) {}
  editor(scan: ManualScan) {
    let editor = this.editors.get(scan.id);
    if (!editor) {
      editor = new ScanEditor(scan, this.service, randomUUID);
      this.editors.set(scan.id, editor);
    }
    return editor;
  }
  peek(id: string) {
    return this.active ? this.editors.get(id)?.snapshot().base : undefined;
  }
  newList() {
    if (!this.creating && this.creation?.result) this.creation = null;
  }
  create() {
    if (!this.active) return Promise.reject(new ScanError('AUTH_REQUIRED'));
    if (this.creating) return this.creating;
    this.creation ??= { key: randomUUID(), rows: [] };
    const attempt = this.creation;
    if (attempt.result) return Promise.resolve(attempt.result);
    this.creating = this.service
      .create(attempt.key, attempt.rows)
      .then((scan) => {
        if (!this.active) throw new ScanError('AUTH_REQUIRED');
        attempt.result = scan;
        return scan;
      })
      .finally(() => {
        this.creating = null;
      });
    return this.creating;
  }
  dispose() {
    this.active = false;
    this.editors.forEach((editor) => editor.dispose());
    this.editors.clear();
    this.creation = null;
    this.query.clear();
  }
}
const ScanContext = createContext<ScanSession | null>(null);
function accountSession(ownerId: string) {
  // Bind each request's bearer token to this owner, even during an account switch.
  const client = createClient<Database>(
    publicEnvironment.supabaseUrl!,
    publicEnvironment.supabasePublishableKey!,
    {
      accessToken: async () => {
        const result = await getBackendClient()?.auth.getSession();
        // A stale account scope must never borrow the next account's token.
        // Null also avoids throwing during the SDK's eager Realtime initialization.
        return result?.data.session?.user.id === ownerId ? result.data.session.access_token : null;
      },
    },
  );
  return new ScanSession(createScanService(client, ownerId), ownerId);
}
export function ScanProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const ownerId = user?.id;
  const session = useMemo(() => (ownerId ? accountSession(ownerId) : null), [ownerId]);
  const [emptyQuery] = useState(() => new QueryClient());
  const connectivity = useConnectivity();
  useEffect(() => {
    session?.activate();
    return () => {
      if (!session) return;
      session.active = false;
      // Strict Mode immediately reconnects effects. Fence navigation now, but
      // release editors only if this account scope actually remains unmounted.
      queueMicrotask(() => {
        if (!session.active) session.dispose();
      });
    };
  }, [session]);
  useEffect(() => {
    if (session) void session.query.invalidateQueries();
  }, [session, user]);
  useEffect(() => {
    onlineManager.setOnline(connectivity !== 'offline');
  }, [connectivity]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  return (
    <ScanContext value={session}>
      <QueryClientProvider client={session?.query ?? emptyQuery}>{children}</QueryClientProvider>
    </ScanContext>
  );
}
export function useScanSession() {
  return useContext(ScanContext);
}
