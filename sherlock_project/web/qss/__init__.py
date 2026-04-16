"""Quantum Social Signals (QSS) — in-process interface.

This subpackage holds the *contract* between QGI Life-Signals-IQ and the
QSS algorithm family. It exists so that:

- The demo can ship today with a deterministic ``StubQSSProvider``.
- The QSS team can drop in a real provider later with zero changes to
  callers — just flip ``QSS_PROVIDER`` in the environment.
- The qwork-underwriting vertical speaks one stable HTTP contract
  regardless of which backend is answering.

Public surface:

- Types:        :class:`QSSRequest`, :class:`QSSSignal`, :class:`QSSResponse`,
                :class:`SecondLookRequest`, :class:`SecondLookResponse`
- Protocol:     :class:`QSSProvider`
- Registry:     :func:`get_provider` — reads ``QSS_PROVIDER`` env var.
- Scorecard:    :func:`run_second_look` — additive-only scorecard engine.
"""

from sherlock_project.web.qss.base import (
    QSSProvider,
    QSSRequest,
    QSSResponse,
    QSSSignal,
    SecondLookRequest,
    SecondLookResponse,
    SignalEvidence,
)
from sherlock_project.web.qss.registry import get_provider
from sherlock_project.web.qss.scorecard import run_second_look
from sherlock_project.web.qss.stub import StubQSSProvider

__all__ = [
    "QSSProvider",
    "QSSRequest",
    "QSSResponse",
    "QSSSignal",
    "SecondLookRequest",
    "SecondLookResponse",
    "SignalEvidence",
    "StubQSSProvider",
    "get_provider",
    "run_second_look",
]
