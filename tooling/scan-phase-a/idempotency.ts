// Pure decision specification; no database, cache, HTTP endpoint, or credential access.
type Operation = Readonly<{
  authenticatedOwner: string;
  operation: string;
  key: string;
  payloadDigest: string;
}>;

export function mutationDecision(
  input: Readonly<{
    accountActive: boolean;
    resourceOwner: string;
    requested: Operation;
    recorded: Operation | null;
    expectedVersion: number;
    currentVersion: number;
  }>,
): 'apply' | 'reuse-operation' {
  if (!input.accountActive) throw new Error('ACCOUNT_NOT_ACTIVE');
  if (input.resourceOwner !== input.requested.authenticatedOwner) throw new Error('NOT_FOUND');
  const record = input.recorded;
  if (
    record &&
    record.authenticatedOwner === input.requested.authenticatedOwner &&
    record.operation === input.requested.operation &&
    record.key === input.requested.key
  ) {
    if (record.payloadDigest !== input.requested.payloadDigest)
      throw new Error('IDEMPOTENCY_CONFLICT');
    return 'reuse-operation';
  }
  if (input.expectedVersion !== input.currentVersion) throw new Error('VERSION_CONFLICT');
  return 'apply';
}
