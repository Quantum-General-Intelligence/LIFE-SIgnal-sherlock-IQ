/**
 * QGI-DEMO — client for QGI Life-Signals-IQ.
 *
 * Wraps the FastAPI endpoints exposed by `sherlock_project/web/app.py`:
 *   GET  /api/meta
 *   GET  /api/sites
 *   POST /api/search
 *   GET  /api/search/stream  (Server-Sent Events)
 *
 * Env wiring (must exist on the qwork side):
 *   VITE_LSIQ_URL          e.g. http://127.0.0.1:8765
 *   VITE_LSIQ_TOKEN        optional bearer token
 *   VITE_QGI_DEMO_SOCIAL_VERIFY  feature flag for the tab
 */

// ---------------------------------------------------------------------------
// Types mirroring the LSIQ wire format. Keep field names identical to the
// Python side so a future codegen step is trivial.
// ---------------------------------------------------------------------------

export type LSIQStatusKey =
  | "CLAIMED"
  | "AVAILABLE"
  | "UNKNOWN"
  | "ILLEGAL"
  | "WAF";

export interface LSIQMeta {
  name: string;
  long_name: string;
  version: string;
  upstream: string;
  site_count: number;
  auth_required: boolean;
  cors_configured: boolean;
}

export interface LSIQSite {
  name: string;
  url_main: string;
  is_nsfw: boolean;
}

export interface LSIQResult {
  site: string;
  url: string;
  status: string;
  status_key: LSIQStatusKey;
  context?: string | null;
  query_time?: number | null;
}

export interface LSIQSearchResponse {
  username: string;
  total_probed: number;
  found: number;
  results: LSIQResult[];
  error?: string | null;
}

// ---------------------------------------------------------------------------
// QSS (phase 2) — mirrors sherlock_project/web/qss/base.py 1:1
// ---------------------------------------------------------------------------

export interface SocialHandle {
  platform: string;
  username: string;
  url?: string;
}

export interface DiscoveryHit {
  site: string;
  url: string;
  status_key: string;
  context?: string | null;
}

export interface LoanFacts {
  fico?: number;
  dti?: number;
  ltv?: number;
  aus_verdict?: "APPROVE" | "REFER" | "REFER_WITH_CAUTION" | "DENY";
  self_employed?: boolean;
  declared_business_type?: string;
}

export interface QSSRequest {
  loan_id: string;
  declared_handles?: SocialHandle[];
  discovery?: DiscoveryHit[];
  loan_facts?: LoanFacts;
}

export type SignalOutcome =
  | "confirmed"
  | "partial"
  | "absent"
  | "conflict"
  | "unknown";

export interface SignalEvidence {
  kind: "profile" | "post" | "footprint" | "metadata" | "stub";
  description: string;
  source_url?: string | null;
}

export interface QSSSignal {
  name: string;
  outcome: SignalOutcome;
  confidence: number;
  rationale: string;
  evidence: SignalEvidence[];
}

export interface QSSResponse {
  provider: string;
  provider_version: string;
  loan_id: string;
  signals: QSSSignal[];
  summary: string;
  warnings: string[];
}

export type SecondLookOutcome =
  | "approve_lift"
  | "conditional_lift"
  | "no_change";

export interface SecondLookFeature {
  name: string;
  weight: number;
  awarded: number;
  reason: string;
}

export interface SecondLookResponse {
  loan_id: string;
  outcome: SecondLookOutcome;
  score: number;
  max_score: number;
  features: SecondLookFeature[];
  rationale: string;
  disclaimer: string;
}

export interface SecondLookRequest {
  loan_id: string;
  loan_facts: LoanFacts;
  qss_response: QSSResponse;
}

export interface QSSMeta {
  provider: string | null;
  provider_version?: string;
  error?: string;
}

export type LSIQStreamEvent =
  | { type: "meta"; username: string; total: number; version: string }
  | { type: "start"; username: string }
  | ({ type: "result" } & LSIQResult)
  | { type: "finish"; count: number }
  | { type: "error"; message: string }
  | { type: "done" };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RAW_BASE = (import.meta.env.VITE_LSIQ_URL as string | undefined) ?? "";
const TOKEN = (import.meta.env.VITE_LSIQ_TOKEN as string | undefined) ?? "";

function baseUrl(): string {
  if (!RAW_BASE) {
    throw new Error(
      "[lsiqClient] VITE_LSIQ_URL is not set. Copy QGI-demo/.env.qgi.example into .env.local."
    );
  }
  return RAW_BASE.replace(/\/+$/, "");
}

