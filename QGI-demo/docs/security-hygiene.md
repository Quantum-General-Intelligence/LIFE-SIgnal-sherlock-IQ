# Phase 0 — Security hygiene for qwork-underwriting

## What we found

Committed to `Quantum-General-Intelligence/qwork-underwriting @ main`:

| File              | Sensitive content (summary)                                  |
| ----------------- | ------------------------------------------------------------ |
| `.env`            | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                |
| `.env.local`      | same + `VITE_GITHUB_CLIENT_ID`, `VITE_E2B_API_KEY`, `VITE_LLAMAPARSE_API_KEY` |
| `.env.loanlogics` | anon key + API keys (LoanLogics-branded build)               |

These values survive in git history even if we delete them now. Every
serious client security review will grep for `.env` in the git log and
raise this.

## What we do in phase 0

1. **Rotate credentials** at source (Supabase, GitHub OAuth app, E2B, LlamaParse).
2. **Remove env files from the index** and add them to `.gitignore`.
3. **Keep `.env.example`** with placeholders only.
4. **Rewrite history** with `git filter-repo` or `bfg` to purge leaked values.
5. **Force-push** and instruct every clone holder to re-clone.

Step 1 is manual. Steps 2–3 are scripted: `QGI-demo/scripts/rotate-qwork-secrets.sh`.
Steps 4–5 are intentionally manual and need coordination.

## Commands (run from qwork-underwriting root)

```bash
bash ../LIFE-SIgnal-sherlock-IQ/QGI-demo/scripts/rotate-qwork-secrets.sh
# …rotate upstream creds, drop new values into .env.local…
git add .gitignore .env.example
git commit -m "chore(security): remove tracked env files, rotate secrets (QGI-DEMO phase 0)"

# then, purge history (choose ONE):
pipx run git-filter-repo --path .env --path .env.local --path .env.loanlogics --invert-paths
# or
bfg --delete-files '.env' --delete-files '.env.local' --delete-files '.env.loanlogics'

git push --force origin main
```

## Do NOT skip this before a client demo

Any incoming security questionnaire (SIG-Lite, CAIQ, whatever Supreme uses)
includes "do you commit secrets to source control?". A `git log -p -- .env`
turning up keys is an instant finding.
