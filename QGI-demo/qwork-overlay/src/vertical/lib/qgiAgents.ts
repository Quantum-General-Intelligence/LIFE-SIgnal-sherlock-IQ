/**
 * QGI-DEMO — agent shims for the Social Verification tab.
 *
 * These mirror the `preview* / run*` pattern that qwork already uses with
 * `@quantum-general-intelligence/core/agents`. They wrap HTTP calls to
 * QGI Life-Signals-IQ so `AgentInsightPanel` can render them exactly like
 * the existing NS agents (urwsym, satsym, causalsym, …).
 *
 * Phase-2 scope:
 *   • socialsym      → POST /api/qss/signals
 *   • secondlooksym  → POST /api/qss/second-look
 *
 * When the two agent IDs land in @qgi/core proper, delete this file and
 * re-import from core/agents. Nothing else changes.
 */

import type { AgentId, AgentResult, JobStatus } from "@quantum-general-intelligence/core/agents";
import {
  lsiqQssSignals,
  lsiqSecondLook,
  type QSSRequest,
  type QSSResponse,
  type SecondLookRequest,
  type SecondLookResponse,
  type LSIQResult,
  type SocialHandle,
  type LoanFacts,
} from "@/vertical/lib/lsiqClient";

// Intentional: these IDs don't exist in core's `AgentId` union yet. The
// shim uses string-identical labels so swap-in is a one-line change once
// core publishes them. Consumer components cast at the call-site.
export const SOCIALSYM_ID = "socialsym" as unknown as AgentId;
export const SECONDLOOKSYM_ID = "secondlooksym" as unknown as AgentId;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SocialInput {
  loanId: string;
  declaredHandles: SocialHandle[];
  discoveryResults: LSIQResult[];
  loanFacts: LoanFacts;
}

// ---------------------------------------------------------------------------
// socialsym
// ---------------------------------------------------------------------------

function buildQssRequest(input: SocialInput): QSSRequest {
  return {
    loan_id: input.loanId,
    declared_handles: input.declaredHandles,
    discovery: input.discoveryResults.map((r) => ({
      site: r.site,
      url: r.url,
      status_key: r.status_key,
      context: r.context ?? null,
    })),
    loan_facts: input.loanFacts,
  };
}

export function previewSocialSignals(input: SocialInput): string {
  return JSON.stringify(buildQssRequest(input), null, 2);
}

export async function runSocialSignals(
  input: SocialInput,
  onProgress?: (status: JobStatus, pollCount: number) => void
): Promise<AgentResult> {
  const jobId = `lsiq-qss-${Date.now()}`;
  onProgress?.({ jobId, status: "submitted" } as JobStatus, 0);
  const start = performance.now();
  try {
    onProgress?.({ jobId, status: "running" } as JobStatus, 1);
    const data: QSSResponse = await lsiqQssSignals(buildQssRequest(input));
    onProgress?.({ jobId, status: "succeeded" } as JobStatus, 2);
    return {
      success: true,
      data,
      duration: Math.round(performance.now() - start),
      jobId,
    } as AgentResult;
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message ?? String(err),
      duration: Math.round(performance.now() - start),
      jobId,
    } as AgentResult;
  }
}

// ---------------------------------------------------------------------------
// secondlooksym
// ---------------------------------------------------------------------------

export interface SecondLookInput {
  loanId: string;
  loanFacts: LoanFacts;
  qss: QSSResponse;
}

function buildSecondLookRequest(input: SecondLookInput): SecondLookRequest {
  return {
    loan_id: input.loanId,
    loan_facts: input.loanFacts,
    qss_response: input.qss,
  };
}

export function previewSecondLook(input: SecondLookInput): string {
  return JSON.stringify(buildSecondLookRequest(input), null, 2);
}

export async function runSecondLook(
  input: SecondLookInput,
  onProgress?: (status: JobStatus, pollCount: number) => void
): Promise<AgentResult> {
  const jobId = `lsiq-2l-${Date.now()}`;
  onProgress?.({ jobId, status: "submitted" } as JobStatus, 0);
  const start = performance.now();
  try {
    onProgress?.({ jobId, status: "running" } as JobStatus, 1);
    const data: SecondLookResponse = await lsiqSecondLook(
      buildSecondLookRequest(input)
    );
    onProgress?.({ jobId, status: "succeeded" } as JobStatus, 2);
    return {
      success: true,
      data,
      duration: Math.round(performance.now() - start),
      jobId,
    } as AgentResult;
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message ?? String(err),
      duration: Math.round(performance.now() - start),
      jobId,
    } as AgentResult;
  }
}
