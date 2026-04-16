"""QSS provider selection.

Single responsibility: read ``QSS_PROVIDER`` from the environment and
return the right :class:`QSSProvider` binding. Phase 2 ships only the
stub; phase 4 wires in the real backends.
"""
from __future__ import annotations

import os
from functools import lru_cache

from sherlock_project.web.qss.base import QSSProvider
from sherlock_project.web.qss.stub import StubQSSProvider


@lru_cache(maxsize=1)
def get_provider() -> QSSProvider:
    """Return the process-wide QSSProvider, selected by ``QSS_PROVIDER`` env."""
    name = (os.environ.get("QSS_PROVIDER") or "stub").strip().lower()
    if name == "stub":
        return StubQSSProvider()
    if name == "http":
        raise NotImplementedError(
            "QSS_PROVIDER=http is reserved for phase 4 (HttpQSSProvider). "
            "Unset the variable or set QSS_PROVIDER=stub for the demo."
        )
    if name == "quantum":
        raise NotImplementedError(
            "QSS_PROVIDER=quantum is reserved for the production algo binding."
        )
    raise ValueError(f"Unknown QSS_PROVIDER: {name!r}")


def reset_provider_cache() -> None:
    """Test helper — drop the cached provider so env changes take effect."""
    get_provider.cache_clear()
