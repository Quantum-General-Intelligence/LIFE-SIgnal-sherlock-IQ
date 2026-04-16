# Integration Notes — `qwork-underwriting` + `QGI Life-Signals-IQ` + QSS

_Companion to `plan-second-look-underwriting.md`._
_Reviewed against `Quantum-General-Intelligence/qwork-underwriting` @ `main`
(commit `40e0a95`, core `0.3.0`)._

---

## 1. TL;DR — what the Supreme Lending demo should actually be

**Do not build a standalone officer UI in Python/Jinja on top of Life-Signals-IQ.**

`qwork-underwriting` is already the loan-officer cockpit. It's a React + Vite +
Supabase vertical on top of `@quantum-general-intelligence/core` with:

- Full loan lifecycle (Add → Pipeline → LoanDetail with 9 tabs)
- Borrowers, properties, encrypted PII, RLS, audit log, RBAC via `PermissionGate`
- Amortization, APR, closing costs, HMDA, QM, disclosure tracker
- Guideline engines for Fannie Mae, Freddie Mac, FHA, VA
- NeuroSymbolic agents (`urwsym`, `satsym`, `causalsym`, `factsym`, `checksym`)
  rendered through a reusable `AgentInsightPanel`

The correct demo is: **qwork-underwriting is the product Supreme sees. QGI
Life-Signals-IQ is a microservice qwork calls. QSS is a new NS agent
(`socialsym`) that slots into the existing agent pattern.** One new tab on
`LoanDetail` — "Social Verification" — is where it all surfaces.

This also means the client sees a real loan-management app, not a one-screen
prototype; the new capability lands inside a workflow they already recognize.

---

## 2. Architecture (revised for the real world)

```
┌──────────────────────────────────────────────────────────────────────┐
│  qwork-underwriting  (React/Vite, Supabase, @qgi/core)               │
│  ────────────────────────────────────────────────────────────        │
│  LoanDetail.tsx                                                       │
│   ├─ tab: Summary    Conditions  Notes  Financials  Compliance        │
│   ├─ tab: Documents  Rules  NS Analysis  Activity                     │
│   └─ tab: Social Verification  ◄── NEW                                │
│         ├─ DiscoveryPanel  (SSE from Life-Signals-IQ)                │
│         ├─ AgentInsightPanel  "socialsym (QSS)"  (from core/agents)  │
│         └─ AgentInsightPanel  "secondlooksym"   (scorecard agent)    │
└───────────────┬──────────────────────────────┬───────────────────────┘
                │                              │
                │ fetch / SSE                  │ callAgent("socialsym")
                ▼                              ▼
┌──────────────────────────────┐   ┌───────────────────────────────────┐
│ Life-Signals-IQ (this repo)  │   │ @qgi/core agents service          │
│ FastAPI, SSE, site manifests │   │ (existing infrastructure)          │
│                              │   │                                    │
│ /api/search/stream           │   │ socialsym    ◄── wraps QSS stub   │
│ /api/cases/* (new)           │   │ secondlooksym ◄── scorecard agent │
└──────────────────────────────┘   └────────┬──────────────────────────┘
                                            │
                                            │ (QSS interface — pluggable)
                                            ▼
                                   ┌──────────────────┐
                                   │ QSSProvider      │
                                   │ • Stub (demo)    │
                                   │ • HTTP (pilot)   │
                                   │ • Quantum (prod) │
                                   └──────────────────┘
```

Key properties:

- Life-Signals-IQ stays a clean, ops-ownable microservice with one job:
  probe declared handles and return structured signals over HTTP/SSE.
- All user-facing UI lives in qwork.
- QSS lives behind the same agent interface the qwork team already knows
  (`AgentInsightPanel`, `callAgent`, `run*` / `preview*` helpers).
- Scorecard (second-look, additive-only) is another agent, so the same
  explainability UI works for it.

---

## 3. Where each piece plugs in (file-level)

### 3.1 qwork-underwriting (React side)

**New file: `src/vertical/pages/SocialVerification.tsx` (tab content)**
Or: extend `LoanDetail.tsx` with a new `<TabsTrigger value="social">`.

Inside, render three stacked panels:

1. **Declared handles editor.** Reads from borrower record; officer adds/edits.
   Writes to a new Supabase column on `borrowers` or to a dedicated
   `borrower_social_handles` table.
