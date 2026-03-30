export interface EdgeErrorShape {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function jsonResponse(
  payload: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers,
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  options: { details?: unknown; headers?: HeadersInit } = {},
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(options.details === undefined ? {} : { details: options.details }),
      },
    } satisfies EdgeErrorShape,
    { status, headers: options.headers },
  );
}
