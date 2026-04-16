#!/usr/bin/env bash
#
# QGI-DEMO — Phase 0 secret hygiene for qwork-underwriting.
#
# The qwork repo currently has `.env`, `.env.loanlogics`, and `.env.local`
# tracked in git with real-looking Supabase/GitHub/E2B/LlamaParse credentials.
# Any client security review will flag this instantly. This script automates
# the local cleanup; the history rewrite you still need to do manually with
# `git filter-repo` or `bfg`, coordinated with everyone who has the repo
# cloned.
#
# Run from the root of qwork-underwriting. SAFE to re-run.
# Does NOT touch git history — only working tree and future commits.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "$REPO_ROOT" ]; then
  echo "ERR: run this from inside the qwork-underwriting git repo." >&2
  exit 1
fi
cd "$REPO_ROOT"

EXPECTED_REMOTE_HINT="qwork-underwriting"
if ! git remote -v | grep -q "$EXPECTED_REMOTE_HINT"; then
  echo "WARN: repo doesn't look like qwork-underwriting. Remotes:" >&2
  git remote -v >&2
  read -rp "Continue anyway? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || exit 1
fi

echo "==> Backing up current env files to .env.backup-$(date +%s)/"
BACKUP_DIR=".env.backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"
for f in .env .env.local .env.loanlogics .env.supreme .env.production; do
  if [ -f "$f" ]; then
    cp -v "$f" "$BACKUP_DIR/"
  fi
done

echo "==> Removing env files from the index (keeping local copies in backup)"
for f in .env .env.local .env.loanlogics .env.supreme .env.production; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git rm --cached "$f" || true
  fi
done

echo "==> Patching .gitignore"
touch .gitignore
for pat in ".env" ".env.*" "!.env.example" "!.env.qgi.example"; do
  if ! grep -Fxq "$pat" .gitignore; then
    echo "$pat" >> .gitignore
  fi
done

echo "==> Writing neutral .env.example (placeholders only)"
cat > .env.example <<'EOF'
# qwork-underwriting — placeholders only. Real values belong in .env.local,
# which is gitignored.
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=replace-me
VITE_GITHUB_CLIENT_ID=replace-me
VITE_E2B_API_KEY=replace-me
VITE_LLAMAPARSE_API_KEY=replace-me
EOF

echo "==> DONE (working tree)."
cat <<NEXT

Next steps — do these yourself, do NOT automate:

  1. Rotate every leaked credential in its upstream console
     (Supabase anon + service keys, GitHub OAuth app, E2B, LlamaParse).
  2. Update .env.local with the new values.
  3. Commit:
        git add .gitignore .env.example
        git commit -m "chore(security): remove tracked env files, rotate secrets (QGI-DEMO phase 0)"
  4. Rewrite history to purge the leaked values:
        git filter-repo --path .env --path .env.local --path .env.loanlogics --invert-paths
     or via BFG:
        bfg --delete-files '.env' --delete-files '.env.local' --delete-files '.env.loanlogics'
     Then force-push and have every other clone re-clone.
  5. Append QGI-DEMO variables to .env.local from QGI-demo/.env.qgi.example.

Backups are in: $BACKUP_DIR  (gitignored automatically).
NEXT
