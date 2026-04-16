"""Deterministic stub QSS provider.

Emits a plausible-looking :class:`QSSResponse` purely from the shape of
the input (declared handles + discovery hits). Two rules:

1. **Never fabricate confidence.** Every signal's confidence is a direct
   function of how much public evidence the discovery stage produced.
2. **Never emit PII.** The stub only reasons about platforms + status
   keys + the declared business-type label.

The stub is intentionally *boring* — it exists to unblock the qwork
integration, not to impress. The real QSS provider replaces this module
verbatim.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable

from sherlock_project.web.qss.base import (
    DiscoveryHit,
    QSSProvider,
    QSSRequest,
    QSSResponse,
    QSSSignal,
    SignalEvidence,
)


_PROFESSIONAL_PLATFORMS = frozenset(
    {"linkedin", "github", "gitlab", "stackoverflow", "dev.to", "medium"}
)
_BUSINESS_PLATFORMS = frozenset(
    {"yelp", "googlemaps", "bbb", "tripadvisor", "facebook", "instagram"}
)


class StubQSSProvider:
    """Reference implementation of :class:`QSSProvider`."""

    name: str = "stub"
    version: str = "0.1.0"

    # ---- public API --------------------------------------------------------

    def evaluate(self, request: QSSRequest) -> QSSResponse:
        claimed = [h for h in request.discovery if h.status_key == "CLAIMED"]
        declared_platforms = {
            h.platform.lower() for h in request.declared_handles if h.platform
        }
        claimed_sites = [h.site.lower() for h in claimed]

        signals = [
            self._signal_handle_match(request.declared_handles, claimed),
            self._signal_professional_footprint(
                declared_platforms, claimed, claimed_sites
            ),
            self._signal_business_footprint(
                request.loan_facts.declared_business_type,
                request.loan_facts.self_employed,
                claimed,
                claimed_sites,
            ),
            self._signal_cross_platform_consistency(declared_platforms, claimed),
        ]

        confirmed = sum(1 for s in signals if s.outcome == "confirmed")
        if confirmed == len(signals):
            summary = "All declared handles corroborated across platforms."
        elif confirmed >= 2:
            summary = (
                f"{confirmed} of {len(signals)} QSS signals confirmed; "
                "remainder partial or absent."
            )
        elif confirmed == 0:
            summary = "No QSS signals confirmed against declared handles."
        else:
            summary = (
                f"{confirmed} QSS signal confirmed; evidence is thin — "
                "consider an additional run with more handles."
            )

        warnings: list[str] = []
        if not request.declared_handles:
            warnings.append(
                "No declared handles supplied; all signals default to 'unknown'."
            )
        if not claimed:
            warnings.append(
                "Discovery returned zero CLAIMED profiles; signals lean 'absent'."
            )

        return QSSResponse(
            provider=self.name,
            provider_version=self.version,
            loan_id=request.loan_id,
            signals=signals,
            summary=summary,
            warnings=warnings,
        )

    # ---- individual signals -----------------------------------------------

    def _signal_handle_match(
        self,
        declared: Iterable,
        claimed: list[DiscoveryHit],
    ) -> QSSSignal:
        declared_list = list(declared)
        if not declared_list:
            return QSSSignal(
                name="handle_match",
                outcome="unknown",
                confidence=0.0,
                rationale="No handles declared; nothing to match.",
            )
        matched = [
            h
            for h in claimed
            if any(
                d.username and d.username.lower() in (h.context or "").lower()
                or d.platform.lower() == h.site.lower()
                for d in declared_list
            )
        ]
        if matched:
            return QSSSignal(
                name="handle_match",
                outcome="confirmed",
                confidence=min(1.0, 0.4 + 0.2 * len(matched)),
                rationale=(
                    f"{len(matched)} declared handle(s) resolved to a public profile."
                ),
                evidence=[
                    SignalEvidence(
                        kind="profile",
                        description=f"Claimed profile on {h.site}",
                        source_url=h.url,
                    )
                    for h in matched[:5]
                ],
            )
        if claimed:
            return QSSSignal(
                name="handle_match",
                outcome="partial",
                confidence=0.3,
                rationale=(
                    "Public profiles exist under this handle, but none match the "
                    "platforms the borrower declared."
                ),
            )
        return QSSSignal(
            name="handle_match",
            outcome="absent",
            confidence=0.2,
            rationale="Handle did not resolve on any probed network.",
        )

    def _signal_professional_footprint(
        self,
        declared_platforms: set[str],
        claimed: list[DiscoveryHit],
        claimed_sites: list[str],
    ) -> QSSSignal:
        hits = [
            h for h, site in zip(claimed, claimed_sites) if site in _PROFESSIONAL_PLATFORMS
        ]
        if not hits:
            return QSSSignal(
                name="professional_footprint",
                outcome="absent" if claimed else "unknown",
                confidence=0.15 if claimed else 0.0,
                rationale="No professional-network profile found.",
            )
        return QSSSignal(
            name="professional_footprint",
            outcome="confirmed",
            confidence=min(1.0, 0.5 + 0.15 * len(hits)),
            rationale=f"{len(hits)} professional-network profile(s) claimed.",
            evidence=[
                SignalEvidence(kind="profile", description=h.site, source_url=h.url)
                for h in hits[:5]
            ],
        )

    def _signal_business_footprint(
        self,
        declared_business_type: str | None,
        self_employed: bool | None,
        claimed: list[DiscoveryHit],
        claimed_sites: list[str],
    ) -> QSSSignal:
        hits = [
            h for h, site in zip(claimed, claimed_sites) if site in _BUSINESS_PLATFORMS
        ]
        if not self_employed and not declared_business_type:
            return QSSSignal(
                name="business_footprint",
                outcome="unknown",
                confidence=0.0,
                rationale=(
                    "Borrower not self-employed and no business type declared; "
                    "signal not applicable."
                ),
            )
        if not hits:
            return QSSSignal(
                name="business_footprint",
                outcome="absent",
                confidence=0.3,
                rationale=(
                    "Self-employed borrower, but no business-review or "
                    "local-listing presence found."
                ),
            )
        return QSSSignal(
            name="business_footprint",
            outcome="confirmed",
            confidence=min(1.0, 0.55 + 0.12 * len(hits)),
            rationale=(
                f"{len(hits)} business-listing / review-platform presence "
                "corroborates the declared business."
            ),
            evidence=[
                SignalEvidence(kind="footprint", description=h.site, source_url=h.url)
                for h in hits[:5]
            ],
        )

    def _signal_cross_platform_consistency(
        self,
        declared_platforms: set[str],
        claimed: list[DiscoveryHit],
    ) -> QSSSignal:
        sites = Counter(h.site.lower() for h in claimed)
        if not claimed:
            return QSSSignal(
                name="cross_platform_consistency",
                outcome="unknown",
                confidence=0.0,
                rationale="No claimed profiles to cross-check.",
            )
        unique_sites = len(sites)
        if unique_sites >= 3:
            return QSSSignal(
                name="cross_platform_consistency",
                outcome="confirmed",
                confidence=min(1.0, 0.5 + 0.1 * unique_sites),
                rationale=(
                    f"Consistent handle across {unique_sites} distinct platforms."
                ),
            )
        if unique_sites == 2:
            return QSSSignal(
                name="cross_platform_consistency",
                outcome="partial",
                confidence=0.4,
                rationale="Handle appears on two platforms — possible but thin.",
            )
        return QSSSignal(
            name="cross_platform_consistency",
            outcome="absent",
            confidence=0.25,
            rationale="Handle appears on a single platform only.",
        )


# Satisfy the Protocol check at import time (no runtime cost).
_: QSSProvider = StubQSSProvider()
