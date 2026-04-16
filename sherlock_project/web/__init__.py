"""QGI Life-Signals-IQ web wrapper.

This subpackage provides a FastAPI + HTML UI around the CLI, without
modifying any of the underlying detection logic. It is a pure wrapper
over ``sherlock_project.sherlock.sherlock``.
"""

__all__ = ["app", "cli"]