2. **Discovery panel (SSE).** New thin React component that subscribes to
   `${VITE_LSIQ_URL}/api/search/stream?username=…&sites=…` and tiles live
   results using existing shadcn `Badge`/`Card` primitives. Optional —
   officer can collapse it and go straight to the agent view.
3. **`socialsym` agent panel.** Uses existing `AgentInsightPanel` exactly
   like the NS panels in `LoanDetail.tsx`:

   ```tsx
   <AgentInsightPanel
     title="Quantum Social Signals"
     description="Consented verification of declared handles"
     agentId="socialsym"
     icon={<Sparkles className="h-4 w-4 text-primary" />}
     accentColor="primary"
     getRequestPreview={() => previewSocialSignals(loanData, socialInput)}
     onRun={(onProgress) => runSocialSignals(loanData, socialInput, onProgress)}
     defaultOpen
   />
   ```

4. **`secondlooksym` agent panel.** Same pattern, renders additive-only
   scorecard output with feature attribution:

   ```tsx
   <AgentInsightPanel
     title="Second-Look Recommendation"
     description="Additive-only. Can upgrade outcomes, never downgrade."
     agentId="secondlooksym"
     icon={<Scale className="h-4 w-4 text-secondary" />}
     accentColor="secondary"
     getRequestPreview={() => previewSecondLook(loanData, socialResults)}
     onRun={runAndSaveComparison("second_look_json",
       (onProgress) => runSecondLook(loanData, socialResults, onProgress))}
   />
   ```

**New file: `src/vertical/lib/lsiqClient.ts`**
Thin wrapper around Life-Signals-IQ endpoints:

```ts
export function openSocialStream(
  username: string,
  sites: string[],
  onEvent: (ev: SSEEvent) => void
): () => void { /* EventSource wiring */ }

export async function runSocialDiscovery(
  username: string,
  sites: string[],
  opts?: { timeout?: number; includeNsfw?: boolean }
): Promise<SocialDiscoveryResult> { /* POST /api/search */ }
```

Env: `VITE_LSIQ_URL` (default `http://localhost:8765`),
`VITE_LSIQ_TOKEN` (bearer if we gate the service).

**New file: `src/vertical/components/SocialDiscoveryPanel.tsx`**
Reuses the UX vocabulary of Life-Signals-IQ's standalone UI but styled
to qwork — cards with `Claimed / Available / WAF` badges, evidence links.

**Update: `src/vertical/index.ts`**
No new top-level route needed; the tab lives inside `/loan/:loanId`.
If you want a dashboard card, add a route later.

**Update: Supabase module nav_config** — optional pipeline filter
"Social-verified lifts" if you want to surface the metric up front.

### 3.2 qwork-underwriting (Supabase side)

Add one migration `supabase/migrations/20260620_social_verification.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.social_verifications (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id          text NOT NULL REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  borrower_id      uuid REFERENCES public.borrowers(id) ON DELETE SET NULL,
  declared_handles jsonb NOT NULL,               -- {github: "…", linkedin: "…"}
  discovery_json   jsonb,                         -- Life-Signals-IQ results
  qss_provider     text,                          -- 'stub' | 'http' | 'quantum-v1'
  qss_version      text,
  qss_signals      jsonb,                         -- QSSResponse.signals
  second_look_json jsonb,                         -- scorecard output
  consent_id       uuid,                          -- link to a consent record
  created_at       timestamptz DEFAULT now(),
  created_by       uuid
);
CREATE INDEX IF NOT EXISTS idx_social_verif_loan ON public.social_verifications(loan_id);
ALTER TABLE public.social_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loan-scoped" ON public.social_verifications
  FOR ALL USING (true) WITH CHECK (true);    -- tighten in pilot
```

And a consent table mirroring what the Life-Signals-IQ plan proposed:

```sql
CREATE TABLE IF NOT EXISTS public.social_consents (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id       text REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  borrower_id   uuid REFERENCES public.borrowers(id) ON DELETE CASCADE,
  purpose       text NOT NULL,
  text_version  text NOT NULL,
  signed_at     timestamptz NOT NULL,
  signed_by_ip  inet,
  signed_by_ua  text,
  revoked_at    timestamptz
);
```

