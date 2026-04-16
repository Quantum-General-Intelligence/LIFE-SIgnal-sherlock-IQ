# QGI-DEMO — Social Verification Overlay for qwork-underwriting

> **Status:** Phase 0 + Phase 1 scaffold. Dev-env only. Client brand is intentionally neutral: **QGI-DEMO**.

This folder contains everything that needs to land in the private
`qwork-underwriting` repo to add a **Social Verification** tab to the
loan-officer cockpit, wired to **QGI Life-Signals-IQ** (this repo) as a
microservice.

- Life-Signals-IQ = this repo. Runs as a local FastAPI service.
- qwork-overlay = ready-to-copy files for `Quantum-General-Intelligence/qwork-underwriting`.
- The final demo experience lives inside qwork; LSIQ is never shown directly to the client.

## What's in here

```
QGI-demo/
├── README.md                                  ← you are here
├── INSTALL.md                                 ← step-by-step apply guide
├── qwork-overlay/                             ← copy into qwork-underwriting/
│   ├── .env.qgi.example                       ← new env vars for qwork
│   ├── supabase/migrations/
│   │   └── 20260620_qgi_social_verification.sql
│   └── src/vertical/
│       ├── lib/
│       │   ├── lsiqClient.ts                  ← LSIQ HTTP/SSE client + QSS types
│       │   └── qgiAgents.ts                   ← socialsym + secondlooksym shims
│       └── components/
│           ├── SocialDiscoveryPanel.tsx       ← phase 1 SSE tile grid
│           └── SocialVerificationTab.tsx      ← tab + 2 AgentInsightPanel panels
├── scripts/
│   └── rotate-qwork-secrets.sh                ← phase-0 secret rotation
└── docs/
    ├── wire-into-loan-detail.md               ← patch instructions for LoanDetail.tsx
    └── security-hygiene.md                    ← committed-secrets cleanup
```

## Phases represented here

- [x] **Phase 0 — Plumbing.** LSIQ CORS + bearer auth (done in this repo's `sherlock_project/web/app.py`), env wiring, secret rotation, Supabase migrations.
- [x] **Phase 1 — Discovery tab.** SSE-driven tile panel, new LoanDetail tab behind feature flag `VITE_QGI_DEMO_SOCIAL_VERIFY`, persists discovery results to `social_verifications.discovery_json`.
- [x] **Phase 2 — QSS agent + scorecard.** Python QSS module (`sherlock_project/web/qss/`), two `AgentInsightPanel` panels wired into the tab (`socialsym`, `secondlooksym`), `qgiAgents.ts` shim, additive-only scorecard with 642 invariant tests passing.
- [ ] **Phase 3 — Compliance polish.** Consent dialog, activity wiring, disclaimer banners.
- [ ] **Phase 4 — Real QSS handoff.** Flip `QSS_PROVIDER=http`.

## Design choices (from the Apr 16 decisions)

1. **Shim agents inside qwork vertical** for the demo; upstream to `@qgi/core` later.
2. **QSS runs in-process inside Life-Signals-IQ** (Python) behind a `QSSProvider` interface.
3. **Dev-env only.** No Docker/compose yet.
4. **Client-neutral branding.** Everything says `QGI-DEMO` — swap in the real client name before pitch day.
5. **Secret rotation is part of phase 0** (see `scripts/rotate-qwork-secrets.sh`).

## Start here

Read `INSTALL.md`.
