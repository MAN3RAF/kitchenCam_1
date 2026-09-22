import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Button } from '@/components/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/auth-provider';
import { useConnectivity } from '@/hooks/use-connectivity';
import { scanError } from './scan-domain';
import { useScanSession, type ScanSession } from './scan-provider';
import { scanStyles, useRouteActive } from './scan-shared';

function SavedLists({ session }: { session: ScanSession }) {
  const [page, setPage] = useState(0);
  const online = useConnectivity() !== 'offline';
  const query = useQuery({
    queryKey: ['scans', session.ownerId, page],
    queryFn: () => session.service.list(page * 20),
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return (
    <View style={scanStyles.section}>
      <Text variant="subheading" accessibilityRole="header">
        Your saved lists
      </Text>
      {query.error ? (
        <ErrorState
          title="Could not load your lists"
          message={scanError(query.error).message}
          retry={
            online
              ? () => {
                  void query.refetch();
                }
              : undefined
          }
        />
      ) : !query.data ? (
        online ? (
          <LoadingState label="Loading saved lists" />
        ) : (
          <Text>Connect to see your saved lists.</Text>
        )
      ) : !query.data.length ? (
        <EmptyState
          title="No saved lists here yet"
          message="Add ingredients to make your first list."
        />
      ) : (
        query.data.map((scan, index) => (
          <Button
            key={scan.id}
            variant="secondary"
            label={`${scan.state === 'confirmed' ? 'Confirmed' : 'Draft'} list · ${new Date(scan.createdAt).toLocaleDateString()} · ${scan.ingredients.length} ingredients`}
            accessibilityLabel={`Open ${scan.state === 'confirmed' ? 'confirmed' : 'draft'} list ${page * 20 + index + 1}, ${new Date(scan.createdAt).toLocaleString()}, ${scan.ingredients.length} ingredients`}
            onPress={() =>
              router.push(
                scan.state === 'confirmed' ? `/scans/${scan.id}/ready` : `/scans/${scan.id}`,
              )
            }
          />
        ))
      )}
      <View style={scanStyles.actions}>
        {page > 0 ? (
          <Button label="Newer lists" variant="secondary" onPress={() => setPage(page - 1)} />
        ) : null}
        {query.data?.length === 20 ? (
          <Button label="Older lists" variant="secondary" onPress={() => setPage(page + 1)} />
        ) : null}
      </View>
    </View>
  );
}
export function ScanEntryScreen() {
  const session = useScanSession();
  return (
    <Screen>
      <View style={scanStyles.section}>
        <Text variant="title" accessibilityRole="header">
          What’s in your kitchen?
        </Text>
        <Text>Add what you have, then choose the ingredients you want to use.</Text>
        <Button
          label="Add ingredients manually"
          onPress={() => {
            session?.newList();
            router.push('/scans/manual');
          }}
        />
        <Text tone="textSecondary">
          Photo recognition isn’t available yet. Add your ingredients to continue.
        </Text>
      </View>
      {session ? (
        <SavedLists session={session} />
      ) : (
        <Text tone="textSecondary">
          Your lists will be saved privately when you start. No account sign-up is required.
        </Text>
      )}
    </Screen>
  );
}
export function ManualStartScreen() {
  const isActive = useRouteActive();
  const auth = useAuth();
  const session = useScanSession();
  const online = useConnectivity() !== 'offline';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  async function start() {
    if (locked.current || !online) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!session) {
        await auth.createGuestSession();
        return;
      }
      const scan = await session.create();
      if (session.active && isActive()) router.replace(`/scans/${scan.id}`);
    } catch (error) {
      setError(scanError(error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Your ingredients, your choice
      </Text>
      <Text>Build a list by hand. You can save it, come back later, and choose what to use.</Text>
      {error ? (
        <Text accessibilityRole="alert" tone="danger">
          {error}
        </Text>
      ) : null}
      {auth.status === 'unconfigured' ? (
        <Text>Ingredient saving is not configured in this build.</Text>
      ) : (
        <Button
          label={
            busy ? 'Starting your list…' : session ? 'Start ingredient list' : 'Continue as guest'
          }
          accessibilityState={{ busy }}
          disabled={!online || busy || auth.status === 'loading'}
          onPress={() => {
            void start();
          }}
        />
      )}
      {!online ? <Text>Connect to start a saved ingredient list.</Text> : null}
      <Button
        label="Back to Ingredients"
        variant="secondary"
        onPress={() => router.replace('/scans')}
      />
    </Screen>
  );
}
