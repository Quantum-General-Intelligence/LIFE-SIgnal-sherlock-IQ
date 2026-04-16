/**
 * QGI-DEMO — Social Verification consent helpers.
 *
 * Pattern:
 *   • Each loan has at most one *active* consent row at a time. "Active"
 *     = purpose matches AND revoked_at IS NULL AND text_version matches
 *     the current copy shipped by the app.
 *   • Officer re-signs whenever we bump CONSENT_TEXT_VERSION (policy
 *     changes). Old consents remain in the audit trail forever.
 *   • `consent_id` is threaded onto every `social_verifications` insert,
 *     and no LSIQ run is allowed until a valid consent exists.
 */

import { supabase } from "@quantum-general-intelligence/core";
import { logActivity } from "@/vertical/lib/auditLog";

/** Purpose tag for QGI-DEMO runs. Do not rename after release — it's a key. */
export const SOCIAL_CONSENT_PURPOSE = "social_verification_v1";

/**
 * Bump this whenever the consent copy changes in a way that requires
 * re-signing. Stored on the row so a future audit can reproduce exactly
 * what the officer agreed to.
 */
export const CONSENT_TEXT_VERSION = "2026-04-01";

export interface SocialConsent {
  id: string;
  loan_id: string;
  borrower_id: string | null;
  purpose: string;
  text_version: string;
  signed_at: string;
  signed_by_ip: string | null;
  signed_by_ua: string | null;
  revoked_at: string | null;
}

export async function fetchActiveConsent(
  loanId: string
): Promise<SocialConsent | null> {
  const { data, error } = await supabase
    .from("social_consents")
    .select("*")
    .eq("loan_id", loanId)
    .eq("purpose", SOCIAL_CONSENT_PURPOSE)
    .is("revoked_at", null)
    .order("signed_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("fetchActiveConsent:", error.message);
    return null;
  }
  const row = (data ?? [])[0] as SocialConsent | undefined;
  if (!row) return null;
  // Version mismatch → treat as not-consented so the officer re-signs.
  if (row.text_version !== CONSENT_TEXT_VERSION) return null;
  return row;
}

export async function signConsent(args: {
  loanId: string;
  borrowerId?: string | null;
}): Promise<SocialConsent> {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
  const { data, error } = await supabase
    .from("social_consents")
    .insert([
      {
        loan_id: args.loanId,
        borrower_id: args.borrowerId ?? null,
        purpose: SOCIAL_CONSENT_PURPOSE,
        text_version: CONSENT_TEXT_VERSION,
        signed_by_ua: ua,
      },
    ])
    .select("*")
    .single();
  if (error) throw new Error(`signConsent failed: ${error.message}`);
  const row = data as SocialConsent;
  logActivity(args.loanId, "social_verification_consent_signed", {
    metadata: {
      consent_id: row.id,
      text_version: row.text_version,
      purpose: row.purpose,
    },
  });
  return row;
}

export async function revokeConsent(
  loanId: string,
  consentId: string
): Promise<void> {
  const { error } = await supabase
    .from("social_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", consentId);
  if (error) throw new Error(`revokeConsent failed: ${error.message}`);
  logActivity(loanId, "social_verification_consent_revoked", {
    metadata: { consent_id: consentId },
  });
}
