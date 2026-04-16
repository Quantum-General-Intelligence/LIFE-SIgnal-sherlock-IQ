#! /usr/bin/env python3

"""
QGI Life-Signals-IQ: Username Intelligence Across Social Networks

Soft rebrand of the Sherlock Project. Entry point for `python -m sherlock_project`.
"""

import sys


if __name__ == "__main__":
    python_version = sys.version.split()[0]

    if sys.version_info < (3, 9):
        print(
            "QGI Life-Signals-IQ requires Python 3.9+\n"
            f"You are using Python {python_version}, which is not supported."
        )
        sys.exit(1)

    from sherlock_project import sherlock
    sherlock.main()
