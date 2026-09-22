import { useCallback, useRef, type ReactNode } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { ErrorState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/auth-provider';
import { useConnectivity } from '@/hooks/use-connectivity';
import { spacing, radii } from '@/theme/tokens';
import {
  isTerminalScanError,
  scanError,
  scanIdSchema,
  type Ingredient,
  type ManualScan,
} from './scan-domain';
import { useScanSession, type ScanSession } from './scan-provider';

export const scanStyles = StyleSheet.create({
  section: { gap: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderRadius: radii.medium },
  fill: { flex: 1 },
  notice: { padding: spacing.lg, gap: spacing.sm },
});
export function useRouteActive() {
  const active = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );
  return useCallback(() => active.current, []);
}
export function IngredientSummary({ rows }: { rows: Ingredient[] }) {
  return (
    <View style={scanStyles.section}>
      {rows.map((row, index) => (
        <Text key={row.id} selectable accessibilityLabel={`${index + 1}. ${row.displayName}`}>
          {row.displayName}
        </Text>
      ))}
    </View>
  );
}
export function ScanAccountGate({ children }: { children: (session: ScanSession) => ReactNode }) {
  const session = useScanSession();
  const { status } = useAuth();
  if (session) return children(session);
  return (
    <Screen>
      {status === 'loading' ? (
        <LoadingState label="Restoring your session" />
      ) : (
        <>
          <ErrorState
            title="Ingredient lists unavailable"
            message={
              status === 'unconfigured'
                ? 'Ingredient saving is not configured in this build.'
                : 'Sign in to restore an existing list, or start a new list from Ingredients.'
            }
          />
          <Button label="Go to Ingredients" onPress={() => router.replace('/scans')} />
          {status === 'signed-out' ? (
            <Button label="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
          ) : null}
        </>
      )}
    </Screen>
  );
}
export function LoadedScan({
  id,
  session,
  children,
}: {
  id: string;
  session: ScanSession;
  children: (scan: ManualScan) => ReactNode;
}) {
  const connectivity = useConnectivity();
  const valid = scanIdSchema.safeParse(id).success;
  const query = useQuery({
    queryKey: ['scan', session.ownerId, id],
    queryFn: () => session.service.read(id),
    enabled: valid,
    initialData: () => session.peek(id),
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (valid) void refetch();
    }, [valid, refetch]),
  );
  const failure = query.error ? scanError(query.error) : null;
  const unavailable = failure?.code === 'UNAVAILABLE';
  const terminal = failure ? isTerminalScanError(failure) : false;
  if (!valid || (failure && (!unavailable || terminal || !query.data)))
    return (
      <Screen>
        <ErrorState
          title="Unable to open this list"
          message={!valid ? 'This ingredient link is invalid.' : scanError(query.error).message}
          retry={
            valid && !terminal && connectivity !== 'offline'
              ? () => {
                  void query.refetch();
                }
              : undefined
          }
        />
        <Button
          label="Go to Ingredients"
          variant="secondary"
          onPress={() => router.replace('/scans')}
        />
      </Screen>
    );
  if (!query.data)
    return (
      <Screen>
        {connectivity === 'offline' ? (
          <Text>Connect to load your saved ingredients.</Text>
        ) : (
          <LoadingState label="Loading your ingredients" />
        )}
      </Screen>
    );
  const remembered = session.peek(id);
  const scan = remembered && remembered.version > query.data.version ? remembered : query.data;
  return (
    <View style={scanStyles.fill}>
      {unavailable ? (
        <View style={scanStyles.notice}>
          <Text accessibilityRole="alert">
            Could not refresh this list. Showing the last saved version and your local edits.
          </Text>
          <Button
            label="Retry refresh"
            variant="secondary"
            disabled={connectivity === 'offline'}
            onPress={() => {
              void refetch();
            }}
          />
        </View>
      ) : null}
      {children(scan)}
    </View>
  );
}
