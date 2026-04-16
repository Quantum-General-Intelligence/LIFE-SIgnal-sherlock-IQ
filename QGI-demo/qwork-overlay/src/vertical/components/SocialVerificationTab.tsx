/**
 * QGI-DEMO — SocialVerificationTab
 *
 * Tab content inside LoanDetail. Three stacked panels:
 *   1. SocialDiscoveryPanel          (phase 1 — SSE discovery)
 *   2. AgentInsightPanel: socialsym  (phase 2 — QSS scoring)
 *   3. AgentInsightPanel: secondlooksym (phase 2 — additive scorecard)
 *
 * Each run persists to public.social_verifications and emits a
 * loan_activity_log entry via the vertical's logActivity helper.
 *
 * Feature-gated with VITE_QGI_DEMO_SOCIAL_VERIFY.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@quantum-general-intelligence/core/ui";
import {
  Sparkles,
  ShieldCheck,
  History,
  Scale,
  Lock,
  FileSignature,
} from "lucide-react";
import {
  supabase,
  useToast,
  PermissionGate,
} from "@quantum-general-intelligence/core";
import { logActivity } from "@/vertical/lib/auditLog";
import { AgentInsightPanel } from "@/vertical/components/AgentInsightPanel";
import { SocialDiscoveryPanel } from "@/vertical/components/SocialDiscoveryPanel";
import { SocialConsentDialog } from "@/vertical/components/SocialConsentDialog";
import { clientLabel } from "@/vertical/lib/lsiqClient";
import type {
  LoanFacts,
  LSIQResult,
  QSSResponse,
  SocialHandle,
} from "@/vertical/lib/lsiqClient";
import {
  SOCIALSYM_ID,
  SECONDLOOKSYM_ID,
  previewSocialSignals,
  runSocialSignals,
  previewSecondLook,
  runSecondLook,
} from "@/vertical/lib/qgiAgents";
import {
  fetchActiveConsent,
  revokeConsent,
  type SocialConsent,
} from "@/vertical/lib/socialConsent";

export interface SocialVerificationTabProps {
  loanId: string;
  borrowerId?: string;
  defaultUsername?: string;
  /** Optional loan context used by the scorecard (FICO/DTI/LTV/verdict). */
  loanFacts?: LoanFacts;
}

interface StoredRun {
  id: string;
  created_at: string;
  declared_handles: Record<string, string>;
  discovery_json: {
    username: string;
    found: number;
    total_probed: number;
    results: LSIQResult[];
    started_at: string;
    finished_at: string;
  } | null;
  qss_provider?: string | null;
  qss_version?: string | null;
  qss_signals?: QSSResponse | null;
  second_look_json?: unknown | null;
}

