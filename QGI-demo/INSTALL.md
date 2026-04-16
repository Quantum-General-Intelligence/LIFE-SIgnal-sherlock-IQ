# QGI-DEMO — Install Guide (Phase 0 + 1)

Assumes both repos live side-by-side:

```
workspace/
├── LIFE-SIgnal-sherlock-IQ/      ← this repo (contains QGI-demo/)
└── qwork-underwriting/           ← private, receives the overlay
```

Total time if nothing goes sideways: **~45 minutes**, most of which is
credential rotation.

---

## Phase 0 — Plumbing

### 0.1 Life-Signals-IQ: CORS + bearer auth (already done in this repo)

The FastAPI app now reads these env vars:

| Var                       | Effect                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| `LSIQ_CORS_ORIGINS`       | Comma-separated exact origins (preferred).                       |
| `LSIQ_CORS_ORIGIN_REGEX`  | Optional regex, e.g. `^https://qwork-.*\.vercel\.app$`.          |
| `LSIQ_AUTH_TOKEN`         | When set, gates `/api/*` (except `/api/health`, `/api/meta`).    |
| `LSIQ_HOST`, `LSIQ_PORT`  | Used by the CLI launcher.                                        |

See `LIFE-SIgnal-sherlock-IQ/.env.example`. Local dev run:

```bash
cd LIFE-SIgnal-sherlock-IQ
cp .env.example .env
# fill in LSIQ_AUTH_TOKEN (or leave empty for no-auth dev)
export $(grep -v '^#' .env | xargs)
qgi-life-signals-iq-web --host 127.0.0.1 --port 8765
```

Smoke test:

```bash
curl -s http://127.0.0.1:8765/api/meta | jq .
#   "auth_required": true,
#   "cors_configured": true
```

### 0.2 Rotate qwork's committed secrets

**Read `docs/security-hygiene.md` first.** Then, from the qwork repo:

```bash
bash ../LIFE-SIgnal-sherlock-IQ/QGI-demo/scripts/rotate-qwork-secrets.sh
# rotate upstream creds, drop new values into .env.local
git add .gitignore .env.example
git commit -m "chore(security): remove tracked env files, rotate secrets (QGI-DEMO phase 0)"
```

History purge (force-push + re-clone) is documented in the security doc
and intentionally NOT automated — coordinate with the team first.

### 0.3 Copy qwork overlay files

From the `qwork-underwriting` repo root:

```bash
OVERLAY="../LIFE-SIgnal-sherlock-IQ/QGI-demo/qwork-overlay"

# Supabase migration
cp -v "$OVERLAY/supabase/migrations/20260620_qgi_social_verification.sql" \
      supabase/migrations/

# Client + components
cp -v "$OVERLAY/src/vertical/lib/lsiqClient.ts"                    src/vertical/lib/
cp -v "$OVERLAY/src/vertical/components/SocialDiscoveryPanel.tsx"  src/vertical/components/
cp -v "$OVERLAY/src/vertical/components/SocialVerificationTab.tsx" src/vertical/components/

# Env example
cp -v "$OVERLAY/.env.qgi.example" .env.qgi.example
```

### 0.4 Append QGI env vars to qwork `.env.local`

```bash
cat .env.qgi.example >> .env.local
# then edit .env.local and set VITE_LSIQ_TOKEN to match LSIQ_AUTH_TOKEN
```

### 0.5 Apply the Supabase migration

Local Supabase:

```bash
supabase db reset    # or: supabase migration up
```

Remote project: push via the Supabase dashboard, `supabase db push`, or
the MCP tool — whichever is standard in your team.

---

## Phase 1 — Discovery tab

### 1.1 Wire the tab into LoanDetail

Follow `docs/wire-into-loan-detail.md` — three small edits (imports,
TabsList, TabsContent). Feature-flagged on `VITE_QGI_DEMO_SOCIAL_VERIFY`.

### 1.2 Run it

Terminal A (this repo):

```bash
LSIQ_CORS_ORIGINS="http://localhost:5173" \
LSIQ_AUTH_TOKEN="demo-dev-token-123" \
qgi-life-signals-iq-web --host 127.0.0.1 --port 8765
```

Terminal B (qwork repo):

```bash
npm run dev
```

### 1.3 Demo flow

1. Login to qwork as a user with `loans.underwrite` permission.
2. Open any loan → new **Social** tab.
3. Enter a handle (`pg`, `alice`, whatever) → *Run discovery*.
4. Watch tiles stream in.
5. Open the **Activity** tab → see the `social_verification_run` entry.
6. In Supabase Studio → `public.social_verifications` → one row with the
   full `discovery_json` payload.

---

## Acceptance checklist

- [ ] `curl /api/meta` shows `auth_required: true`, `cors_configured: true`.
- [ ] `curl /api/sites` returns `401` without token, `200` with token.
- [ ] Browser console shows no CORS errors when the tab streams.
- [ ] `social_verifications` row is created on every run.
- [ ] `loan_activity_log` row with `action = social_verification_run` appears.
- [ ] Turning `VITE_QGI_DEMO_SOCIAL_VERIFY=false` hides the tab entirely.
- [ ] No committed `.env*` files in either repo's `git status`.

---

## Rollback

1. Delete the three overlay files from qwork.
2. Revert the three `LoanDetail.tsx` hunks.
3. `supabase migration down` on `20260620_qgi_social_verification.sql`.
4. Unset the `VITE_QGI_DEMO_*` and `LSIQ_*` env vars.

Nothing else is touched.
