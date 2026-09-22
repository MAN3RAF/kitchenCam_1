import { useEffect, useRef, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { View, type TextInput } from 'react-native';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useConnectivity } from '@/hooks/use-connectivity';
import { selectionIssue, type ManualScan } from './scan-domain';
import type { ScanSession } from './scan-provider';
import { IngredientRow } from './ingredient-row';
import {
  IngredientSummary,
  LoadedScan,
  ScanAccountGate,
  scanStyles,
  useRouteActive,
} from './scan-shared';
import type { ScanEditor } from './scan-editor';

export function ConflictPanel({ editor, online }: { editor: ScanEditor; online: boolean }) {
  const isActive = useRouteActive();
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  async function copy(recoveryIndex?: number) {
    const result = await editor.copy(online, recoveryIndex);
    if (result && isActive()) router.replace(`/scans/${result.id}`);
  }
  return (
    <View style={scanStyles.section}>
      {state.copyUncertain ? (
        <>
          <Text accessibilityRole="alert">
            The separate list is not yet verified. Retry saving it to check the same attempt safely.
          </Text>
          <Button
            label="Retry separate save"
            disabled={!online || state.copying}
            onPress={() => {
              void copy();
            }}
          />
        </>
      ) : null}
      {state.status === 'conflict' ? (
        <>
          <Text variant="subheading" accessibilityRole="header">
            Keep both lists safe
          </Text>
          <Text>
            Your local list is below. You can save it separately, or use the latest saved list and
            keep a recovery copy here.
          </Text>
          {state.latest ? (
            <>
              <Text variant="subheading">Latest saved ingredients</Text>
              <IngredientSummary rows={state.latest.ingredients} />
              {!state.latest.ingredients.length ? (
                <Text>The latest saved list is empty.</Text>
              ) : null}
              <Button
                label="Use latest saved list"
                disabled={state.copying || state.copyUncertain}
                variant="secondary"
                onPress={() => editor.useLatest()}
              />
            </>
          ) : (
            <Button
              label="Load latest saved list"
              disabled={!online || state.copying}
              onPress={() => {
                void editor.refresh();
              }}
            />
          )}
          <Button
            label={state.copying ? 'Saving separate list…' : 'Save my list separately'}
            disabled={!online || state.copying || state.copyUncertain}
            onPress={() => {
              void copy();
            }}
          />
        </>
      ) : null}
      {state.recovery.map((rows, index) => (
        <View key={index} style={scanStyles.section}>
          <Text variant="subheading" accessibilityRole="header">
            Your recoverable edits
          </Text>
          <Text>
            These edits are kept here for this session. Save a separate list to keep them after
            restarting.
          </Text>
          <IngredientSummary rows={rows} />
          <Button
            label={state.copying ? 'Saving separate list…' : 'Save recovered edits separately'}
            disabled={!online || state.copying || state.copyUncertain}
            variant="secondary"
            accessibilityLabel={`Save recovered edits ${index + 1} separately`}
            onPress={() => {
              void copy(index);
            }}
          />
        </View>
      ))}
    </View>
  );
}
export function IngredientEditor({ scan, session }: { scan: ManualScan; session: ScanSession }) {
  const isActive = useRouteActive();
  const editor = session.editor(scan);
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  const input = useRef<TextInput>(null);
  const online = useConnectivity() !== 'offline';
  useEffect(() => {
    editor.receive(scan);
  }, [editor, scan]);
  const selected = state.rows.filter((row) => row.selected).length;
  const issue = selectionIssue(state.rows);
  const hasInput = Boolean(state.input || state.editingId);
  const dirty = state.status === 'editing';
  const saved = state.status === 'saved' && !hasInput;
  const statusText =
    state.status === 'saving'
      ? 'Saving…'
      : state.status === 'uncertain'
        ? 'Save not yet verified. Retry to check safely.'
        : state.status === 'conflict'
          ? 'Changes need your review'
          : dirty || hasInput
            ? 'Unsaved changes'
            : 'Saved';
  async function save() {
    const operation = editor.pendingOperation ?? 'ingredients';
    const result = await editor.submit(operation, online);
    if (result) {
      session.query.setQueryData(['scan', session.ownerId, result.id], result);
      if (operation === 'confirm' && isActive()) router.replace(`/scans/${result.id}/ready`);
    }
  }
  function apply() {
    if (editor.applyInput()) input.current?.focus();
  }
  return (
    <Screen>
      <View style={scanStyles.section}>
        <Text variant="title" accessibilityRole="header">
          Your ingredients
        </Text>
        <Text>
          Choose what you want to use. You can rename, remove, and reorder your ingredients.
        </Text>
        <Text accessibilityLiveRegion="polite" tone="textSecondary">
          {statusText}
        </Text>
        {!online ? (
          <Text>Keep editing here. Saving and confirmation need a connection.</Text>
        ) : null}
        {state.base.state === 'confirmed' ? (
          <Text>
            Your last confirmed list stays available until you save changes. Saving will require a
            new confirmation.
          </Text>
        ) : null}
        {state.error ? (
          <Text accessibilityRole="alert" tone="danger">
            {state.error}
          </Text>
        ) : null}
      </View>
      <ConflictPanel editor={editor} online={online} />
      <View style={scanStyles.section}>
        <TextField
          label={state.editingId ? 'Ingredient name' : 'Add an ingredient'}
          value={state.input}
          inputRef={input}
          onChangeText={(value) => editor.input(value)}
          error={state.fieldError ?? undefined}
          placeholder="For example, tomato"
          editable={!editor.locked}
          returnKeyType="done"
          onSubmitEditing={apply}
          submitBehavior="submit"
          autoCorrect
          autoCapitalize="sentences"
        />
        <Button
          label={state.editingId ? 'Update ingredient' : 'Add ingredient'}
          disabled={editor.locked}
          onPress={apply}
        />
        {state.editingId ? (
          <Button
            label="Cancel rename"
            variant="secondary"
            disabled={editor.locked}
            onPress={() => {
              editor.cancelRename();
              input.current?.focus();
            }}
          />
        ) : null}
        <Text variant="supporting" tone="textSecondary">
          Up to 50 ingredients, 120 characters per name. Similar names stay separate.
        </Text>
      </View>
      {!state.rows.length ? (
        <EmptyState
          title="Start with what you have"
          message="Add your first ingredient above. Nothing is selected yet."
        />
      ) : (
        <View style={scanStyles.section}>
          <Text variant="subheading" accessibilityLiveRegion="polite">
            {selected} of {state.rows.length} selected
          </Text>
          {state.rows.map((row, index) => (
            <IngredientRow
              key={row.id}
              row={row}
              index={index}
              count={state.rows.length}
              disabled={editor.locked}
              canEdit={!hasInput}
              onChange={(operation) => {
                editor.change(row.id, operation);
                if (operation === 'remove') input.current?.focus();
              }}
              onEdit={() => {
                editor.edit(row.id);
                input.current?.focus();
              }}
            />
          ))}
        </View>
      )}
      <View style={scanStyles.section}>
        {issue ? <Text>{issue}</Text> : null}
        <Button
          label={
            state.status === 'saving'
              ? 'Saving…'
              : state.status === 'uncertain'
                ? editor.pendingOperation === 'confirm'
                  ? 'Retry confirmation'
                  : 'Retry save'
                : 'Save changes'
          }
          accessibilityState={{ busy: state.status === 'saving' }}
          disabled={
            !online || hasInput || state.status === 'saving' || state.status === 'conflict' || saved
          }
          onPress={() => {
            void save();
          }}
        />
        <Button
          label={
            state.base.state === 'confirmed' && saved ? 'View confirmed list' : 'Review selection'
          }
          variant="secondary"
          disabled={!online || !saved || !!issue}
          onPress={() =>
            router.push(
              state.base.state === 'confirmed'
                ? `/scans/${scan.id}/ready`
                : `/scans/${scan.id}/confirm`,
            )
          }
        />
        <Text variant="supporting" tone="textSecondary">
          Save changes before leaving. Unsaved edits stay in this session, but won’t survive an app
          restart.
        </Text>
        <Button
          label="Back to Ingredients"
          variant="secondary"
          onPress={() => router.replace('/scans')}
        />
      </View>
    </Screen>
  );
}
export function ScanEditorScreen({ id }: { id: string }) {
  return (
    <ScanAccountGate>
      {(session) => (
        <LoadedScan id={id} session={session}>
          {(scan) => <IngredientEditor scan={scan} session={session} />}
        </LoadedScan>
      )}
    </ScanAccountGate>
  );
}
