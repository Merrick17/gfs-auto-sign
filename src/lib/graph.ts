import { requireEnv } from "./env";

const BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(public status: number, public retryAfterMs: number | null, message: string) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(
    `https://login.microsoftonline.com/${requireEnv("AZURE_TENANT_ID")}/oauth2/v2.0/token`,
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: requireEnv("AZURE_CLIENT_ID"),
        client_secret: requireEnv("AZURE_CLIENT_SECRET"),
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!res.ok) throw new GraphError(res.status, null, `token request failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export async function graph<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean; bytes?: Uint8Array } = {},
): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : BASE + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await token()}`,
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

export const mailboxPath = () => `/users/${encodeURIComponent(requireEnv("MAILBOX_ID"))}`;
