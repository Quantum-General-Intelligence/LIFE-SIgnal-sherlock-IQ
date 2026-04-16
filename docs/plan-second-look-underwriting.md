# Second-Look Underwriting Demo Plan — with Quantum Social Signals (QSS)

_Status: planning, approved for build pending client demo prep._
_Owner: QGI. Depends on `QGI Life-Signals-IQ` (this repo)._

---

## 1. Goal (demo end-state)

A thin, demo-ready **Second-Look Underwriting** layer on top of the existing
`QGI Life-Signals-IQ` web app. A loan officer can:

1. Start a **Second-Look case** — enter declared facts (handles, role, city,
   business name).
2. Trigger **Verification** — the app probes declared handles (existing engine)
   **and** calls a **QSS adapter** for content-level signals.
3. See a **Scorecard** — additive points only, with feature attribution.
4. Render an **Officer Decision View** — approve-lift recommendation,
   never a decline.
5. Inspect an **Audit Log** entry for that case.

QSS is **not implemented** in this phase. It is wired in as a pluggable
strategy with:

- A documented interface (`QSSProvider`)
- A **stub provider** that returns deterministic fake-but-plausible signals
  for the demo
- A switch to point at the real QSS algo when it is delivered
  (in-process, HTTP microservice, or gRPC — decision open)

Result: client demo is live today; the real QSS slots in later with zero
changes to the surrounding stack.

---

## 2. Architecture (target)

```
                        ┌─────────────────────────────────────┐
                        │        Loan Officer UI              │
                        │  /officer  (new SPA views)          │
                        └──────┬────────────────────┬─────────┘
                               │                    │
          ┌────────────────────▼────┐   ┌───────────▼───────────┐
          │  FastAPI existing app   │   │  FastAPI new routers  │
          │  /api/search (kept)     │   │  /api/cases           │
          │  /api/search/stream     │   │  /api/cases/{id}/...  │
          └────────────────────┬────┘   └───────────┬───────────┘
                               │                    │
                     ┌─────────▼──────────┐  ┌──────▼────────────────┐
                     │ Sherlock engine    │  │ Scorecard engine      │
                     │ (unchanged)        │  │ (additive, explainable│
                     └─────────┬──────────┘  └──────┬────────────────┘
                               │                    │
                               │       ┌────────────▼────────────┐
                               │       │ Verification orchestrator│
                               │       │ - probes declared handles│
                               │       │ - calls QSSProvider      │
                               │       │ - writes audit log       │
                               │       └────┬───────────┬─────────┘
                               │            │           │
                               ▼            ▼           ▼
                   ┌────────────────┐  ┌───────────┐  ┌──────────────┐
                   │ Site manifests │  │ QSSProvider│  │ Storage      │
                   │ (existing)     │  │  interface │  │ SQLite(file) │
                   └────────────────┘  │            │  │ + JSONL logs │
                                       │ • Stub     │  └──────────────┘
                                       │ • HTTP (v2)│
                                       │ • Real QSS │
                                       └────────────┘
```

Properties:

- Existing `/api/search` and UI stay **untouched** — the current demo still
  works.
- Everything new lives behind `/api/cases/*` and a new `/officer` page.
- Data is local SQLite + JSONL audit log. No external DB for the demo.
- QSS is one interface with three implementations.

---

## 3. Data model (SQLite, in-repo for demo)

All IDs are UUIDs. Timestamps UTC.

```
consent_records
  id, case_id, applicant_ref (hashed), purpose,
  text_version, signed_at, ip, user_agent, revoked_at

cases
  id, created_at, officer_id, status,
  declared_facts_json,   -- { role, city, business_name, handles{…} }
  bureau_decision,       -- 'approve' | 'decline' | 'refer'
  bureau_reason,
  final_recommendation   -- 'approve_lift' | 'no_lift' | null

verification_results
  id, case_id, source,              -- 'sherlock' | 'qss:<name>'
  signal_key,                       -- e.g. 'linkedin_role_match'
  status,                           -- 'confirmed' | 'inconsistent' | 'unknown'
  evidence_url, evidence_snippet,
  raw_json, created_at

scorecard_runs
  id, case_id, model_version, created_at,
  total_points, threshold, outcome,
  features_json                     -- [{key, value, points, reason}, …]

audit_events
  id, case_id, ts, actor, action, payload_json
```

