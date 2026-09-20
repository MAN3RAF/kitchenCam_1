type SafeLogEvent = Readonly<{
  event: string;
  requestId: string;
  status: 'completed' | 'failed' | 'pending';
  durationMs: number;
  safeCode?: string;
}>;

export function logSafeEvent(event: SafeLogEvent): void {
  console.info(JSON.stringify(event));
}
