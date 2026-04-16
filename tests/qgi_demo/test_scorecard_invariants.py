"""Invariant tests for the Second-Look scorecard.

These are the **non-negotiables** for the QGI-DEMO second-look module.
If one of these tests fails, the scorecard is broken and must not ship.
"""
from __future__ import annotations

import itertools

import pytest
from pydantic import ValidationError

from sherlock_project.web.qss import (
    QSSResponse,
    QSSSignal,
    SecondLookRequest,
    StubQSSProvider,
    run_second_look,
)
from sherlock_project.web.qss.base import (
    DiscoveryHit,
    LoanFacts,
    QSSRequest,
    SocialHandle,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_qss(outcomes: dict[str, str]) -> QSSResponse:
    """Build a synthetic QSSResponse with the given per-signal outcomes."""
    return QSSResponse(
        provider="test",
        provider_version="0.0.0",
        loan_id="L-1",
        signals=[
            QSSSignal(
                name=name, outcome=outcome, confidence=0.9, rationale=f"test {name}"
            )
            for name, outcome in outcomes.items()
        ],
        summary="test",
    )


def _loan(**kwargs) -> LoanFacts:
    return LoanFacts(**kwargs)


def _second_look(facts: LoanFacts, qss: QSSResponse):
    return run_second_look(
        SecondLookRequest(loan_id="L-1", loan_facts=facts, qss_response=qss)
    )


# ---------------------------------------------------------------------------
# Invariant 1 — additive only (awarded in [0, weight])
# ---------------------------------------------------------------------------

_ALL_OUTCOMES = ("confirmed", "partial", "absent", "conflict", "unknown")


@pytest.mark.parametrize(
    "outcomes",
    [
        dict(zip(
            (
                "handle_match",
                "professional_footprint",
                "business_footprint",
                "cross_platform_consistency",
            ),
            combo,
        ))
        for combo in itertools.product(_ALL_OUTCOMES, repeat=4)
    ],
)
def test_awarded_never_exceeds_weight_or_below_zero(outcomes: dict[str, str]) -> None:
    result = _second_look(_loan(self_employed=True, aus_verdict="REFER"), _make_qss(outcomes))
    for f in result.features:
        assert 0 <= f.awarded <= f.weight, (
            f"Feature {f.name} violated additive-only: awarded={f.awarded} weight={f.weight}"
        )
    assert 0 <= result.score <= result.max_score


# ---------------------------------------------------------------------------
# Invariant 2 — never downgrades
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "verdict",
    ["APPROVE", "REFER", "REFER_WITH_CAUTION", "DENY"],
)
def test_never_downgrades_regardless_of_signal(verdict: str) -> None:
    """No combination of signal outcomes can produce a 'downgrade' recommendation.

    The scorecard vocabulary only contains ``approve_lift``,
    ``conditional_lift``, ``no_change``. There is no ``deny_add`` token.
    """
    for outcomes in itertools.product(_ALL_OUTCOMES, repeat=4):
        facts = _loan(self_employed=True, aus_verdict=verdict)
        qss = _make_qss(
            dict(
                zip(
                    (
                        "handle_match",
                        "professional_footprint",
                        "business_footprint",
                        "cross_platform_consistency",
                    ),
                    outcomes,
                )
            )
        )
        result = _second_look(facts, qss)
        assert result.outcome in ("approve_lift", "conditional_lift", "no_change")


# ---------------------------------------------------------------------------
# Invariant 3 — non-borderline verdicts never flip to a lift
# ---------------------------------------------------------------------------

def test_approve_verdict_never_flipped_even_with_perfect_signals() -> None:
    all_confirmed = _make_qss(
        {
            "handle_match": "confirmed",
            "professional_footprint": "confirmed",
            "business_footprint": "confirmed",
            "cross_platform_consistency": "confirmed",
        }
    )
    result = _second_look(
        _loan(self_employed=True, aus_verdict="APPROVE"),
        all_confirmed,
    )
    assert result.outcome == "no_change"


