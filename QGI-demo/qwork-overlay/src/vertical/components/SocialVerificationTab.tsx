/**
 * QGI-DEMO — SocialVerificationTab
 *
 * Tab content inside LoanDetail. Renders the SocialDiscoveryPanel (phase 1)
 * and persists each completed run to `public.social_verifications` so the
 * phase-2 agents (`socialsym`, `secondlooksym`) can read the last run.
 *
 * Feature-gated with VITE_QGI_DEMO_SOCIAL_VERIFY. If the flag is off, the
 * parent should not render this tab at all (see docs/wire-into-loan-detail.md).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@quantum-general-intelligence/core/ui";
import { Sparkles, ShieldCheck, History } from "lucide-react";
import {
  supabase,
  useToast,
  PermissionGate,
} from "@quantum-general-intelligence/core";
import { logActivity } from "@/vertical/lib/auditLog";
import { SocialDiscoveryPanel } from "@/vertical/components/SocialDiscoveryPanel";
import { clientLabel } from "@/vertical/lib/lsiqClient";
import type { LSIQResult } from "@/vertical/lib/lsiqClient";

export interface SocialVerificationTabProps {
  loanId: string;
  borrowerId?: string;
  /** Primary borrower handle to pre-fill, if known. */
  defaultUsername?: string;
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
}

export function SocialVerificationTab({
  loanId,
  borrowerId,
  defaultUsername,
}: SocialVerificationTabProps) {
  const { toast } = useToast();
  const [history, setHistory] = useState<StoredRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from("social_verifications")
      .select("id, created_at, declared_handles, discovery_json")
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
  };

  useEffect(() => {
    void loadHistory();
  }, [loanId]);

  const handleRunComplete = async (run: {
    username: string;
    results: LSIQResult[];
    found: number;
    total_probed: number;
    started_at: string;
    finished_at: string;
    error?: string;
  }) => {
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

  const lastRun = history[0] ?? null;
  const label = useMemo(() => clientLabel(), []);

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
                networks. Additive-only — findings can upgrade a borderline
                outcome, but can never downgrade one. Officer-driven, with
                consent (phase 3).
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
            body="Every run is logged to the loan activity timeline with the LSIQ provider version."
          />
        </CardContent>
      </Card>

      <PermissionGate require="loans.underwrite">
        <SocialDiscoveryPanel
          defaultUsername={defaultUsername ?? lastRun?.discovery_json?.username}
          onRunComplete={handleRunComplete}
        />
      </PermissionGate>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription>
            Last 5 discoveries for this loan. Click through to the phase-2
            agent panels (coming next).
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
                  <Badge variant="secondary">
                    {run.discovery_json?.found ?? 0} claimed
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <Separator className="my-3" />
          <p className="text-[11px] text-muted-foreground">
            Phase 1 scope: discovery only. Quantum Social Signals scoring and
            the second-look recommendation land in phase 2 as
            <code className="mx-1">socialsym</code> and
            <code className="mx-1">secondlooksym</code> agents.
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
