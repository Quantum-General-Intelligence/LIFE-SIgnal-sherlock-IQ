# Wiring the Social Verification tab into `LoanDetail.tsx`

Three edits inside `src/vertical/pages/LoanDetail.tsx`. Feature-flagged on
`VITE_QGI_DEMO_SOCIAL_VERIFY`, so nothing changes for other builds.

## 1. Imports (near the existing `AgentInsightPanel` import, ~line 48)

```tsx
import { SocialVerificationTab } from "@/vertical/components/SocialVerificationTab";
import { isSocialVerifyEnabled } from "@/vertical/lib/lsiqClient";
```

## 2. `TabsList` (around line 551-565)

Current:

```tsx
<Tabs defaultValue="summary" className="w-full">
  <TabsList className="glass-card grid w-full grid-cols-3 md:grid-cols-9">
    <TabsTrigger value="summary">Summary</TabsTrigger>
    …
    <TabsTrigger value="activity">Activity</TabsTrigger>
  </TabsList>
```

Change to:

```tsx
<Tabs defaultValue="summary" className="w-full">
  <TabsList
    className={`glass-card grid w-full grid-cols-3 ${
      isSocialVerifyEnabled() ? "md:grid-cols-10" : "md:grid-cols-9"
    }`}
  >
    <TabsTrigger value="summary">Summary</TabsTrigger>
    <TabsTrigger value="conditions">Conditions</TabsTrigger>
    <TabsTrigger value="notes">Notes</TabsTrigger>
    <TabsTrigger value="financials">Financials</TabsTrigger>
    <TabsTrigger value="compliance">Compliance</TabsTrigger>
    <TabsTrigger value="documents">Documents</TabsTrigger>
    <TabsTrigger value="comparison">Rules</TabsTrigger>
    <TabsTrigger value="ns-analysis" className="gap-1">
      <Brain className="h-3 w-3" />
      Analysis
    </TabsTrigger>
    {isSocialVerifyEnabled() && (
      <TabsTrigger value="social" className="gap-1">
        <Sparkles className="h-3 w-3" />
        Social
      </TabsTrigger>
    )}
    <TabsTrigger value="activity">Activity</TabsTrigger>
  </TabsList>
```

(Add `Sparkles` to the existing `lucide-react` import line.)

## 3. `TabsContent` — insert right before the `activity` tab content (around line 1370)

```tsx
{isSocialVerifyEnabled() && (
  <TabsContent value="social" className="space-y-4">
    <SocialVerificationTab
      loanId={loanId!}
      borrowerId={loan?.primary_borrower_id /* or whatever your field is */}
      defaultUsername={loan?.primary_borrower_handle /* optional */}
      loanFacts={{
        fico: loan?.fico,
        dti: loan?.dti,
        ltv: loan?.ltv,
        aus_verdict: loan?.aus_verdict,
        self_employed: loan?.self_employed,
        declared_business_type: loan?.declared_business_type,
      }}
    />
  </TabsContent>
)}
```

`loanFacts` is optional — omit it to run the scorecard with neutral
defaults. When present, it flows into the `secondlooksym` agent panel
and drives the actual recommendation.

If `loan` doesn't have a borrower-handle column yet, just pass
`defaultUsername={undefined}` — the officer types the handle in the panel
for the demo.

## How to verify

1. Set `VITE_QGI_DEMO_SOCIAL_VERIFY=true` in `.env.local`.
2. Start LSIQ in another terminal:
   ```bash
   LSIQ_CORS_ORIGINS="http://localhost:5173" \
   LSIQ_AUTH_TOKEN="demo-dev-token-123" \
   qgi-life-signals-iq-web --host 127.0.0.1 --port 8765
   ```
3. `npm run dev` the qwork app.
4. Open any loan → new "Social" tab is visible → type `pg`, hit *Run discovery*.
5. Tiles stream in. When the run finishes a row lands in
   `public.social_verifications` and an activity entry appears on the
   Activity tab: `social_verification_run`.

## Turning the tab off

Leave `VITE_QGI_DEMO_SOCIAL_VERIFY` unset or set it to anything other than
`true`. The tab trigger and content are both absent — zero footprint.