JSONL audit log mirrors `audit_events` append-only for tamper-evident review.

---

## 4. API surface (new — all under `/api/cases`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/cases` | Create case + capture consent |
| `GET`  | `/api/cases/{id}` | Full case state |
| `POST` | `/api/cases/{id}/verify` | Run verification (sync) |
| `GET`  | `/api/cases/{id}/verify/stream` | SSE: verification events |
| `POST` | `/api/cases/{id}/score` | Run scorecard over current verifications |
| `GET`  | `/api/cases/{id}/audit` | Return audit log for this case |
| `POST` | `/api/cases/{id}/revoke-consent` | Mark consent revoked, redact |
| `GET`  | `/api/qss/health` | QSS provider liveness + version + active impl |

---

## 5. QSS pluggable interface

One Python protocol, three implementations, selected by env var.

### 5.1 Interface

```python
# sherlock_project/web/qss/base.py
from typing import Protocol, Literal

class QSSRequest(BaseModel):
    case_id: str
    declared_facts: dict
    discovered_profiles: list[dict]
    locale_hint: str | None = None

class QSSSignal(BaseModel):
    key: str
    status: Literal['confirmed','inconsistent','unknown']
    confidence: float               # 0..1
    evidence: list[str] = []
    explanation: str
    points_hint: int | None = None

class QSSResponse(BaseModel):
    provider: str                   # 'stub' | 'http' | 'quantum-v1'
    version: str
    signals: list[QSSSignal]
    latency_ms: int
    model_card_url: str | None = None

class QSSProvider(Protocol):
    name: str
    version: str
    def analyze(self, req: QSSRequest) -> QSSResponse: ...
```

### 5.2 Implementations

1. **`StubQSSProvider`** — demo. Deterministic signals from declared facts +
   Sherlock hits. Emits:
   - `role_consistency`
   - `location_consistency`
   - `business_footprint_age`
   - `activity_cadence`
   - `handle_cross_consistency`
2. **`HTTPQSSProvider`** — env `QSS_URL`, `QSS_API_KEY`, `QSS_TIMEOUT_MS`.
   `POST {QSS_URL}/analyze`. One retry, fallback to stub with `unknown`.
3. **`QuantumSocialSignalsProvider`** — placeholder class with
   `NotImplementedError` and docstring describing expected signals.

### 5.3 Selection

Env var `QSS_PROVIDER` = `stub` (default) | `http` | `quantum`.

---

## 6. Scorecard engine (additive-only, explainable)

### 6.1 Config (`sherlock_project/web/scorecard/rules_v1.yaml`)

```yaml
version: "rules_v1"
threshold: 25
features:
  - key: linkedin_role_match
    source: qss.role_consistency
    points_on_confirmed: 8
  - key: business_age_2y
    source: qss.business_footprint_age
    points_on_confirmed: 10
  - key: location_corroborated
    source: qss.location_consistency
    points_on_confirmed: 5
  - key: all_handles_resolved
    source: qss.handle_cross_consistency
    points_on_confirmed: 4
  - key: activity_cadence_healthy
    source: qss.activity_cadence
    points_on_confirmed: 7
```

### 6.2 Invariants (enforced in code and tests)

```python
assert points >= 0
assert total_points >= 0
assert outcome in {'approve_lift','no_lift'}
assert outcome != 'decline'
```

### 6.3 Output

```json
{
  "model_version": "rules_v1",
  "total_points": 34,
  "threshold": 25,
  "outcome": "approve_lift",
  "features": [
    {"key":"linkedin_role_match","status":"confirmed","points":8,
     "reason":"LinkedIn role matches declared role"},
    {"key":"business_age_2y","status":"confirmed","points":10,
     "reason":"Yelp listing age ≥ 24mo"}
  ],
  "disclaimer": "Additive-only. Social signals cannot cause a decline."
}
```

---

## 7. Officer UI (new page `/officer`)

Three screens, Jinja + vanilla JS.

**A — Case intake.** Applicant ref, declared role, city, business name,
declared handles, bureau decision + reason. Required consent checkbox.
Button: _Create case & verify_.

