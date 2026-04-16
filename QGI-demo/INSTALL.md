# QGI-DEMO — Install Guide (Phase 0 + 1 + 2)

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
cp -v "$OVERLAY/src/vertical/lib/qgiAgents.ts"                     src/vertical/lib/
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

---

## Phase 2 — QSS agent + additive scorecard

Already in place if you applied the overlay above. The tab renders two
additional `AgentInsightPanel`s below the Discovery panel:

- **Quantum Social Signals** (`socialsym`) — posts to `/api/qss/signals`
  with declared handles + discovery hits, returns a list of `QSSSignal`s.
- **Second-Look Recommendation** (`secondlooksym`) — posts to
  `/api/qss/second-look`, returns an additive-only recommendation
  (`approve_lift` / `conditional_lift` / `no_change`).

### 2.1 Pick a QSS provider on LSIQ

```bash
# Default — zero-dependency deterministic stub, suitable for demos.
export QSS_PROVIDER=stub

# Later (phase 4): real algo over HTTP.
# export QSS_PROVIDER=http
# export QSS_HTTP_URL=https://qss.example.com
# export QSS_HTTP_TOKEN=…

qgi-life-signals-iq-web --host 127.0.0.1 --port 8765
```

### 2.2 Pass loan context into the tab (optional but recommended)

In `LoanDetail.tsx`, extend the tab invocation to forward FICO/DTI/LTV/verdict
so the scorecard reasons about the real loan:

```tsx
<SocialVerificationTab
  loanId={loanId!}
  borrowerId={loan?.primary_borrower_id}
  defaultUsername={loan?.primary_borrower_handle}
  loanFacts={{
    fico: loan?.fico,
    dti: loan?.dti,
    ltv: loan?.ltv,
    aus_verdict: loan?.aus_verdict,
    self_employed: loan?.self_employed,
    declared_business_type: loan?.declared_business_type,
  }}
/>
```

Without this, the scorecard still runs but treats everything as neutral
defaults.

### 2.3 Python tests (run from this repo)

```bash
cd LIFE-SIgnal-sherlock-IQ
python3 -m pytest tests/qgi_demo/ -q
# expected: 642 passed
```

The suite exhaustively walks every 5^4 combination of signal outcomes
and asserts the additive-only invariant holds in each one.

### 2.4 End-to-end demo flow (phase 0 + 1 + 2)

1. Officer opens the loan → **Social** tab.
2. Enters handle, hits *Run discovery* → tiles stream in.
3. Expands **Quantum Social Signals** → hits *Run* → QSS signals render.
4. Expands **Second-Look Recommendation** → hits *Run* → scorecard
   returns `approve_lift / conditional_lift / no_change` with feature
   rows and a disclaimer.
5. Flips to **Activity** tab → three audit entries:
   `social_verification_run`, `social_verification_qss_run`,
   `social_verification_second_look_run`.
6. In Supabase Studio → `public.social_verifications` row now carries
   `discovery_json`, `qss_signals`, `second_look_json`.

---

## Acceptance checklist

- [ ] `curl /api/meta` shows `auth_required: true`, `cors_configured: true`.
- [ ] `curl /api/sites` returns `401` without token, `200` with token.
- [ ] Browser console shows no CORS errors when the tab streams.
- [ ] `social_verifications` row is created on every discovery run.
- [ ] After running `socialsym`, the row gains `qss_provider`, `qss_version`, `qss_signals`.
- [ ] After running `secondlooksym`, the row gains `second_look_json`.
- [ ] `loan_activity_log` rows: `social_verification_run`,
      `social_verification_qss_run`, `social_verification_second_look_run`.
- [ ] `pytest tests/qgi_demo/` — 642 passed.
- [ ] Turning `VITE_QGI_DEMO_SOCIAL_VERIFY=false` hides the tab entirely.
- [ ] No committed `.env*` files in either repo's `git status`.

---

## Rollback

1. Delete the three overlay files from qwork.
2. Revert the three `LoanDetail.tsx` hunks.
3. `supabase migration down` on `20260620_qgi_social_verification.sql`.
4. Unset the `VITE_QGI_DEMO_*` and `LSIQ_*` env vars.

Nothing else is touched.
