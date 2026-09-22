import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database.generated';
import {
  ingredientsSchema,
  manualScanSchema,
  ScanError,
  scanError,
  scanIdSchema,
  type Ingredient,
  type ManualScan,
} from './scan-domain';

export type ScanCommand = {
  key: string;
  scan: ManualScan;
  operation: 'ingredients' | 'confirm';
  ingredients: Ingredient[];
};
export interface ScanService {
  list(offset?: number): Promise<ManualScan[]>;
  read(id: string): Promise<ManualScan>;
  create(key: string, ingredients: Ingredient[]): Promise<ManualScan>;
  mutate(command: ScanCommand): Promise<ManualScan>;
}
type ScanRow = Database['public']['Tables']['scans']['Row'];
const columns =
  'id,owner_id,source,state,version,draft_revision,image_revision,manual_fallback,sanitization_state,ingredients,confirmed_ingredients,confirmed_at,created_at';
const requestDeadlineMs = 20_000;
export function projectManualScan(value: unknown, ownerId: string): ManualScan {
  if (!value || typeof value !== 'object') throw new ScanError('UNAVAILABLE');
  const row = value as Partial<ScanRow>;
  if (row.owner_id !== ownerId) throw new ScanError('NOT_FOUND');
  if (
    row.source !== 'manual' ||
    row.image_revision !== 0 ||
    row.manual_fallback !== true ||
    row.sanitization_state !== 'not_started'
  )
    throw new ScanError('NOT_FOUND');
  if (row.state === 'cancelled') throw new ScanError('CANCELLED');
  if (row.state === 'expired') throw new ScanError('SCAN_EXPIRED');
  const parsed = manualScanSchema.safeParse({
    id: row.id,
    ownerId: row.owner_id,
    version: row.version,
    draftRevision: row.draft_revision,
    state: row.state,
    ingredients: row.ingredients,
    confirmedIngredients: row.confirmed_ingredients,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  });
  if (!parsed.success) throw new ScanError('UNAVAILABLE');
  return parsed.data;
}
export function createScanService(client: SupabaseClient<Database>, ownerId: string): ScanService {
  async function checked<T>(
    operation: (signal: AbortSignal) => PromiseLike<{ data: T; error: unknown }>,
  ) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ScanError('TIMEOUT'));
        controller.abort();
      }, requestDeadlineMs);
    });
    try {
      const { data, error } = await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        deadline,
      ]);
      if (error) throw error;
      return data;
    } catch (error) {
      throw scanError(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async list(offset = 0) {
      const rows = await checked((signal) =>
        client
          .from('scans')
          .select(columns)
          .eq('owner_id', ownerId)
          .eq('source', 'manual')
          .in('state', ['needs_confirmation', 'confirmed'])
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + 19)
          .retry(false)
          .abortSignal(signal),
      );
      return (rows ?? []).map((row) => projectManualScan(row, ownerId));
    },
    async read(id) {
      if (!scanIdSchema.safeParse(id).success) throw new ScanError('NOT_FOUND');
      const row = await checked((signal) =>
        client
          .from('scans')
          .select(columns)
          .eq('id', id)
          .eq('owner_id', ownerId)
          .retry(false)
          .abortSignal(signal)
          .maybeSingle(),
      );
      if (!row) throw new ScanError('NOT_FOUND');
      return projectManualScan(row, ownerId);
    },
    async create(key, ingredients) {
      if (!ingredientsSchema.safeParse(ingredients).success) throw new ScanError('VALIDATION');
      return projectManualScan(
        await checked((signal) =>
          client
            .rpc('create_scan', {
              p_key: key,
              p_source: 'manual',
              p_ingredients: ingredients,
            })
            .retry(false)
            .abortSignal(signal),
        ),
        ownerId,
      );
    },
    async mutate({ key, scan, operation, ingredients }) {
      const body: Json =
        operation === 'ingredients'
          ? {
              expectedVersion: scan.version,
              expectedDraftRevision: scan.draftRevision,
              ingredients,
            }
          : { expectedVersion: scan.version, draftRevision: scan.draftRevision };
      return projectManualScan(
        await checked((signal) =>
          client
            .rpc('mutate_scan', {
              p_scan: scan.id,
              p_key: key,
              p_operation: operation,
              p_body: body,
            })
            .retry(false)
            .abortSignal(signal),
        ),
        ownerId,
      );
    },
  };
}
