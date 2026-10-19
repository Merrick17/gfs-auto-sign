import { accessToken } from "./graph-token";

const BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(public status: number, public retryAfterMs: number | null, message: string) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

// Defense in depth: the Entra app may hold Mail.Send consent, and Microsoft puts every consented scope into the
// token. This client therefore refuses any endpoint that would send or forward mail.
const SEND_PATH = /\/(send|sendMail|forward|createForward)(\/|$)/i;
export class SendBlocked extends Error {}

export async function graph<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean; bytes?: Uint8Array } = {},
): Promise<T> {
  if (SEND_PATH.test(path.split("?")[0])) throw new SendBlocked(`Blocked: this application never sends mail (${path.split("?")[0]})`);
  const res = await fetch(path.startsWith("http") ? path : BASE + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    body: init.bytes ? new Uint8Array(init.bytes) : init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    // Body may contain mail content; only the status and error code are kept.
    const code = await res.json().then((j) => j?.error?.code, () => undefined);
    throw new GraphError(res.status, ra > 0 ? ra * 1000 : null, `Graph ${res.status} ${code ?? ""} ${path.split("?")[0]}`);
  }
  if (init.raw) return (await res.arrayBuffer()) as T;
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Delegated access: the signed-in owner's own mailbox.
export const mailboxPath = () => "/me";
