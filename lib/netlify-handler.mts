import type { Context } from '@netlify/functions';
import securityHeaders from './security-headers.json' with { type: 'json' };

type NodeRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
};
type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string | Uint8Array): void;
};

// Keep the shared endpoint logic usable by both Netlify and the local server.
export async function invoke(
  handler: (req: NodeRequest, res: NodeResponse) => unknown,
  request: Request,
  context: Context,
): Promise<Response> {
  const headers = new Headers(securityHeaders);
  let body: string | Uint8Array | undefined;
  const response: NodeResponse = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name, value); },
    end(value) { body = value; },
  };
  await handler({
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    socket: { remoteAddress: context.ip },
  }, response);
  return new Response(request.method === 'HEAD' ? null : body as BodyInit | undefined, {
    status: response.statusCode,
    headers,
  });
}