export function SocialVerificationTab({
  loanId,
  borrowerId,
  defaultUsername,
  loanFacts,
}: SocialVerificationTabProps) {
  const { toast } = useToast();
  const [history, setHistory] = useState<StoredRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Latest discovery + QSS state drive the agent panel inputs.
  const [declaredHandles, setDeclaredHandles] = useState<SocialHandle[]>([]);
  const [discoveryResults, setDiscoveryResults] = useState<LSIQResult[]>([]);
  const [qss, setQss] = useState<QSSResponse | null>(null);

  // Phase 3 — consent gate
  const [consent, setConsent] = useState<SocialConsent | null>(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);

  const effectiveLoanFacts = useMemo<LoanFacts>(
    () => loanFacts ?? {},
    [loanFacts]
  );

  // -------------------------------------------------------------------------
  // Supabase — history + per-run upsert helpers
  // -------------------------------------------------------------------------

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from("social_verifications")
      .select(
        "id, created_at, declared_handles, discovery_json, qss_provider, qss_version, qss_signals, second_look_json"
      )
      .eq("loan_id", loanId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) {
      toast({
        title: "Could not load history",
        description: error.message,
        variant: "destructive",
      });
      setLoadingHistory(false);
      return;
    }
    setHistory((data ?? []) as StoredRun[]);
    setLoadingHistory(false);
  }, [loanId, toast]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Phase 3 — load any active consent on mount / loanId change.
  useEffect(() => {
    let cancelled = false;
    setConsentLoading(true);
    fetchActiveConsent(loanId)
      .then((row) => {
        if (!cancelled) setConsent(row);
      })
      .finally(() => {
        if (!cancelled) setConsentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loanId]);

  const hasConsent = !!consent;

  const handleRevoke = useCallback(async () => {
    if (!consent) return;
    try {
      await revokeConsent(loanId, consent.id);
      setConsent(null);
      toast({
        title: "Consent revoked",
        description:
          "Existing runs remain for the audit record. New runs are blocked until re-signed.",
      });
    } catch (err) {
      toast({
        title: "Could not revoke",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }, [consent, loanId, toast]);

  const latestRunId = history[0]?.id ?? null;

  const patchLatestRun = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!latestRunId) return;
      const { error } = await supabase
        .from("social_verifications")
        .update(patch)
        .eq("id", latestRunId);
      if (error) {
        toast({
          title: "Could not persist agent result",
          description: error.message,
          variant: "destructive",
        });
      }
    },
    [latestRunId, toast]
  );

  // -------------------------------------------------------------------------
  // Phase 1 — Discovery completion handler
  // -------------------------------------------------------------------------

  const handleDiscoveryComplete = async (run: {
    username: string;
    results: LSIQResult[];
    found: number;
    total_probed: number;
    started_at: string;
    finished_at: string;
    error?: string;
  }) => {
    if (!consent) {
      toast({
        title: "Consent required",
        description: "Record borrower consent before saving a verification run.",
        variant: "destructive",
      });
      setConsentDialogOpen(true);
      return;
    }

    setDeclaredHandles([{ platform: "primary", username: run.username }]);
    setDiscoveryResults(run.results);
    setQss(null);

    const { error } = await supabase.from("social_verifications").insert([
      {
        loan_id: loanId,
        borrower_id: borrowerId ?? null,
        declared_handles: { primary: run.username },
        discovery_json: {
          username: run.username,
          found: run.found,
          total_probed: run.total_probed,
          results: run.results,
          started_at: run.started_at,
          finished_at: run.finished_at,
        },
        consent_id: consent.id,
      },
    ]);

    if (error) {
      toast({
        title: "Saved locally, but not to Supabase",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    logActivity(loanId, "social_verification_run", {
      metadata: {
        username: run.username,
        found: run.found,
        total_probed: run.total_probed,
        provider: "qgi-life-signals-iq",
        phase: "discovery",
      },
    });

    toast({
      title: "Discovery saved",
      description: `${run.found} claimed profile(s) recorded for ${run.username}.`,
    });

    void loadHistory();
  };

  // -------------------------------------------------------------------------
  // Phase 2 — Agent run wrappers (persist + audit on success)
  // -------------------------------------------------------------------------

  const socialInput = useMemo(
    () => ({
      loanId,
      declaredHandles,
      discoveryResults,
      loanFacts: effectiveLoanFacts,
    }),
    [loanId, declaredHandles, discoveryResults, effectiveLoanFacts]
  );

  const handleRunSocial = useCallback(
    async (onProgress?: Parameters<typeof runSocialSignals>[1]) => {
      if (!consent) {
        setConsentDialogOpen(true);
        throw new Error(
          "Borrower consent required before running Quantum Social Signals."
        );
      }
      const result = await runSocialSignals(socialInput, onProgress);
      if (result.success && result.data) {
        const data = result.data as QSSResponse;
        setQss(data);
        await patchLatestRun({
          qss_provider: data.provider,
          qss_version: data.provider_version,
          qss_signals: data,
        });
        logActivity(loanId, "social_verification_qss_run", {
          metadata: {
            provider: data.provider,
            provider_version: data.provider_version,
            signal_count: data.signals.length,
          },
        });
      }
      return result;
    },
    [consent, socialInput, loanId, patchLatestRun]
  );

  const secondLookInput = useMemo(
    () => ({
      loanId,
      loanFacts: effectiveLoanFacts,
      qss: qss!,
    }),
    [loanId, effectiveLoanFacts, qss]
  );

  const handleRunSecondLook = useCallback(
    async (onProgress?: Parameters<typeof runSecondLook>[1]) => {
      if (!consent) {
        setConsentDialogOpen(true);
        throw new Error(
          "Borrower consent required before running the Second-Look scorecard."
        );
      }
      const result = await runSecondLook(secondLookInput, onProgress);
      if (result.success && result.data) {
        await patchLatestRun({ second_look_json: result.data });
        logActivity(loanId, "social_verification_second_look_run", {
          metadata: {
            outcome: (result.data as { outcome: string }).outcome,
            score: (result.data as { score: number }).score,
            max_score: (result.data as { max_score: number }).max_score,
          },
        });
      }
      return result;
    },
    [consent, secondLookInput, loanId, patchLatestRun]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const lastRun = history[0] ?? null;
  const label = useMemo(() => clientLabel(), []);
  const canRunSocial = discoveryResults.length > 0 || !!lastRun?.discovery_json;
  const canRunSecondLook = qss !== null;

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <CardTitle className="text-base">
                Social Verification ·{" "}
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary align-middle">
                  {label}
                </span>
              </CardTitle>
              <CardDescription>
                Verify declared borrower handles against public social
                networks, then let <code>socialsym</code> score the evidence
                and <code>secondlooksym</code> recommend an additive-only
                outcome. Officer-driven throughout.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <Stat
            icon={<ShieldCheck className="h-4 w-4 text-primary" />}
            title="Verification, not discovery"
            body="We only probe handles the borrower (or officer) declared. No scraping, no DOB/SSN enrichment."
          />
          <Stat
            icon={<Sparkles className="h-4 w-4 text-primary" />}
            title="Additive-only"
            body="Signals can lift a verdict; they never introduce a new denial reason."
          />
          <Stat
            icon={<History className="h-4 w-4 text-primary" />}
            title="Fully audited"
            body="Every run lands in the loan activity timeline with the LSIQ provider version."
          />
        </CardContent>
      </Card>

      <PermissionGate require="loans.underwrite">
        <ConsentCard
          consent={consent}
          loading={consentLoading}
          onRequest={() => setConsentDialogOpen(true)}
          onRevoke={handleRevoke}
        />

        <SocialDiscoveryPanel
          defaultUsername={defaultUsername ?? lastRun?.discovery_json?.username}
          onRunComplete={handleDiscoveryComplete}
          disabled={!hasConsent}
          disabledReason="Borrower consent required. Record consent above to enable discovery."
        />

        <AgentInsightPanel
          title="Quantum Social Signals"
          description="Score the discovery evidence against declared handles. Phase 2."
          agentId={SOCIALSYM_ID}
          icon={<Sparkles className="h-4 w-4 text-primary" />}
          accentColor="primary"
          getRequestPreview={() =>
            !hasConsent
              ? "{\n  \"message\": \"Record borrower consent first.\"\n}"
              : canRunSocial
              ? previewSocialSignals(socialInput)
              : "{\n  \"message\": \"Run discovery first — no declared handles + discovery evidence to score yet.\"\n}"
          }
          onRun={handleRunSocial}
        />

        <AgentInsightPanel
          title="Second-Look Recommendation"
          description="Additive-only scorecard. Can upgrade a borderline outcome, never downgrades. Human underwriter decides."
          agentId={SECONDLOOKSYM_ID}
          icon={<Scale className="h-4 w-4 text-secondary" />}
          accentColor="secondary"
          getRequestPreview={() =>
            !hasConsent
              ? "{\n  \"message\": \"Record borrower consent first.\"\n}"
              : canRunSecondLook
              ? previewSecondLook(secondLookInput)
              : "{\n  \"message\": \"Run QSS (socialsym) first — no QSSResponse to score yet.\"\n}"
          }
          onRun={handleRunSecondLook}
        />

        <ScorecardDisclaimer />
      </PermissionGate>

      <SocialConsentDialog
        open={consentDialogOpen}
        onOpenChange={setConsentDialogOpen}
        loanId={loanId}
        borrowerId={borrowerId ?? null}
        onSigned={(c) => setConsent(c)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription>
            Last 5 verifications for this loan. Rows gain QSS + scorecard
            fields as each agent is run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y">
              {history.map((run) => (
                <li
                  key={run.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">
                      {run.discovery_json?.username ?? "(unknown)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()} ·{" "}
                      {run.discovery_json?.total_probed ?? 0} sites probed
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary">
                      {run.discovery_json?.found ?? 0} claimed
                    </Badge>
                    {run.qss_provider && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        qss:{run.qss_provider}
                      </Badge>
                    )}
                    {run.second_look_json && (
                      <Badge className="font-mono text-[10px]">
                        2L
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Separator className="my-3" />
          <p className="text-[11px] text-muted-foreground">
            The QSS backend is selected by <code>QSS_PROVIDER</code> on
            Life-Signals-IQ. Phase-2 default:
            <code className="mx-1">stub</code>. Phase-4 flips to
            <code className="mx-1">http</code>
            pointing at the real algo — nothing here changes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs font-medium">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{body}</p>
    </div>
  );
}

function ConsentCard({
  consent,
  loading,
  onRequest,
  onRevoke,
}: {
  consent: SocialConsent | null;
  loading: boolean;
  onRequest: () => void;
  onRevoke: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          Checking borrower consent…
        </CardContent>
      </Card>
    );
  }

  if (!consent) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Borrower consent required
          </CardTitle>
          <CardDescription className="text-xs">
            Runs are blocked until consent is recorded. This protects the
            borrower and keeps the audit trail clean.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={onRequest} className="gap-2">
            <FileSignature className="h-3.5 w-3.5" />
            Record borrower consent
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5">
      <CardContent className="py-3 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">Consent on file</div>
            <div className="text-xs text-muted-foreground truncate">
              Purpose <code className="font-mono">{consent.purpose}</code> · v
              <code className="font-mono">{consent.text_version}</code> · signed{" "}
              {new Date(consent.signed_at).toLocaleString()}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRevoke}>
          Revoke
        </Button>
      </CardContent>
    </Card>
  );
}

function ScorecardDisclaimer() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-3 text-xs text-muted-foreground leading-relaxed space-y-1.5">
        <p className="flex items-start gap-2">
          <Scale className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong className="text-foreground">Not an underwriting decision.</strong>{" "}
            The Second-Look scorecard is an{" "}
            <strong>additive-only advisory</strong> signal. It may support a
            lift on a borderline outcome; it <strong>cannot</strong>{" "}
            introduce a new denial reason or downgrade an AUS verdict. The
            human underwriter remains the decision-maker and is responsible
            for the final action on this file.
          </span>
        </p>
        <p className="pl-5">
          Signal provenance, scorecard inputs, and rationale are persisted on
          each run for audit and for any adverse-action review required
          under FCRA / ECOA.
        </p>
      </CardContent>
    </Card>
  );
}
