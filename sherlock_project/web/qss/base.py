"""QSS protocol + wire types.

Kept intentionally small and JSON-serializable — every field crosses the
HTTP boundary to qwork-underwriting's TypeScript side. Field names are
``snake_case`` by convention; the TS mirror in ``lsiqClient.ts`` matches
1:1 so a future codegen step is trivial.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Protocol

from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

SignalOutcome = Literal[
    "confirmed",   # signal present and corroborated
    "partial",     # signal present but weaker than required
    "absent",      # signal not found
    "conflict",    # signal contradicts the declared application data
    "unknown",     # insufficient evidence to decide
]

SecondLookOutcome = Literal[
    "approve_lift",      # enough positive signals to lift a borderline denial
    "conditional_lift",  # lift recommended but gated on a manual condition
    "no_change",         # not enough evidence to change the verdict
]

AUSVerdict = Literal["APPROVE", "REFER", "REFER_WITH_CAUTION", "DENY"]


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

class SocialHandle(BaseModel):
    """A single declared handle the officer asked us to verify."""
    platform: str = Field(..., description="e.g. 'github', 'linkedin', 'yelp'")
    username: str
    url: Optional[str] = None


class DiscoveryHit(BaseModel):
    """One row from a Life-Signals-IQ discovery run."""
    site: str
    url: str
    status_key: str   # CLAIMED | AVAILABLE | WAF | UNKNOWN | ILLEGAL
    context: Optional[str] = None


class LoanFacts(BaseModel):
    """Subset of loan attributes the scorecard consults.

    Never PII. We only take what matters for the additive-only decision:
    FICO, DTI, LTV, AUS verdict, self-employed flag, and a borrower-declared
    business-type label. Everything else stays in qwork.
    """
    fico: Optional[int] = None
    dti: Optional[float] = None
    ltv: Optional[float] = None
    aus_verdict: Optional[AUSVerdict] = None
    self_employed: Optional[bool] = None
    declared_business_type: Optional[str] = None


class QSSRequest(BaseModel):
    """Inputs to QSSProvider.evaluate — declared handles + discovery evidence."""

    model_config = ConfigDict(extra="ignore")

    loan_id: str
    declared_handles: list[SocialHandle] = Field(default_factory=list)
    discovery: list[DiscoveryHit] = Field(default_factory=list)
    loan_facts: LoanFacts = Field(default_factory=LoanFacts)


class SecondLookRequest(BaseModel):
    """Inputs to the scorecard engine."""

    model_config = ConfigDict(extra="ignore")

    loan_id: str
    loan_facts: LoanFacts
    qss_response: "QSSResponse"


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

class SignalEvidence(BaseModel):
    """Human-readable bullet that supports a signal outcome."""
    kind: Literal["profile", "post", "footprint", "metadata", "stub"]
    description: str
    source_url: Optional[str] = None


class QSSSignal(BaseModel):
    """One scored signal — the atomic unit of QSS output.

    The phase-2 stub populates a small curated set. The real provider will
    emit the same shape with richer evidence and confidence values.
    """
    name: str
    outcome: SignalOutcome
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str
    evidence: list[SignalEvidence] = Field(default_factory=list)


class QSSResponse(BaseModel):
    """Envelope returned by every QSSProvider implementation."""
    provider: str           # 'stub' | 'http' | 'quantum-v1'
    provider_version: str
    loan_id: str
    signals: list[QSSSignal]
    summary: str            # one-sentence human summary for the UI header
    warnings: list[str] = Field(default_factory=list)


class SecondLookFeature(BaseModel):
    """A scorecard feature row, shown alongside the final recommendation."""
    name: str
    weight: int
    awarded: int
    reason: str


class SecondLookResponse(BaseModel):
    """Scorecard output — additive-only.

    Invariants (enforced in tests):
      1. ``score`` is in ``[0, max_score]``.
      2. ``outcome`` is never ``approve_lift`` when all signals are absent.
      3. The recommendation NEVER downgrades an AUS verdict.
    """
    loan_id: str
    outcome: SecondLookOutcome
    score: int
    max_score: int
    features: list[SecondLookFeature]
    rationale: str
    disclaimer: str = (
        "Additive-only. Can recommend an upgrade on a borderline outcome; "
        "never downgrades an AUS verdict. Human underwriter remains the decision-maker."
    )


# Resolve the forward reference after QSSResponse is defined.
SecondLookRequest.model_rebuild()


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

class QSSProvider(Protocol):
    """Anything that can turn a :class:`QSSRequest` into a :class:`QSSResponse`.

    Three bindings ship with the repo (phase 2 adds `stub`, phase 4 adds
    `http` and `quantum`):

    - ``StubQSSProvider`` — deterministic, dev-only, zero dependencies.
    - ``HttpQSSProvider`` — posts to an external QSS service over HTTP.
    - ``QuantumQSSProvider`` — direct in-process binding to the real algo.
    """

    name: str
    version: str

    def evaluate(self, request: QSSRequest) -> QSSResponse:
        ...