Wire `logActivity(loanId, "social_verification_run", {...})` into the
lib call so it lands in the existing `loan_activity_log` / ActivityTimeline.

### 3.3 `@quantum-general-intelligence/core` (core agents)

Two new agent IDs to add to the core catalogue. Owner: the core team.
Until they're published in a new core release, qwork can shim them in
the vertical's own `src/vertical/lib/agents.ts` with the same signatures:

```ts
// preview fns (pure, used by AgentInsightPanel "show request" view)
previewSocialSignals(loan: LoanData, social: SocialInput): AgentRequest
previewSecondLook(loan: LoanData, socialResults: QSSResponse): AgentRequest

// run fns (call the agent service; qwork already knows this pattern)
runSocialSignals(loan, social, onProgress?): Promise<AgentResult>
runSecondLook(loan, socialResults, onProgress?): Promise<AgentResult>
```

Internally `socialsym` calls Life-Signals-IQ for discovery (or accepts
discovery results inline), then invokes the selected `QSSProvider`.
`secondlooksym` is pure: it runs the YAML scorecard rules over
`QSSResponse.signals + loan facts` and emits the additive-only decision.

### 3.4 Life-Signals-IQ (this repo)

Minimum changes to make it demo-ready as a qwork backend:

1. **CORS middleware.** Allow `VITE_*` origin — the React app calls from
   a browser.
2. **Bearer auth (env-gated).** `LSIQ_AUTH_TOKEN=…` header check on
   `/api/search*` and `/api/cases*`. Off by default; on for pilot.
3. **Case endpoints** per the standalone plan (`/api/cases/*`).
4. **QSS adapter endpoints** — optional if we keep QSS behind core's
   agent service; keep them for integration tests and local dev.
5. **Docker image** — `Dockerfile.web` that runs `qgi-life-signals-iq-web`;
   makes it trivial for qwork's compose stack to include the service.
6. **Healthcheck + `/api/meta`** already present.

No internal Sherlock logic changes — all additive, behind a thin layer.

---

## 4. The QSS interface (unchanged from standalone plan)

Same protocol (`QSSProvider` / `QSSRequest` / `QSSSignal` / `QSSResponse`)
as written in `plan-second-look-underwriting.md §5`. It lives in
Life-Signals-IQ's Python side for local runs **and** is mirrored as a
TypeScript type in `@qgi/core/agents` so qwork can strongly type responses
without a codegen step. Keep the field names identical.

Three provider bindings as before (`stub`, `http`, `quantum`). Selection
via env `QSS_PROVIDER` on whichever side runs the agent.

---

## 5. The revised demo script for Supreme Lending

1. **Open qwork-underwriting.** Login as a loan officer; sidebar shows
   Dashboard, Pipeline, Loans, Borrowers, etc. (their world.)
2. **Open a real-looking loan record.** LoanDetail with FICO, DTI, LTV,
   AUS verdict `DENY`, true verdict `APPROVE` (i.e. a false-negative case —
   the sweet spot for second-look underwriting).
3. **Switch to the new "Social Verification" tab.**
   - Officer sees declared handles editor (seeded from the borrower record).
   - Officer ticks the consent box, hits _Run discovery_.
   - Discovery panel lights up with Life-Signals-IQ SSE tiles.
4. **Expand the `socialsym` agent panel.**
   - Panel shows request preview (auditable), run button, progress bar.
   - On run, emits `QSSSignal` tiles: `role_consistency: confirmed`,
     `business_footprint_age: confirmed (24mo Yelp)`, etc. Badge reads
     `provider: stub` — say so explicitly.
5. **Expand the `secondlooksym` agent panel.**
   - Runs the additive-only scorecard. Result card: `APPROVE LIFT +34 / 25`
     with feature rows and reasons. Disclaimer banner visible.
6. **Flip to the "Activity" tab.**
   - `social_verification_run` event is in the audit log with timestamp,
     actor, provider version. Screenshot for the compliance officer.
7. **Flip to the "Rules" / "NS Analysis" tab.**
   - Show that `secondlooksym` lives alongside `urwsym`, `satsym`, etc.
     Same pattern. Same explainability. Same guardrails.
