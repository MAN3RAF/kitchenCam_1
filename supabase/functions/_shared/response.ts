import { FunctionError } from './errors.ts';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function requestId(request: Request): string {
  const candidate = request.headers.get('X-Client-Request-Id');
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

export function json(data: unknown, requestIdentifier: string, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: requestIdentifier }), {
    status,
    headers: { ...headers, 'X-Request-Id': requestIdentifier },
  });
}

export function failure(error: FunctionError, requestIdentifier: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        requestId: requestIdentifier,
        retryable: error.retryable,
        fieldIssues: [],
      },
    }),
    {
      status: error.status,
      headers: { ...headers, 'X-Request-Id': requestIdentifier },
    },
  );
}
