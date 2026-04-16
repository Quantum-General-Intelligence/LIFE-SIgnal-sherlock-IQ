"""CLI launcher for the QGI Life-Signals-IQ web UI."""
from __future__ import annotations

import argparse
import sys

from sherlock_project import __shortname__, __version__


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="qgi-life-signals-iq-web",
        description=f"{__shortname__} — web UI and JSON API (v{__version__})",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload on code changes (dev only).",
    )
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["critical", "error", "warning", "info", "debug", "trace"],
    )
    args = parser.parse_args()

    try:
        import uvicorn
    except ImportError:
        print(
            "uvicorn is not installed. Install the web extras:\n"
            "  pip install 'sherlock-project[web]'\n"
            "  # or for a local checkout:\n"
            "  pip install -e '.[web]'",
            file=sys.stderr,
        )
        sys.exit(1)

    uvicorn.run(
        "sherlock_project.web.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