function authHeaders(): HeadersInit {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

export function isSocialVerifyEnabled(): boolean {
  return (
    (import.meta.env.VITE_QGI_DEMO_SOCIAL_VERIFY as string | undefined) === "true"
  );
}

export function clientLabel(): string {
  return (
    (import.meta.env.VITE_QGI_DEMO_CLIENT_LABEL as string | undefined) ??
    "QGI-DEMO"
  );
}

// ---------------------------------------------------------------------------
// REST calls
// ---------------------------------------------------------------------------

export async function lsiqMeta(signal?: AbortSignal): Promise<LSIQMeta> {
  const res = await fetch(`${baseUrl()}/api/meta`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`LSIQ meta failed: ${res.status}`);
  return res.json();
}

export async function lsiqSites(
  opts: { includeNsfw?: boolean; signal?: AbortSignal } = {}
): Promise<LSIQSite[]> {
  const url = new URL(`${baseUrl()}/api/sites`);
  if (opts.includeNsfw) url.searchParams.set("include_nsfw", "true");
  const res = await fetch(url.toString(), {
    headers: authHeaders(),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`LSIQ sites failed: ${res.status}`);
  const json = (await res.json()) as { count: number; sites: LSIQSite[] };
  return json.sites;
}

export async function lsiqQssMeta(signal?: AbortSignal): Promise<QSSMeta> {
  const res = await fetch(`${baseUrl()}/api/qss/meta`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(`LSIQ qss meta failed: ${res.status}`);
  return res.json();
}

export async function lsiqQssSignals(
  req: QSSRequest,
  signal?: AbortSignal
): Promise<QSSResponse> {
  const res = await fetch(`${baseUrl()}/api/qss/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LSIQ qss/signals failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function lsiqSecondLook(
  req: SecondLookRequest,
  signal?: AbortSignal
): Promise<SecondLookResponse> {
  const res = await fetch(`${baseUrl()}/api/qss/second-look`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LSIQ qss/second-look failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function lsiqSearch(
  username: string,
  opts: {
    sites?: string[];
    timeout?: number;
    includeNsfw?: boolean;
    onlyFound?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<LSIQSearchResponse> {
  const res = await fetch(`${baseUrl()}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal: opts.signal,
    body: JSON.stringify({
      username,
      sites: opts.sites,
      timeout: opts.timeout ?? 30,
      include_nsfw: opts.includeNsfw ?? false,
      only_found: opts.onlyFound ?? true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LSIQ search failed: ${res.status} ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

/**
 * Open a Life-Signals-IQ SSE stream.
 *
 * NOTE: `EventSource` does not support custom headers, so bearer auth must
 * come through the query string. LSIQ accepts `?token=…` as an alternative
 * when `LSIQ_ALLOW_TOKEN_QUERY=1` is set — but for dev we keep auth disabled
 * on the SSE endpoint. If auth is enabled, fall back to `fetch`-based SSE.
 *
 * Returns a disposer that closes the stream.
 */
export function openLSIQStream(
  username: string,
  opts: {
    sites?: string[];
    timeout?: number;
    includeNsfw?: boolean;
    onEvent: (ev: LSIQStreamEvent) => void;
    onError?: (err: unknown) => void;
  }
): () => void {
  if (TOKEN) {
    return openLSIQStreamFetch(username, opts);
  }
  const url = new URL(`${baseUrl()}/api/search/stream`);
  url.searchParams.set("username", username);
  if (opts.sites?.length) url.searchParams.set("sites", opts.sites.join(","));
  if (opts.timeout) url.searchParams.set("timeout", String(opts.timeout));
  if (opts.includeNsfw) url.searchParams.set("include_nsfw", "true");

  const es = new EventSource(url.toString());
  const handle = (evt: MessageEvent<string>, type: LSIQStreamEvent["type"]) => {
    try {
      const data = evt.data ? JSON.parse(evt.data) : {};
      opts.onEvent({ type, ...data } as LSIQStreamEvent);
    } catch (err) {
      opts.onError?.(err);
    }
  };
  es.addEventListener("meta", (e) => handle(e as MessageEvent<string>, "meta"));
  es.addEventListener("start", (e) => handle(e as MessageEvent<string>, "start"));
  es.addEventListener("result", (e) => handle(e as MessageEvent<string>, "result"));
  es.addEventListener("finish", (e) => handle(e as MessageEvent<string>, "finish"));
  es.addEventListener("error", (e) => handle(e as MessageEvent<string>, "error"));
  es.addEventListener("done", () => {
    opts.onEvent({ type: "done" });
    es.close();
  });
  es.onerror = (err) => {
    opts.onError?.(err);
    es.close();
  };
  return () => es.close();
}

/**
 * Fetch-based SSE fallback that CAN carry Authorization headers.
 * Used whenever VITE_LSIQ_TOKEN is set.
 */
function openLSIQStreamFetch(
  username: string,
  opts: {
    sites?: string[];
    timeout?: number;
    includeNsfw?: boolean;
    onEvent: (ev: LSIQStreamEvent) => void;
    onError?: (err: unknown) => void;
  }
): () => void {
  const ctrl = new AbortController();
  const url = new URL(`${baseUrl()}/api/search/stream`);
  url.searchParams.set("username", username);
  if (opts.sites?.length) url.searchParams.set("sites", opts.sites.join(","));
  if (opts.timeout) url.searchParams.set("timeout", String(opts.timeout));
  if (opts.includeNsfw) url.searchParams.set("include_nsfw", "true");

  (async () => {
    try {
      const res = await fetch(url.toString(), {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`LSIQ stream failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const ev = parseSseChunk(chunk);
          if (ev) opts.onEvent(ev);
        }
      }
      opts.onEvent({ type: "done" });
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        opts.onError?.(err);
      }
    }
  })();

  return () => ctrl.abort();
}

function parseSseChunk(chunk: string): LSIQStreamEvent | null {
  let eventName: LSIQStreamEvent["type"] | null = null;
  const dataLines: string[] = [];
  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() as LSIQStreamEvent["type"];
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!eventName) return null;
  const dataStr = dataLines.join("\n");
  try {
    const data = dataStr ? JSON.parse(dataStr) : {};
    return { type: eventName, ...data } as LSIQStreamEvent;
  } catch {
    return null;
  }
}