8. **Close with the compliance triangle slide.**
   - Consent, additive-only, human-in-the-loop. Same as the standalone
     deck.

The money-quote is now much stronger: *"What you just saw is the entire
loan-management platform you'd roll out day one. Social Verification is
one tab — the Quantum Social Signals piece behind it is the only module
we're swapping between demo and production."*

---

## 6. Phased delivery, revised

**Phase 0 — Plumbing (½ day)**
- Life-Signals-IQ: CORS + bearer auth env gate; `Dockerfile.web`.
- qwork: `VITE_LSIQ_URL` env wiring; `lsiqClient.ts` skeleton.
- Supabase: `social_verifications` + `social_consents` migrations.

**Phase 1 — Discovery tab (½ day)**
- `SocialDiscoveryPanel.tsx` (SSE tiles).
- New LoanDetail tab "Social Verification" behind a feature flag.
- Writes discovery results to `social_verifications.discovery_json`.

**Phase 2 — QSS agent + scorecard (1 day)**
- Stub `QSSProvider` in Python (same module as standalone plan).
- `socialsym` + `secondlooksym` shims in qwork `lib/agents.ts`.
- Two `AgentInsightPanel` panels on the tab.
- Writes `qss_signals` + `second_look_json`.
- Scorecard invariant tests (Python side).

**Phase 3 — Compliance polish (½ day)**
- Consent capture dialog + `social_consents` row.
- `logActivity` wiring so Activity tab shows runs and revocations.
- Footer disclaimer on scorecard panel.
- Provider version badge everywhere a QSS result is shown.

**Phase 4 — Real QSS handoff (¼ day, when algo ready)**
- Switch `QSS_PROVIDER=http` and point at your team's service.
- No qwork changes.

Demo-ready to Supreme after phases 0–3: **~2.5 days of build**.

---

## 7. Things I flagged while reading the repo

1. **`.env` and `.env.local` are committed to the repo** with real-looking
   Supabase anon keys, GitHub client ID, E2B API key, LlamaParse API key.
   The commit message on `da16731` literally warns against this. Even if
   these are dev-only values, this will get raised by any client security
   review. Recommend rotating those secrets and adding them back to
   `.gitignore` **before** the Supreme demo.
2. **Core is `^0.3.0` pinned via GitHub Packages.** Any new agent IDs for
   `socialsym` / `secondlooksym` should land in core first so qwork's
   `package.json` bump is clean. Until then, shim them in the vertical.
3. **`json-rules-engine` is already a dependency.** If we want the
   scorecard to be declarative on the JS side as well (not just YAML in
   Python), we can reuse that engine for `secondlooksym`. Nice synergy.
4. **`PermissionGate` pattern is already in use** — wrap the new tab's
   "Run discovery" button with `require="loans.underwrite"` or a new
   `loans.social_verify` permission to seed in the phase-4 role migration.
5. **`logActivity` exists** — no need for a separate audit store in qwork;
   reuse `loan_activity_log`. Life-Signals-IQ still keeps its JSONL mirror
   for ops.
6. **`AgentInsightPanel` is an outstanding fit** for the scorecard output
   because it already supports request-preview, progress, formatted
   output, and copy-to-clipboard. Nothing bespoke needed.

---

## 8. Decisions still needed (updated)

Same list as `plan-second-look-underwriting.md §11`, plus:

7. Do new agent IDs ship in `@qgi/core` first, or shim in qwork for demo
   and upstream later?
8. Does Life-Signals-IQ get its own service in qwork's docker-compose,
   or is it deployed separately (Fly.io, Render, etc.)?
9. Should Social Verification tab be gated by a feature flag so Supreme
   can see it but other clients don't yet?
10. Co-brand in qwork header for the demo build (`buildForLL` pattern
    already exists in `package.json` — add `buildForSupreme`)?

---

## 9. Files referenced

- qwork: `src/vertical/index.ts`
- qwork: `src/vertical/pages/LoanDetail.tsx`
- qwork: `src/vertical/components/AgentInsightPanel.tsx`
- qwork: `supabase/migrations/20260330_phase1_data_model.sql`
- qwork: `docs/IMPLEMENTATION_PLAN.md`
- this repo: `docs/plan-second-look-underwriting.md`
- this repo: `sherlock_project/web/app.py`