# ---------------------------------------------------------------------------
# Invariant 4 — all-absent never produces a lift
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "verdict",
    ["APPROVE", "REFER", "REFER_WITH_CAUTION", "DENY"],
)
def test_all_absent_signals_never_lift(verdict: str) -> None:
    nothing = _make_qss(
        {
            "handle_match": "absent",
            "professional_footprint": "absent",
            "business_footprint": "absent",
            "cross_platform_consistency": "absent",
        }
    )
    result = _second_look(
        _loan(self_employed=True, aus_verdict=verdict), nothing
    )
    assert result.outcome == "no_change"


# ---------------------------------------------------------------------------
# Invariant 5 — borderline + strong signals WILL lift
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "verdict",
    ["REFER", "REFER_WITH_CAUTION", "DENY"],
)
def test_borderline_with_all_confirmed_lifts(verdict: str) -> None:
    all_confirmed = _make_qss(
        {
            "handle_match": "confirmed",
            "professional_footprint": "confirmed",
            "business_footprint": "confirmed",
            "cross_platform_consistency": "confirmed",
        }
    )
    result = _second_look(
        _loan(self_employed=True, aus_verdict=verdict), all_confirmed
    )
    assert result.outcome in ("approve_lift", "conditional_lift")


# ---------------------------------------------------------------------------
# Invariant 6 — disclaimer is always present
# ---------------------------------------------------------------------------

def test_disclaimer_is_always_populated() -> None:
    result = _second_look(_loan(aus_verdict="REFER"), _make_qss({}))
    assert result.disclaimer
    assert "additive" in result.disclaimer.lower()
    assert "human" in result.disclaimer.lower()


# ---------------------------------------------------------------------------
# Invariant 7 — business footprint not applicable => weight zeroed
# ---------------------------------------------------------------------------

def test_non_self_employed_zeroes_business_feature_weight() -> None:
    result = _second_look(
        _loan(self_employed=False, aus_verdict="REFER"),
        _make_qss(
            {
                "handle_match": "confirmed",
                "business_footprint": "confirmed",
            }
        ),
    )
    business = next(f for f in result.features if "business" in f.name.lower())
    assert business.weight == 0
    assert business.awarded == 0


# ---------------------------------------------------------------------------
# StubQSSProvider smoke tests
# ---------------------------------------------------------------------------

def test_stub_emits_expected_signals_and_is_deterministic() -> None:
    stub = StubQSSProvider()
    request = QSSRequest(
        loan_id="L-SMOKE",
        declared_handles=[SocialHandle(platform="GitHub", username="alice")],
        discovery=[
            DiscoveryHit(
                site="GitHub",
                url="https://github.com/alice",
                status_key="CLAIMED",
                context="alice on github",
            ),
            DiscoveryHit(
                site="LinkedIn",
                url="https://linkedin.com/in/alice",
                status_key="CLAIMED",
                context="",
            ),
        ],
        loan_facts=LoanFacts(self_employed=False),
    )
    a = stub.evaluate(request)
    b = stub.evaluate(request)

    names = {s.name for s in a.signals}
    assert names == {
        "handle_match",
        "professional_footprint",
        "business_footprint",
        "cross_platform_consistency",
    }
    assert a.model_dump() == b.model_dump(), "Stub must be deterministic"


def test_stub_with_no_input_produces_warnings_not_errors() -> None:
    stub = StubQSSProvider()
    resp = stub.evaluate(QSSRequest(loan_id="L-EMPTY"))
    assert resp.warnings
    assert all(s.outcome in ("unknown", "absent") for s in resp.signals)


# ---------------------------------------------------------------------------
# Schema — Pydantic rejects invalid confidence values
# ---------------------------------------------------------------------------

def test_signal_confidence_must_be_0_to_1() -> None:
    with pytest.raises(ValidationError):
        QSSSignal(name="x", outcome="confirmed", confidence=1.5, rationale="r")
    with pytest.raises(ValidationError):
        QSSSignal(name="x", outcome="confirmed", confidence=-0.1, rationale="r")