**B — Verification (live).** Two SSE streams side-by-side: Discovery
(Sherlock tiles) and Content signals (QSS tiles). Provider badge shows
`stub` until real QSS is wired. Button: _Run scorecard_.

**C — Recommendation + audit.** Big card (`APPROVE LIFT +34 / 25`),
feature table with reasons, collapsible raw JSON, audit log link,
footer banner: _recommendation, not a decision; human retains authority_.

---

## 8. Compliance scaffolding (demo-grade)

In scope:

- Consent text stored verbatim per version, with ID, timestamp, IP, UA.
- Append-only JSONL audit log per case + mirrored SQLite rows.
- Additive-only invariant enforced by tests + runtime asserts.
- Human-in-the-loop banner on every officer view.
- Revoke-consent endpoint → redact verification rows, keep audit trail.
- Provider transparency — every scorecard run records QSS provider+version.
- No PII over the wire to third parties until real QSS is wired.

Out of scope for this phase (roadmap):

- OAuth connectors (LinkedIn/Plaid/Argyle)
- Full bias-testing harness
- DSAR self-service portal
- SOC 2 controls
- EU AI Act technical documentation

---

## 9. Phased delivery

Each phase is a self-contained PR and independently demoable.

**Phase 1 — Foundation (½ day)**
- SQLite schema + migrations (`sherlock_project/web/db.py`)
- `QSSProvider` protocol + `StubQSSProvider`
- `POST /api/cases`, `GET /api/cases/{id}` with consent capture
- Tests: invariant, stub determinism

**Phase 2 — Verification orchestrator + scorecard (½ day)**
- Verification orchestrator (Sherlock + QSS in parallel)
- `POST /api/cases/{id}/verify` + `/verify/stream` (SSE)
- Scorecard engine + YAML rules + attribution
- Audit log writer
- Tests: all-unknown → `no_lift`; all-confirmed → `approve_lift`;
  no combination yields negative points or `decline`.

**Phase 3 — Officer UI (½ day)**
- `/officer` routes + three screens
- Live SSE integration on verification screen
- Scorecard + audit render
- Brand banner + consent gating

**Phase 4 — QSS integration hooks (¼ day, when algo is ready)**
- `HTTPQSSProvider` with timeout + fallback
- `QuantumSocialSignalsProvider` skeleton
- `QSS_PROVIDER` env switch wired in
- Smoke test against QSS service (or mock)

Demo-ready state after phases 1–3: ~1.5 days of build.

---

## 10. Demo script after this plan ships

1. Open `/officer`, create Maria's case, tick consent, hit _Create & verify_.
2. Both SSE streams light up side-by-side (Discovery + QSS tiles). Provider
   badge clearly shows `stub`.
3. Officer clicks _Run scorecard_. Recommendation card renders:
   `APPROVE LIFT +34 / 25`, feature table, explanations.
4. Click _Audit log_ → JSON drops into view.
5. Show API in Swagger; show compliance rules slide; show roadmap.

Headline: _"This is exactly the architecture; the only piece we're swapping
between today and production is the Quantum Social Signals module behind a
documented interface."_

---

## 11. Open decisions

1. QSS deployment shape for production — in-process Python, HTTP microservice,
   or gRPC?
2. Persistence beyond demo — stay on SQLite for first pilot or move to Postgres?
3. Auth on `/officer` — none (demo), basic-auth env var, or OIDC against
   client IdP?
4. Applicant PII policy for the demo — public-figure handles + fake applicant
   refs by default?
5. Co-branding — "QGI Life-Signals-IQ — Second-Look Underwriting" only, or
   Supreme co-brand?
6. Starting signal list — confirm the five signals above.

---

## 12. Known risks

- **Stub plausibility** — must return mixed results (some `unknown`/
  `inconsistent`), not rosy. Deterministic from declared handles.
- **SSE + threading + SQLite** — fine for demo load, not pilot.
  Flagged in code + roadmap.
- **Revoke-consent vs audit trail** — redact PII in place, log redaction as
  its own event; escalate to legal on real pilot.
- **Scorecard weights without bias tests** — demo illustrative only.
  UI footer states this.

---

## 13. Adjacent repos

- `Quantum-General-Intelligence/qwork-underwriting` (private) — see
  `docs/qwork-integration-notes.md` for how this demo plugs into it.
