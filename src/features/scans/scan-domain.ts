import { z } from 'zod';

export const scanIdSchema = z.uuid();
export function nameIssue(value: string): string | undefined {
  if (!value.trim()) return 'Enter an ingredient name.';
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code === 0 || (code >= 0xd800 && code <= 0xdfff);
    })
  )
    return 'Remove unsupported characters from this name.';
  if ([...value.trim()].length > 120) return 'Use 120 characters or fewer.';
  return undefined;
}

export const ingredientSchema = z.strictObject({
  id: z.uuid(),
  displayName: z.string().refine((value) => !nameIssue(value)),
  normalizedName: z.null(),
  canonicalId: z.null(),
  selected: z.boolean(),
  quantity: z.union([
    z.null(),
    z.strictObject({
      value: z
        .string()
        .regex(/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?$/)
        .refine((value) => Number(value) > 0),
      unit: z.enum(['g', 'ml', 'each', 'clove', 'slice', 'can', 'package', 'bunch']),
      estimated: z.boolean(),
    }),
  ]),
  provenance: z.literal('manual'),
  detectionId: z.null(),
});
export const ingredientsSchema = z
  .array(ingredientSchema)
  .max(50)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);
export type Ingredient = z.infer<typeof ingredientSchema>;
export function manualIngredient(id: string, name: string): Ingredient {
  return ingredientSchema.parse({
    id,
    displayName: name.trim(),
    normalizedName: null,
    canonicalId: null,
    selected: true,
    quantity: null,
    provenance: 'manual',
    detectionId: null,
  });
}
export function sameIngredients(a: Ingredient[], b: Ingredient[]) {
  return (
    a.length === b.length &&
    a.every((row, i) => {
      const other = b[i];
      return (
        other?.id === row.id &&
        other.displayName === row.displayName &&
        other.selected === row.selected &&
        other.quantity?.value === row.quantity?.value &&
        other.quantity?.unit === row.quantity?.unit &&
        other.quantity?.estimated === row.quantity?.estimated
      );
    })
  );
}
export function selectionIssue(rows: Ingredient[]): string | undefined {
  const selected = rows.filter((row) => row.selected);
  if (!selected.length) return 'Select at least one ingredient to continue.';
  const names = selected.map((row) => row.displayName.trim().toLowerCase());
  if (new Set(names).size !== names.length)
    return 'Some selected names match. Rename, remove, or deselect a matching ingredient.';
  return undefined;
}

// Only the manual subset is supported by this feature. SQL rows never escape the adapter.
export const manualScanSchema = z
  .strictObject({
    id: z.uuid(),
    ownerId: z.uuid(),
    version: z.number().int().positive().safe(),
    draftRevision: z.number().int().positive(),
    state: z.enum(['needs_confirmation', 'confirmed']),
    ingredients: ingredientsSchema,
    confirmedIngredients: ingredientsSchema.nullable(),
    confirmedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .refine((scan) =>
    scan.state === 'confirmed'
      ? !!scan.confirmedAt &&
        !!scan.confirmedIngredients?.length &&
        scan.confirmedIngredients.every((row) => row.selected) &&
        sameIngredients(
          scan.confirmedIngredients,
          scan.ingredients.filter((row) => row.selected),
        )
      : scan.confirmedAt === null && scan.confirmedIngredients === null,
  );
export type ManualScan = z.infer<typeof manualScanSchema>;

const messages = {
  TIMEOUT:
    'KitchenCam took too long to respond. Your input is still here. Retry to check whether it was saved.',
  UNAVAILABLE:
    'We could not reach KitchenCam. Your input is still here. Check your connection and try again.',
  NOT_FOUND: 'This ingredient list is unavailable for your current account.',
  AUTH_REQUIRED: 'Restore your session to access your ingredient lists.',
  ACCOUNT_NOT_ACTIVE: 'Your account cannot access ingredient lists right now.',
  VERSION_CONFLICT:
    'This list changed elsewhere. Your edits are still here. Review the latest saved list before continuing.',
  IDEMPOTENCY_CONFLICT:
    'This attempt could not be reconciled. Your edits are still here. Review the latest saved list.',
  VALIDATION: 'Check ingredient names and selection, then try again.',
  DUPLICATE_INGREDIENTS:
    'Some selected names match. Rename, remove, or deselect a matching ingredient.',
  OFFLINE: 'You can edit here while offline. Connect to save or confirm.',
  CANCELLED: 'This ingredient list was cancelled. It can’t be edited or confirmed.',
  SCAN_EXPIRED: 'This ingredient list expired. Start a new list to continue.',
} as const;
export type ScanErrorCode = keyof typeof messages;
export class ScanError extends Error {
  constructor(readonly code: ScanErrorCode) {
    super(messages[code]);
  }
}
export function isUncertainScanError(error: ScanError) {
  return error.code === 'UNAVAILABLE' || error.code === 'TIMEOUT';
}
export function isTerminalScanError(error: ScanError) {
  return error.code === 'CANCELLED' || error.code === 'SCAN_EXPIRED';
}
export function scanError(error: unknown): ScanError {
  if (error instanceof ScanError) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  if (typeof message === 'string' && Object.hasOwn(messages, message))
    return new ScanError(message as ScanErrorCode);
  return new ScanError('UNAVAILABLE');
}
