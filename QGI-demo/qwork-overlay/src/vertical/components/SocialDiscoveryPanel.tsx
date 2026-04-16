/**
 * QGI-DEMO — SocialDiscoveryPanel
 *
 * Phase-1 UI for the Social Verification tab. Streams results from
 * QGI Life-Signals-IQ via SSE and tiles them as CLAIMED / AVAILABLE / other.
 *
 * Intentionally additive-only: we never flag or score here. The scorecard
 * + QSS interpretation is phase 2 (`AgentInsightPanel` with `socialsym`
 * and `secondlooksym`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@quantum-general-intelligence/core/ui";
import { Loader2, Play, Square, ExternalLink, RefreshCw } from "lucide-react";
import {
  openLSIQStream,
  lsiqMeta,
  type LSIQMeta,
  type LSIQResult,
  type LSIQStreamEvent,
} from "@/vertical/lib/lsiqClient";

export interface SocialDiscoveryPanelProps {
  /** Default username to pre-fill (e.g. borrower's declared primary handle). */
  defaultUsername?: string;
  /** Optional subset of sites to probe. Omit for all SFW sites. */
  sites?: string[];
  /** Called once per SSE run when the stream closes. Always fires, even on abort. */
  onRunComplete?: (payload: {
    username: string;
    results: LSIQResult[];
    found: number;
    total_probed: number;
    started_at: string;
    finished_at: string;
    error?: string;
  }) => void;
  /**
   * Phase 3 — if true, all inputs/buttons are disabled and a short reason
   * shown. Used to gate on consent without unmounting the panel.
   */
  disabled?: boolean;
  /** Optional hint rendered when `disabled` is true. */
  disabledReason?: string;
}

type RunState = "idle" | "running" | "done" | "error";

const STATUS_VARIANT: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  CLAIMED: { label: "Claimed", variant: "default" },
  AVAILABLE: { label: "Available", variant: "secondary" },
  WAF: { label: "Protected (WAF)", variant: "outline" },
  UNKNOWN: { label: "Unknown", variant: "outline" },
  ILLEGAL: { label: "Invalid", variant: "outline" },
};

