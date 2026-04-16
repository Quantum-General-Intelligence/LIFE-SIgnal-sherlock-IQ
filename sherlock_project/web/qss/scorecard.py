"""Second-Look Underwriting scorecard.

Takes a :class:`~sherlock_project.web.qss.base.SecondLookRequest` (loan
facts + a QSSResponse) and emits an **additive-only** recommendation.

Invariants enforced here (and re-enforced by tests in
``tests/qgi_demo/test_scorecard_invariants.py``):

- Every feature is either **positive** (awards 0..weight points) or
  **neutral** (awards 0). No feature ever subtracts.
- A ``confirmed`` signal is worth full weight. ``partial`` = half weight
  (rounded down). Anything else = 0.
- The final outcome can only RECOMMEND an upgrade on a borderline AUS
  verdict. It can never be read by qwork as a downgrade instruction —
  both the outcome label and the disclaimer make that explicit.

The scorecard is intentionally simple so legal / compliance can audit it
on one page. The QSS team can expand it in the real module, keeping the
additive-only invariant.
"""
from __future__ import annotations

from typing import Callable

from sherlock_project.web.qss.base import (
    LoanFacts,
    QSSResponse,
    SecondLookFeature,
    SecondLookRequest,
    SecondLookResponse,
    SecondLookOutcome,
)


FeatureFn = Callable[[LoanFacts, QSSResponse], SecondLookFeature]


def _points_from_signal(
    signals: list, name: str, weight: int, *, confirmed_frac: float = 1.0,
    partial_frac: float = 0.5,
) -> tuple[int, str]:
    sig = next((s for s in signals if s.name == name), None)
    if sig is None:
        return 0, f"Signal '{name}' not present in response."
    if sig.outcome == "confirmed":
        return int(weight * confirmed_frac), sig.rationale
    if sig.outcome == "partial":
        return int(weight * partial_frac), sig.rationale
    return 0, sig.rationale


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------

def feature_handle_match(facts: LoanFacts, qss: QSSResponse) -> SecondLookFeature:
    awarded, reason = _points_from_signal(qss.signals, "handle_match", weight=10)
    return SecondLookFeature(
        name="Declared handles verified",
        weight=10,
        awarded=awarded,
        reason=reason,
    )


def feature_professional_footprint(
    facts: LoanFacts, qss: QSSResponse
) -> SecondLookFeature:
    awarded, reason = _points_from_signal(
        qss.signals, "professional_footprint", weight=8
    )
    return SecondLookFeature(
        name="Professional footprint (LinkedIn/GitHub/…)",
        weight=8,
        awarded=awarded,
        reason=reason,
    )


def feature_business_footprint(
    facts: LoanFacts, qss: QSSResponse
) -> SecondLookFeature:
    awarded, reason = _points_from_signal(qss.signals, "business_footprint", weight=12)
    applicable = bool(facts.self_employed or facts.declared_business_type)
    return SecondLookFeature(
        name="Self-employed business footprint",
        weight=12 if applicable else 0,
        awarded=awarded if applicable else 0,
        reason=reason if applicable else "Not applicable — borrower is not self-employed.",
    )


def feature_cross_platform_consistency(
    facts: LoanFacts, qss: QSSResponse
) -> SecondLookFeature:
    awarded, reason = _points_from_signal(
        qss.signals, "cross_platform_consistency", weight=5
    )
    return SecondLookFeature(
        name="Cross-platform identity consistency",
        weight=5,
        awarded=awarded,
        reason=reason,
    )


FEATURES: tuple[FeatureFn, ...] = (
    feature_handle_match,
    feature_professional_footprint,
    feature_business_footprint,
    feature_cross_platform_consistency,
)


# ---------------------------------------------------------------------------
# Outcome classification
# ---------------------------------------------------------------------------

def _classify(
    facts: LoanFacts, score: int, max_score: int
) -> tuple[SecondLookOutcome, str]:
    if max_score == 0:
        return "no_change", "No applicable features for this loan."

    pct = score / max_score
    verdict = facts.aus_verdict

    # Additive-only: only ever recommend an upgrade on a borderline verdict.
    borderline = verdict in ("REFER", "REFER_WITH_CAUTION", "DENY")

    if not borderline:
        return (
            "no_change",
            (
                "AUS verdict is not borderline — scorecard recommends no change. "
                f"Signal score: {score}/{max_score} ({pct:.0%})."
            ),
        )

    if pct >= 0.65:
        return (
            "approve_lift",
            (
                "Strong positive social signals on a borderline file. "
                f"Score {score}/{max_score} ({pct:.0%}) clears the approve-lift threshold."
            ),
        )
    if pct >= 0.45:
        return (
            "conditional_lift",
            (
                "Positive signals present but not decisive. Scorecard recommends "
                "a conditional lift — pair with a single manual verification step "
                f"(score {score}/{max_score}, {pct:.0%})."
            ),
        )
    return (
        "no_change",
        (
            f"Signal score {score}/{max_score} ({pct:.0%}) below the lift "
            "threshold — scorecard recommends no change."
        ),
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_second_look(request: SecondLookRequest) -> SecondLookResponse:
    """Score a loan's QSS response and return an additive-only recommendation."""
    features = [fn(request.loan_facts, request.qss_response) for fn in FEATURES]

    max_score = sum(f.weight for f in features)
    score = sum(f.awarded for f in features)

    # Invariant guard: awarded must never exceed weight.
    for f in features:
        if f.awarded > f.weight or f.awarded < 0:
            raise ValueError(
                f"Feature '{f.name}' violated additive-only invariant: "
                f"awarded={f.awarded}, weight={f.weight}"
            )

    outcome, rationale = _classify(request.loan_facts, score, max_score)

    return SecondLookResponse(
        loan_id=request.loan_id,
        outcome=outcome,
        score=score,
        max_score=max_score,
        features=features,
        rationale=rationale,
    )
