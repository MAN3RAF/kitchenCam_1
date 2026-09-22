import { useEffect, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useConnectivity } from '@/hooks/use-connectivity';
import { selectionIssue, type ManualScan } from './scan-domain';
import type { ScanSession } from './scan-provider';
import {
  IngredientSummary,
  LoadedScan,
  ScanAccountGate,
  scanStyles,
  useRouteActive,
} from './scan-shared';
import { ConflictPanel } from './scan-editor-screen';

export function ConfirmIngredients({ scan, session }: { scan: ManualScan; session: ScanSession }) {
  const isActive = useRouteActive();
  const editor = session.editor(scan);
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  const online = useConnectivity() !== 'offline';
  useEffect(() => {
    editor.receive(scan);
  }, [editor, scan]);
  const selected = state.rows.filter((row) => row.selected);
  const issue = selectionIssue(state.rows);
  const needsSave =
    state.status === 'editing' ||
    editor.pendingOperation === 'ingredients' ||
    !!state.input ||
    !!state.editingId;
  async function confirm() {
    const result = await editor.submit('confirm', online);
    if (result) {
      session.query.setQueryData(['scan', session.ownerId, scan.id], result);
      if (isActive()) router.replace(`/scans/${scan.id}/ready`);
    }
  }
  return (
    <Screen>
      <View style={scanStyles.section}>
        <Text variant="title" accessibilityRole="header">
          Ready to confirm?
        </Text>
        <Text>
          These are the ingredients you’ve chosen for future recipe suggestions. Recipe suggestions
          aren’t available yet.
        </Text>
        <Text variant="subheading">{selected.length} selected ingredients</Text>
        <IngredientSummary rows={selected} />
        {issue ? <Text accessibilityRole="alert">{issue}</Text> : null}
        {needsSave ? (
          <Text>Return to your ingredients and save your changes before confirming.</Text>
        ) : null}
        {!online ? (
          <Text>Connect to confirm your selection. Nothing will be confirmed while offline.</Text>
        ) : null}
        {state.error ? (
          <Text accessibilityRole="alert" tone="danger">
            {state.error}
          </Text>
        ) : null}
        {state.status === 'uncertain' && !needsSave ? (
          <Text>Confirmation is not yet verified. Retry to check the same attempt safely.</Text>
        ) : null}
      </View>
      <ConflictPanel editor={editor} online={online} />
      {state.base.state === 'confirmed' && state.status === 'saved' ? (
        <Button
          label="View confirmed list"
          onPress={() => router.replace(`/scans/${scan.id}/ready`)}
        />
      ) : (
        <Button
          label={
            state.status === 'saving'
              ? 'Confirming…'
              : state.status === 'uncertain' && !needsSave
                ? 'Retry confirmation'
                : 'Confirm ingredients'
          }
          accessibilityState={{ busy: state.status === 'saving' }}
          disabled={
            !online ||
            !!issue ||
            needsSave ||
            state.status === 'saving' ||
            state.status === 'conflict'
          }
          onPress={() => {
            void confirm();
          }}
        />
      )}
      <Button
        label="Edit ingredients"
        variant="secondary"
        onPress={() => router.replace(`/scans/${scan.id}`)}
      />
    </Screen>
  );
}
export function ScanConfirmScreen({ id }: { id: string }) {
  return (
    <ScanAccountGate>
      {(session) => (
        <LoadedScan id={id} session={session}>
          {(scan) => <ConfirmIngredients scan={scan} session={session} />}
        </LoadedScan>
      )}
    </ScanAccountGate>
  );
}
