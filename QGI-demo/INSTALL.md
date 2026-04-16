# QGI-DEMO — Install Guide (Phase 0 + 1 + 2 + 3)

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

# Client + components + consent helpers (phase 3)
cp -v "$OVERLAY/src/vertical/lib/lsiqClient.ts"                    src/vertical/lib/
cp -v "$OVERLAY/src/vertical/lib/qgiAgents.ts"                     src/vertical/lib/
cp -v "$OVERLAY/src/vertical/lib/socialConsent.ts"                 src/vertical/lib/
cp -v "$OVERLAY/src/vertical/components/SocialDiscoveryPanel.tsx"  src/vertical/components/
cp -v "$OVERLAY/src/vertical/components/SocialConsentDialog.tsx"   src/vertical/components/
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

## Phase 3 — Compliance polish

Phase 3 adds a hard-stop **borrower consent** gate and a permanent
adverse-action disclaimer on the scorecard panel. Nothing runs until
consent is recorded.

### 3.1 What phase 3 changes

- `SocialConsentDialog` — one-screen dialog rendering the current
  consent copy, version-stamped with `CONSENT_TEXT_VERSION`.
- `socialConsent.ts` — Supabase helpers: fetch active consent, sign,
  revoke. Each sign/revoke writes a `loan_activity_log` row
  (`social_verification_consent_signed` / `_revoked`).
- `SocialVerificationTab` — shows a **Consent required / Consent on
  file** card above Discovery. Discovery + both agent panels refuse
  to run without a valid consent; the dialog auto-opens when an
  officer tries.
- Every `social_verifications` insert now carries `consent_id`, which
  foreign-keys to `public.social_consents` (already in the migration).
- Permanent **ScorecardDisclaimer** card at the bottom of the tab —
  additive-only, human underwriter is the decision-maker, FCRA/ECOA
  adverse-action language.

### 3.2 Re-copy the overlay if you already applied phases 1–2

```bash
OVERLAY="../LIFE-SIgnal-sherlock-IQ/QGI-demo/qwork-overlay"
cp -v "$OVERLAY/src/vertical/lib/socialConsent.ts"               src/vertical/lib/
cp -v "$OVERLAY/src/vertical/components/SocialConsentDialog.tsx" src/vertical/components/
cp -v "$OVERLAY/src/vertical/components/SocialDiscoveryPanel.tsx" src/vertical/components/   # added disabled props
cp -v "$OVERLAY/src/vertical/components/SocialVerificationTab.tsx" src/vertical/components/
```

No new Supabase migration or env var is needed — `social_consents` +
`social_verifications.consent_id` shipped in the phase-0 migration on
purpose so phase 3 is a pure front-end change.

### 3.3 Bumping consent copy later

When you change the wording in `SocialConsentDialog.tsx`, bump
`CONSENT_TEXT_VERSION` in `socialConsent.ts`. The next time any
officer opens the tab on a loan, `fetchActiveConsent` will treat the
old version as stale and show the consent card again. Prior rows
remain for the audit trail.

### 3.4 End-to-end demo flow (phase 0 + 1 + 2 + 3)

1. Officer opens the loan → **Social** tab → sees an amber "Borrower
   consent required" card. Run buttons are disabled.
2. Clicks *Record borrower consent* → dialog renders the full purpose
   statement with version stamp. Ticks the box, clicks *Record*.
3. Card flips to green "Consent on file · v2026-04-01". Discovery +
   both agents unlock.
4. Runs discovery → QSS → Second-Look as in phase 2.
5. Scorecard panel renders with the adverse-action **disclaimer card**
   below it: additive-only, human underwriter decides.
6. **Activity** tab now shows, in order:
   - `social_verification_consent_signed`
   - `social_verification_run`
   - `social_verification_qss_run`
   - `social_verification_second_look_run`
7. Supabase Studio → `public.social_consents` has the new row;
   `public.social_verifications.consent_id` points to it.

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
- [ ] Without consent, *Run discovery* / *Run socialsym* / *Run secondlooksym* are all disabled.
- [ ] Consent dialog writes one row to `public.social_consents` and logs `social_verification_consent_signed`.
- [ ] `social_verifications.consent_id` is non-null on every phase-3 run.
- [ ] Revoking consent logs `social_verification_consent_revoked` and re-disables the run buttons.
- [ ] Scorecard panel has a permanent "Not an underwriting decision" disclaimer card.

---

## Rollback

1. Delete the overlay files from qwork (`socialConsent.ts`,
   `SocialConsentDialog.tsx`, the two Social components, `lsiqClient.ts`,
   `qgiAgents.ts`).
2. Revert the three `LoanDetail.tsx` hunks.
3. `supabase migration down` on `20260620_qgi_social_verification.sql`.
4. Unset the `VITE_QGI_DEMO_*` and `LSIQ_*` env vars.

Nothing else is touched.