export function SocialDiscoveryPanel({
  defaultUsername = "",
  sites,
  onRunComplete,
  disabled = false,
  disabledReason,
}: SocialDiscoveryPanelProps) {
  const [username, setUsername] = useState(defaultUsername);
  const [state, setState] = useState<RunState>("idle");
  const [meta, setMeta] = useState<LSIQMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [streamMeta, setStreamMeta] = useState<{
    total: number;
    started_at: string;
  } | null>(null);
  const [results, setResults] = useState<LSIQResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const disposerRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const completionFiredRef = useRef(false);

  useEffect(() => {
    setUsername(defaultUsername);
  }, [defaultUsername]);

  useEffect(() => {
    let cancelled = false;
    lsiqMeta()
      .then((m) => !cancelled && setMeta(m))
      .catch((err) => !cancelled && setMetaError(String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      disposerRef.current?.();
    },
    []
  );

  const claimed = useMemo(
    () => results.filter((r) => r.status_key === "CLAIMED"),
    [results]
  );
  const otherVisible = useMemo(
    () =>
      results.filter(
        (r) => r.status_key !== "CLAIMED" && r.status_key !== "AVAILABLE"
      ),
    [results]
  );

  const stop = useCallback(() => {
    disposerRef.current?.();
    disposerRef.current = null;
  }, []);

  const fireComplete = useCallback(
    (finalError?: string) => {
      if (completionFiredRef.current) return;
      completionFiredRef.current = true;
      onRunComplete?.({
        username: username.trim(),
        results,
        found: results.filter((r) => r.status_key === "CLAIMED").length,
        total_probed: streamMeta?.total ?? 0,
        started_at: startedAtRef.current ?? new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: finalError,
      });
    },
    [onRunComplete, results, streamMeta, username]
  );

  const start = useCallback(() => {
    const u = username.trim();
    if (!u) return;
    stop();
    setResults([]);
    setError(null);
    setStreamMeta(null);
    setState("running");
    startedAtRef.current = new Date().toISOString();
    completionFiredRef.current = false;

    disposerRef.current = openLSIQStream(u, {
      sites,
      timeout: 30,
      onEvent: (ev: LSIQStreamEvent) => {
        switch (ev.type) {
          case "meta":
            setStreamMeta({
              total: ev.total,
              started_at: startedAtRef.current!,
            });
            break;
          case "result":
            setResults((prev) => [...prev, ev]);
            break;
          case "error":
            setError(ev.message);
            break;
          case "done":
            setState((s) => (s === "error" ? "error" : "done"));
            fireComplete();
            break;
        }
      },
      onError: (err) => {
        setError(String(err));
        setState("error");
        fireComplete(String(err));
      },
    });
  }, [username, sites, stop, fireComplete]);

  // Re-fire completion if results change after 'done' (late SSE events).
  useEffect(() => {
    if (state === "done" && !completionFiredRef.current) {
      fireComplete();
    }
  }, [state, fireComplete]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Discovery
              <Badge variant="outline" className="font-mono text-xs">
                QGI Life-Signals-IQ
                {meta?.version ? ` v${meta.version}` : ""}
              </Badge>
            </CardTitle>
            <CardDescription>
              Probe declared handles across public social networks. Results
              are evidence, never scores — the scorecard agent reads them in
              phase 2.
            </CardDescription>
          </div>
          {meta?.auth_required ? (
            <Badge variant="secondary">authenticated</Badge>
          ) : (
            <Badge variant="outline">no-auth (dev)</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {metaError && (
          <div className="text-sm text-destructive">
            Cannot reach Life-Signals-IQ. Is it running?{" "}
            <code className="text-xs">{metaError}</code>
          </div>
        )}

        {disabled && disabledReason && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {disabledReason}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="grow min-w-[220px]">
            <Label htmlFor="qgi-demo-username">Declared handle</Label>
            <Input
              id="qgi-demo-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. alice-bakery"
              disabled={disabled || state === "running"}
              spellCheck={false}
            />
          </div>
          {state === "running" ? (
            <Button variant="secondary" onClick={stop} className="gap-1">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={start}
              disabled={disabled || !username.trim() || !meta}
              className="gap-1"
            >
              {state === "done" || state === "error" ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {state === "done" || state === "error" ? "Re-run" : "Run discovery"}
            </Button>
          )}
        </div>

        <StatusLine
          state={state}
          streamMeta={streamMeta}
          claimedCount={claimed.length}
          error={error}
        />

        {claimed.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-sm font-medium">
              Claimed profiles ({claimed.length})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {claimed.map((r) => (
                <ResultTile key={`${r.site}-${r.url}`} result={r} />
              ))}
            </div>
          </section>
        )}

        {otherVisible.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Other signals ({otherVisible.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {otherVisible.map((r) => (
                <Badge
                  key={`${r.site}-${r.status_key}`}
                  variant={STATUS_VARIANT[r.status_key]?.variant ?? "outline"}
                  className="font-normal"
                >
                  {r.site}:{" "}
                  {STATUS_VARIANT[r.status_key]?.label ?? r.status_key}
                </Badge>
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function StatusLine({
  state,
  streamMeta,
  claimedCount,
  error,
}: {
  state: RunState;
  streamMeta: { total: number; started_at: string } | null;
  claimedCount: number;
  error: string | null;
}) {
  if (state === "idle") {
    return (
      <p className="text-xs text-muted-foreground">
        Enter a handle and click <em>Run discovery</em>. Officer-driven,
        consent required before phase 3 gates it.
      </p>
    );
  }
  if (state === "running") {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Probing {streamMeta?.total ?? "…"} sites · {claimedCount} claimed so far
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="text-xs text-destructive">
        Stream error: {error ?? "unknown"}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Finished · probed {streamMeta?.total ?? 0} sites · {claimedCount} claimed
    </p>
  );
}

function ResultTile({ result }: { result: LSIQResult }) {
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm transition hover:border-primary hover:bg-accent/30"
    >
      <span className="font-medium truncate" title={result.site}>
        {result.site}
      </span>
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
    </a>
  );
}
