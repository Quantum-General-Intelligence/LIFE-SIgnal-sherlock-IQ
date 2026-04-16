""" QGI Life-Signals-IQ (fka Sherlock) Module

This module contains the main logic to search for usernames at social
networks. Soft-rebranded as QGI Life-Signals-IQ; the underlying package
name (``sherlock_project``) is preserved for backwards compatibility.

"""

from importlib.metadata import version as pkg_version, PackageNotFoundError
import pathlib
import tomli


def get_version() -> str:
    """Fetch the version number of the installed package."""
    try:
        return pkg_version("sherlock_project")
    except PackageNotFoundError:
        pyproject_path: pathlib.Path = pathlib.Path(__file__).resolve().parent.parent / "pyproject.toml"
        with pyproject_path.open("rb") as f:
            pyproject_data = tomli.load(f)
        return pyproject_data["tool"]["poetry"]["version"]

# This variable is only used to check for ImportErrors induced by users running as script rather than as module or package
import_error_test_var = None

__shortname__   = "QGI Life-Signals-IQ"
__longname__    = "QGI Life-Signals-IQ: Username Intelligence Across Social Networks"
__version__     = get_version()

__upstream_shortname__ = "Sherlock"
__upstream_longname__  = "Sherlock: Find Usernames Across Social Networks"

forge_api_latest_release = "https://api.github.com/repos/sherlock-project/sherlock/releases/latest"
