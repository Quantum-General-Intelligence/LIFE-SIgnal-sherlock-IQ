/**
 * QGI-DEMO — SocialConsentDialog
 *
 * One-screen consent prompt that gates every QGI-DEMO social-verification
 * run. Uses qwork-underwriting's core Dialog primitives so it inherits
 * the app's theme and focus-management for free.
 *
 * Contract:
 *   • Shown only when `open` is true (parent controls visibility).
 *   • On approve → inserts a row into public.social_consents, emits
 *     `social_verification_consent_signed` activity, then calls
 *     onSigned(consent).
 *   • On decline → calls onDeclined(); parent should not enable run.
 *
 * The copy below is intentionally boring — it's the exact text that
 * lands in the audit trail via CONSENT_TEXT_VERSION.
 */

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quantum-general-intelligence/core/ui";
import { useToast } from "@quantum-general-intelligence/core";
import { ShieldCheck, AlertTriangle, ScrollText } from "lucide-react";
import {
  CONSENT_TEXT_VERSION,
  SOCIAL_CONSENT_PURPOSE,
  signConsent,
  type SocialConsent,
} from "@/vertical/lib/socialConsent";

interface SocialConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loanId: string;
  borrowerId?: string | null;
  onSigned: (consent: SocialConsent) => void;
  onDeclined?: () => void;
}

export function SocialConsentDialog({
  open,
  onOpenChange,
  loanId,
  borrowerId,
  onSigned,
  onDeclined,
}: SocialConsentDialogProps) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const { toast } = useToast();

  const handleSign = async () => {
    setBusy(true);
    try {
      const consent = await signConsent({ loanId, borrowerId });
      toast({
        title: "Consent recorded",
        description: `Text version ${consent.text_version}. Saved to social_consents.`,
      });
      onSigned(consent);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not save consent",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = () => {
    onDeclined?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Borrower consent — social verification
          </DialogTitle>
          <DialogDescription>
            Required before Quantum Social Signals may be run on this loan.
            Purpose: <code className="font-mono">{SOCIAL_CONSENT_PURPOSE}</code>{" "}
            · text version: <code className="font-mono">{CONSENT_TEXT_VERSION}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 space-y-2 max-h-72 overflow-y-auto">
            <p className="font-medium flex items-center gap-2">
              <ScrollText className="h-3.5 w-3.5" />
              What the borrower agrees to
            </p>
            <p>
              The borrower authorizes the lender to verify{" "}
              <strong>publicly accessible social profiles</strong> linked to
              the handles they (or their loan officer) declared, solely to
              corroborate information already present on this application.
            </p>
            <ul className="list-disc ml-5 space-y-1 text-xs text-muted-foreground">
              <li>
                We probe only the handles you declare. We do not scrape,
                enrich with third-party data, or resolve personal identifiers
                (DOB, SSN, phone, email) from social data.
              </li>
              <li>
                Results are <strong>additive only</strong>: findings can
                support an upgrade on a borderline underwriting outcome,
                but they cannot introduce a new denial reason.
              </li>
              <li>
                All runs are logged to the loan's audit timeline. The
                borrower may revoke this consent at any time by contacting
                the lender; doing so will flag existing runs but not delete
                them from the audit record.
              </li>
              <li>
                No result from this module is a final underwriting decision.
                A human underwriter remains the decision-maker.
              </li>
            </ul>
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <span>
              This demo binding runs against a stub QSS provider. The real
              provider is swapped in via <code>QSS_PROVIDER</code> on
              Life-Signals-IQ without changing this consent text.
            </span>
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-1"
            />
            <span>
              I confirm the borrower has given consent on{" "}
              <strong>this loan</strong> for the purpose and terms above.
              A record will be written to <code>social_consents</code>.
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleDecline} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSign} disabled={!checked || busy}>
            {busy ? "Recording…" : "Record consent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
