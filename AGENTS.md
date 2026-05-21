# AGENTS.md — BMEDIS Codebase Reference for AI Agents

Last updated: 2026-05-21 (Hotfix: WO-completion reliability evidence pipeline made unconditional. updateWorkOrderAction now ALWAYS writes a maintenance_events row when a corrective work order completes, deriving missing repair_duration_hours / downtime_start / downtime_end / failure_date / action_taken from the WO's own started_at / completed_at / created_at + actual_hours + originating request created_at via the pure helper src/utils/maintenance/completion-evidence.ts → deriveReliabilityEvidence(). Idempotency: a "completion event" is identified by completion_date IS NOT NULL on the WO row — re-completion UPDATEs that row instead of inserting a duplicate. The Work Order Detail page (src/app/(dashboard)/maintenance/work-orders/[id]/page.tsx) now queries events by work_order_id via getMaintenanceEventsByWorkOrderId() (was: by asset_id, which mixed in unrelated history), reloads events after completion, surfaces a Completed-with-no-evidence amber banner when a corrective WO has zero linked events, and adds an "Action taken / repair summary" textarea that persists to both work_orders.action_taken and the new maintenance_events.action_taken. Hotfix migration 00067 still applies (maintenance_requests UPDATE / work_orders FOR ALL now include bme_head). Next migration is 00068.)
Branch: system_fix
Supabase project ID: fgqyszbxzpmqzpqvdivx

This file is the canonical technical reference for any AI agent working in this repo.
It is automatically updated at the end of every session by the standing instruction in CLAUDE.md.

---

## Stack and exact versions

| Package                  | Version   | Notes                                      |
|-------------------------|-----------|--------------------------------------------|
| next                    | ^16.2.4   | App Router only — NOT Pages Router         |
| react / react-dom       | 19.2.4    |                                            |
| typescript              | ^5        | strict mode enabled                        |
| tailwindcss             | ^4        | v4 — class names differ from v3            |
| @supabase/supabase-js   | ^2.102.1  |                                            |
| @supabase/ssr           | ^0.10.0   |                                            |
| chart.js                | ^4.5.1    | Primary charting library                   |
| react-chartjs-2         | ^5.3.1    | React wrapper for Chart.js                 |
| jspdf                   | ^4.2.1    | PDF export — IS installed and wired        |
| jspdf-autotable         | ^5.0.7    | PDF tables plugin                          |
| date-fns                | ^4.1.0    | Date utilities                             |
| lucide-react            | ^1.7.0    | Icons                                      |
| zod                     | ^4.3.6    | Schema validation                          |
| react-hook-form         | ^7.75.0   | Form state + validation (pair with zod)    |
| html5-qrcode            | ^2.3.8    | QR code scanner via browser camera API     |
| qrcode.react            | ^4.2.0    | QR code generation / display component     |
| exceljs                 | ^4.4.0    | Excel import/export for data migration     |

**recharts is NOT installed.** Do not import from recharts. Use chart.js + react-chartjs-2.
**xlsx is NOT installed** — replaced by exceljs (xlsx had prototype pollution CVE with no fix).

### react-hook-form usage pattern
```ts
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
// zodResolver requires: npm install @hookform/resolvers (install if needed)
```

### exceljs usage pattern (server action or API route only — not client components)
```ts
import ExcelJS from 'exceljs'
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(buffer)
const sheet = workbook.worksheets[0]
```

### html5-qrcode usage pattern (client component only — requires camera API)
```ts
'use client'
import { Html5QrcodeScanner } from 'html5-qrcode'
```

### qrcode.react usage pattern
```ts
import { QRCodeSVG } from 'qrcode.react'
// <QRCodeSVG value={`/inventory/${assetId}`} size={128} />
```

AI provider: Gemini (via /src/services/chatbot/providers/gemini-provider.ts).
No OpenAI dependency exists in this project.

---

## Next.js 16 breaking changes — non-negotiable rules

1. `params` in server components is a Promise. Always await it:
   CORRECT:   const { id } = await params
   WRONG:     const { id } = params

2. `cookies()` and `headers()` are async. Always await them:
   CORRECT:   const cookieStore = await cookies()
   WRONG:     const cookieStore = cookies()

3. Server components fetch data directly — no useEffect, no useState for data:
   CORRECT:   export default async function Page() { const data = await service.get() }
   WRONG:     useEffect(() => { fetch(...) }, [])

4. Server actions require 'use server' directive at the top of the file:
   CORRECT:   'use server'; export async function myAction() {}

5. Client components that use hooks must have 'use client' at the top.
   Do not add 'use client' to server components.

6. Route groups use parentheses: (dashboard) is a layout group, not a URL segment.

7. Dynamic routes with generateMetadata also receive params as a Promise.

---

## Supabase patterns — always follow these

### Client selection (strict rules)
```ts
// Server components and server actions:
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// Client components:
import { createBrowserClient } from '@supabase/ssr'
const supabase = createBrowserClient(...)

// Middleware only:
import { createMiddlewareClient } from '@/lib/supabase/middleware'
```
NEVER create a Supabase client inline. Always use these imports.

### Supabase MCP (configured in .claude/settings.local.json)
The MCP is configured but needs the service role key to activate:
1. Go to: https://supabase.com/dashboard/project/fgqyszbxzpmqzpqvdivx/settings/api
2. Copy the `service_role` secret key
3. Replace `REPLACE_WITH_SERVICE_ROLE_KEY` in `.claude/settings.local.json`
4. Restart Claude Code — the MCP will then enable direct DB queries, migration runs, and data import from Claude

### RLS awareness
- All tables have Row Level Security enabled
- Analytics SQL functions use SECURITY DEFINER to bypass RLS — this is intentional
- Do not disable RLS or add `.options({ count: 'exact' })` workarounds
- seed profiles.user_id = NULL — authenticated queries return empty until linked

### Type safety
- src/types/database.ts is generated by Supabase — do not hand-edit it or place custom app/domain types in it.
- Regenerate current linked schema types with: `npx supabase gen types typescript --linked > src/types/database.ts`
- App-level role types live in `src/types/roles.ts` (`RoleName`, `ROLE_NAMES`). Other app/domain aliases used by services/pages live in `src/types/domain.ts`.
- After Supabase type generation, run `npx tsc --noEmit` and `npm run build`; fix imports by moving/reusing app types outside the generated file, not by editing `src/types/database.ts`.
- Migration 00043 exposes `asset_id` in `v_calibration_due` so calibration and Command Center rows can open exact asset/record drilldowns.
- src/types/supabase.ts may exist from earlier generated output — treat generated type files as generated-only if regenerated.

### RPC calls used in TypeScript
```ts
// Single asset full recompute
supabase.rpc('recompute_equipment_analytics', { p_asset_id: assetId })

// All assets recompute
supabase.rpc('recompute_all_equipment_analytics')

// Refresh decision support snapshots
supabase.rpc('refresh_decision_support_snapshots')

// R5: equipment condition update (SECURITY DEFINER, validates caller role
// against the equipment.condition.update capability allowlist at DB layer)
supabase.rpc('update_equipment_condition_secure', {
  p_asset_id: assetId, p_condition: 'needs_repair'
})

// R4: caller's department_id (used inside RLS policies; rarely needed app-side)
supabase.rpc('auth_profile_department_id')
```

### Phase 1 R1–R35 rules (2026-05-19, branch system_fix)
- **Capability gate, not role allowlist** — new server actions use
  `getActionContextForCapability(cap)` from `src/actions/_shared.ts`. The
  legacy `getActionContext(roles)` is kept only for in-flight migrations;
  new code must declare a Capability from `src/lib/rbac.ts`.
- **Server-side route guards** — admin-only routes use `requireRole` or
  `requireCapability` from `src/lib/auth/helpers.ts`. The dashboard client
  shell is friendly fallback, not security. `/settings` and `/reports/[type]`
  have thin server `page.tsx` wrappers that gate before rendering the
  client component (renamed to `*Client.tsx`).
- **Department scope** — every `ActionProfile` carries a
  `departmentScope: DepartmentScope` field. Mutations on dept-scoped tables
  (equipment_assets, maintenance_requests, work_orders, pm_*, calibration_*,
  analytics) must branch on `profile.departmentScope.kind === 'denied'`
  before writing.
- **No silent condition-sync** — `.catch(() => undefined)` around
  `updateEquipmentConditionAction` is forbidden. Capture the return value,
  audit the failure (`*.condition_sync_failed`), and surface a warning toast.
- **RLS dept-scope policies** — migration 00060 adds dual `select_*` /
  `select_*_dept_scope` policy pairs on the highest-risk tables. The
  helper functions are `auth_profile_department_id()` and
  `is_dept_scoped_role()`. Future tables with department_id should follow
  the same pair pattern.

### Phase 2 R1–R35 rules (2026-05-19, branch system_fix)
- **Per-transition work-order capability** — `updateWorkOrderAction` picks
  the capability from
  `requiredCapabilityForWorkOrderTransition(requestedStatus)` in
  `src/utils/maintenance/work-order-transitions.ts`. Do NOT use
  `getActionContextForAnyCapability(['work_order.start',
  'work_order.complete', 'work_order.add_event'])` for new transitions —
  pick the exact capability for the status you're flipping to. New
  transitions must extend the helper.
- **R2 completion-evidence guard** — completing a work order REQUIRES
  `completion_outcome` AND `final_equipment_condition` in the payload.
  Reliability evidence fields (`repair_duration_hours`, `downtime_start`,
  `downtime_end`, `failure_date`, `action_taken_on_completion`) are
  OPTIONAL on the request; the action ALWAYS writes a `maintenance_events`
  row for corrective work orders, deriving any missing field server-side
  from the WO's own timestamps (started_at / completed_at / created_at +
  actual_hours) and the originating request's created_at via
  `src/utils/maintenance/completion-evidence.ts → deriveReliabilityEvidence`.
  Migration 00061 trigger `sync_downtime_logs_from_event` derives the
  `downtime_logs` row from `downtime_start`/`downtime_end`. Idempotency:
  exactly one completion-marked event per WO (identified by
  `completion_date IS NOT NULL`); re-completion UPDATEs that row. A
  `reliability_evidence_warning` is now ONLY emitted on hard write failure
  (RLS denial, constraint violation, .maybeSingle returning null), not
  on missing user input. Audit vocabulary:
  `maintenance_event.created_from_work_order_completion`,
  `maintenance_event.updated_from_work_order_completion`,
  `work_order.reliability_evidence_write_failed`,
  `work_order.completed_no_reliability_event_expected` (non-corrective).
  The Work Order Detail page queries events by `work_order_id` via
  `getMaintenanceEventsByWorkOrderId`, not by `asset_id`.
- **R17 request↔WO sync** — `createWorkOrderAction` flips the originating
  request's status to `assigned`/`approved` when `request_id` is set.
  Terminal request statuses (completed/rejected/canceled) are not touched.
  Failure surfaces `request_status_sync_warning` on the action result.
- **R19 declared parts-needed** — the canonical "WO is blocked on this
  part" signal is `work_order_parts_needed` (status=open), NOT
  `maintenance_parts_used`. fetchStockBlockers reads needs first, falls
  back to used. New WO mutations that imply a parts need should call
  `declareWorkOrderPartNeededAction`. Store users fulfilling stock issues
  may call `updateWorkOrderPartNeededStatusAction(id, 'fulfilled')`.
- **Downtime evidence source-of-truth** — `maintenance_events.downtime_start`
  + `downtime_end` is the source of truth; `downtime_logs` is a derived
  table maintained by the trigger from migration 00061. Do NOT write to
  `downtime_logs` directly from new code; write the event and let the
  trigger materialize.

### Phase 3 R1–R35 rules (2026-05-19, branch system_fix)
- **Canonical technician workload (R29)** — read current workload from
  `src/services/metrics/workload.service.ts::fetchCurrentTechnicianWorkload`.
  Do NOT inline `work_orders` joins for workload anywhere else. Status
  classification uses `classifyWorkloadStatus({openAssignments,
  criticalTasks})` with thresholds from `WORKLOAD_STATUS_THRESHOLDS`. The
  legacy `workload_capacity_snapshots` table is historical-trend only —
  do NOT read it for current-workload UIs.
- **Critical-action bands (R30)** — base weights and urgency bands live in
  `src/utils/analytics/critical-action-bands.ts`. Use the exported
  `CRITICAL_ACTION_CATEGORY_WEIGHTS` and `urgencyBandFor()` — do NOT
  introduce a parallel category-weight dictionary. The order is
  documented and locked by tests: corrective > needs_request >
  calibration > pm > stock > risk_watch > installation > replacement >
  procurement > training. Bands: ≥180 critical, ≥150 high, ≥100 medium.
- **R32 replacement → lifecycle linkage** — disposal_requests,
  procurement_requests, and specification_requests carry an optional
  `source_replacement_score_id` FK to `replacement_priority_scores(id)`
  (migration 00063). When launching disposal/procurement from
  `/command/drilldown/replacement/[assetId]`, forward the score row id
  (filter to NULL `weights_profile_id` — the canonical computed rows).
- **Refresh observability (R3+R25)** — two surfaces exist:
  (a) `refreshDecisionSupportSnapshotsAction` in
  `src/actions/developer-lab.actions.ts` is the unscoped multi-step
  pipeline that Developer Lab UI consumes. (b)
  `refreshDecisionSupportScopedAction` in
  `src/actions/decision-support.actions.ts` is the narrow per-asset /
  per-metric path returning structured `RefreshResult[]` (metric / table
  / status / before / after / error). Both audit-log.
- **Canonical KPI services (R11+R28)** — high-divergence-risk KPIs (equipment
  condition, PM compliance, calibration compliance, work orders,
  maintenance events) live in
  `src/services/metrics/canonical-metrics.ts`. Dashboards and reports
  consume them via the same pure compute functions. Do NOT add new
  inline KPI math in `buildReportKPIs` — extend the service.
- **Reports server-side migration deferred** —
  `src/services/reports.service.ts` still uses the browser Supabase
  client. This is intentional for user-scoped reports; privileged
  reports (audit, QR scan evidence, offline evidence) are already
  server-rendered. A future pass can centralize the rest. Do not move
  `reports.service.ts` to server client in a piecemeal way.

### Phase 4 R1–R35 rules (2026-05-19, branch system_fix)
- **Procurement delay scoring (R10)** — call `scoreProcurementDelay` from
  `src/utils/decision-support/procurement-delay.ts`. The signal is
  `expected_delivery_date` vs `now`, with priority boost and an explicit
  `usedFallback` flag when the field is missing. Do NOT score procurement
  delay anywhere else; do NOT score by `created_at` age as the primary
  signal. Terminal statuses (delivered/canceled) score 0.
- **QR auto-generation on equipment create (R7)** — every new asset MUST
  get a QR token via `ensureAssetQrToken(assetId, supabase)` inside
  `createEquipmentAction`. Token-gen failure does NOT roll back the asset
  insert — it returns `qr_token_generation_warning` on the action result.
  Audit events: `qr.token.generated.auto` (success),
  `qr.token.auto_generation_failed` (failure),
  `qr.token.already_present_on_create` (idempotent re-create).
- **Transactional stock RPCs (R8)** — write stock movements via
  `record_stock_receipt` / `record_stock_issue` (migration 00064), NEVER
  via a two-step "insert movement + update spare_parts.current_stock"
  pattern from the app. The RPCs use `SELECT … FOR UPDATE` row locks so
  concurrent issues on the same part serialize. Sufficient-stock check
  happens inside the lock. RPCs return `crossed_zero`/`crossed_reorder`
  booleans for one-shot notification emission.
- **Procurement → stock receipt handoff (R21)** — flipping a procurement
  request to `delivered` does NOT auto-update `spare_parts.current_stock`.
  The action emits BOTH `procurement.delivered_pending_receipt` (the new
  Store-User-actionable signal, deep-links to /spare-parts receipt modal
  with `procurement_id` carried through) AND `procurement.delivered`
  (legacy event, preserved for downstream consumers). The resulting
  stock_receipts row carries `procurement_id` (FK in 00064) so future
  queries can answer "what came of procurement X". Offline replay of
  `stock_receipt.draft` accepts the linkage too — what used to be a hard
  manual-review conflict is now a clean replay path.

### Phase 5 R1–R35 rules (2026-05-19, branch system_fix)
- **Scheduled scanner column names (R1+R20)** — `runNotificationRuleCheck`
  reads `v_overdue_pm.id`, `v_open_work_orders.id`,
  `spare_parts.reorder_level`, `v_calibration_due.result`. Do NOT
  reintroduce `schedule_id`, `work_order_id`, or `minimum_stock_level`
  — they are stale aliases that the views/tables no longer expose. The
  scanner returns `RuleCheckOutcome` with a `scans: RuleScanResult[]`
  array; never collapse this to a single boolean — sub-scan failures
  must remain visible per scan.
- **Calibration emit-on-action (R6)** —
  `updateCalibrationRequestStatusAction` MUST emit
  `calibration.request_status_changed`;
  `createCalibrationRecordAction` MUST emit
  `calibration.failed_or_adjusted` when `result IN ('fail','adjusted')`.
  These rules existed but were unfired before R6. A passing calibration
  is intentionally NOT emitted (no spam).
- **Stock direct emits (R9)** — `createStockIssueAction` emits
  `spare_part.stockout` / `spare_part.low_stock` from the RPC's
  `crossed_zero` / `crossed_reorder` booleans (NOT from a separate
  current_stock re-read). `createStockReceiptAction` emits
  `spare_part.restocked` from `crossed_up` (migration 00065). Do NOT
  emit threshold events from outside the action — concurrent races
  would re-introduce the corruption R8 just fixed.
- **Revoked QR scan emit (R16)** — `/qr/a/[token]` revoked branch emits
  `qr.revoked_scanned` with `asset_id: null` in the payload.
  The masked token + scanner profile id (when authenticated) are the
  only identifying fields. Do NOT add asset details to the payload —
  the public-facing branch must never leak which asset the revoked
  token belonged to. Use the equipment_qr_scans / audit_logs trail
  for admin investigation instead.
- **Telegram readiness diagnostics (R14)** —
  `getNotificationRoleDependencyDiagnostics` returns
  `{role, count, telegramConnected}` per role. A role with active
  profiles but zero `telegram_connections` produces a warning that
  surfaces in Developer Lab's environment-warnings list. The warning
  message says exactly what will happen: "Telegram-eligible
  notifications for this role will skip with no_chat_id."

---

## File and directory conventions

### Server actions — src/actions/
- _shared.ts — server-action helpers: getActionContext(), logServerAuditEvent(), revalidateMany()
- analytics.actions.ts — recomputeAssetAnalytics(), recomputeAllAnalytics()
- command.actions.ts — acknowledgeTriageItem(), acknowledgeAssetFlags(), acknowledgeCommandCenterItem(),
  snoozeCommandCenterItem(), refreshCommandCenter()
- equipment.actions.ts, maintenance.actions.ts, pm.actions.ts, calibration.actions.ts,
  spare-parts.actions.ts, procurement.actions.ts, training.actions.ts,
  disposal.actions.ts, documents.actions.ts, users.actions.ts, settings.actions.ts,
  alerts.actions.ts, installation.actions.ts, offline-sync.actions.ts — server-authorized
  mutation boundary for dashboard workflows
- Always use 'use server' directive at top of file
- Return typed result: `{ success: boolean; error?: string }`
- Always call `revalidatePath()` after mutations
- Client components may read with existing services, but operational writes should call
  server actions so authorization, audit, and revalidation happen server-side.

### Services — src/services/
- Plain async TypeScript functions — NOT classes
- Called from server components and server actions only
- Never imported into client components
- One file per domain (equipment.service.ts, maintenance.service.ts, etc.)

### QR identity — src/utils/qr/, src/services/qr.service.ts, src/actions/qr.actions.ts (Phase 1, 2026-05-15)
- Token: `qra_<base64url(crypto.randomBytes(24))>`. Server-only generation via
  `src/utils/qr/token.ts:generateQrToken`. NEVER `Math.random`. NEVER client-side.
- `isValidQrTokenFormat(token)` validates `^qra_[A-Za-z0-9_-]{16,}$`.
- `maskQrToken(token)` for admin UI — full token never lands in logs/screenshots.
- Service `src/services/qr.service.ts` (server-only): `getAssetQrIdentity`, `getAssetByQrToken`
  (rejects revoked tokens — used by future /qr/a/[token]), `ensureAssetQrToken`,
  `regenerateAssetQrToken`, `markQrLabelPrinted/Attached/NeedsReplacement`, `revokeAssetQrToken`
  (soft: keeps token, sets status='revoked'), `bulkGenerateMissingQrTokens`, `logQrScan`,
  `getQrCoverageStats`. Token collisions retried up to 5 times.
- Actions `src/actions/qr.actions.ts` gated to capability `equipment.edit` (developer/admin/bme_head).
  Every action writes `audit_logs` (qr.token.generate / qr.token.regenerate / qr.label.printed /
  qr.label.attached / qr.label.needs_replacement / qr.token.revoke / qr.token.bulk_generate).
  Revalidates /equipment, /inventory, /developer-lab, /command, and per-asset paths.
- Types: `src/types/qr.ts` (kept outside generated `database.ts`). Exports `QrLabelStatus`,
  `QrScanSource`, `QrOnlineStatus`, `QrCoverageStats`, `formatQrLabelStatus`,
  `getQrLabelStatusBadgeVariant`, `isQrLabelStatus`, `QR_TOKEN_PREFIX`.
- DB: migration 00045 — adds 7 qr_* columns to equipment_assets (unique partial index on qr_token,
  CHECK on qr_label_status), creates `equipment_qr_scans` (RLS: developer/admin/bme_head + self read;
  authenticated insert; no update/delete).
- UI: `/developer-lab` shows `QrCoverageSection`; `/equipment/[id]` shows `QrIdentityPanel`
  (admin actions for developer/admin/bme_head; read-only badge for everyone else).
- NOT implemented in Phase 1: label image/print, /qr/a/[token] route, role-aware scan, scan logging
  UI, offline scan logging, PWA, sync. See documents/qr-identity-design.md.

### QR label generation — Phase 2 (2026-05-15)
- QR image: rendered locally with the already-installed `qrcode.react` (`QRCodeSVG` for preview,
  `QRCodeCanvas` for PNG export). No external QR API, no Math.random.
- URL helper `src/utils/qr/url.ts`: `getQrBaseUrl()` resolves NEXT_PUBLIC_APP_URL → SITE_URL →
  VERCEL_URL (with https://) → http://localhost:3000. `buildAssetQrUrl(token)` returns the
  fully-qualified `/qr/a/<token>` URL or `null` for invalid tokens.
- Render helper `src/utils/qr/render.ts`: `renderQrLabelToDataUrl({ qrSource, info })` composes the
  full sticker (BMEDIS header, code, name, dept, QR, scan instruction, login-required footer) on an
  offscreen canvas and returns a PNG data URL. `createQrLabelFileName(assetCode, name)`,
  `sanitizeFileName(input)`, and `triggerDataUrlDownload(dataUrl, filename)` are the supporting helpers.
- Components: `src/components/qr/QrCodeImage.tsx`, `src/components/qr/QrLabelPreview.tsx`,
  `src/components/qr/QrLabelPrintSheet.tsx` (grid that respects existing globals.css `@media print`
  rules; outer `qr-print-sheet` wrapper).
- Service additions in `src/services/qr.service.ts`: `getQrLabelAssets({status?, search?, ids?})`,
  `getQrLabelAsset(id)`, `bulkMarkQrLabelsPrinted/Attached/NeedsReplacement(ids)` (only updates rows
  with `qr_token` present; returns `{ updated, skipped }`).
- Action additions in `src/actions/qr.actions.ts`: `markQrLabelsPrintedBulkAction`,
  `markQrLabelsAttachedBulkAction`, `markQrLabelsNeedsReplacementBulkAction`. All gate on
  `equipment.edit` capability and emit audit actions `qr.label.printed.bulk`,
  `qr.label.attached.bulk`, `qr.label.needs_replacement.bulk`. Revalidate
  `/equipment`, `/inventory`, `/developer-lab`, `/command`, `/equipment/qr-labels`.
- Route `/equipment/qr-labels`: server-gated to admin/bme_head (developer passes via `requireRole`).
  Renders `QrLabelSheetClient` with coverage cards, filter chips, search, selectable table, print
  preview grid, and bulk lifecycle actions. Accepts `?status=`, `?assets=<id,...>`, and `?print=1`
  query params (auto-triggers `window.print()` after mount).
- Equipment detail `QrIdentityPanel` (Phase 2 update): embeds `QrLabelPreview`, shows the QR URL
  path, adds Download PNG (canvas composition) and Print Label (`/equipment/qr-labels?assets=<id>&print=1`).
  Status banners for revoked / needs_replacement. Lifecycle is never auto-marked.
- Developer Lab QR Coverage: gains *Open QR Label Sheet*, *Print Generated (n)*, *Print Needs
  Replacement (n)* entry points alongside the existing Generate Missing Tokens action.
- Phase plan: 1 ✅, 2 ✅, 3 ✅ online landing, 4 ✅ role-specific QR experience,
  5 ✅ coverage expansion, 6 ✅ scan logging/evidence. Phase 6 is the final planned QR phase for now.
  Offline/PWA is explicitly OUT of the six-phase plan.

### QR online landing — Phase 3 (2026-05-15)
- Route: `src/app/qr/a/[token]/page.tsx` (outside `(dashboard)` so it doesn't load the dashboard shell
  before authentication). `dynamic = 'force-dynamic'`, `revalidate = 0`.
- Components: `QrLoginRequired.tsx` (unauthenticated, no asset data), `QrInvalidState.tsx`
  (invalid / not_found / revoked variants), `QrAssetLandingPage.tsx` (authenticated, role-aware).
- Service additions in `src/services/qr.service.ts`:
  - `resolveQrLandingAsset(token)` → discriminated `{ status: 'invalid'|'not_found'|'revoked'|'ok' }`.
    Revoked returns no asset metadata.
  - `getQrAssetContext(assetId)` → live evidence: openRequestsCount, openWorkOrdersCount,
    upcomingOrOverduePmCount, overduePmCount, calibrationDueState (overdue|due_soon|current|
    no_history|unavailable), lastWorkOrderStatus. Errors are collected into `errors[]` so the route
    can show "Not available" cards without crashing.
- Middleware: `src/lib/supabase/middleware.ts` includes `/qr` in `PUBLIC_PATHS`. Authenticated visits
  to `/login?returnTo=<safe-path>` redirect to that path (safe paths: single leading `/`, not `//`
  or `/\`).
- Login (`src/app/(auth)/login/page.tsx`): `safeReturnPath()` filters `?returnTo=` before
  `router.push`. External / protocol-relative redirects rejected.
- Scan logging: enabled (Option A). Authenticated success branch calls `logQrScan` from Phase 1 with
  `scan_source='web'`, `online_status='online'`, `action_taken='open_qr_landing'`, fire-and-forget;
  failures don't block render. Refreshes write duplicate rows in Phase 3 (Phase 6 will dedupe).
- Equipment detail `QrIdentityPanel` now exposes Open QR Page (new tab to /qr/a/<token>) and Copy URL
  (clipboard write of buildAssetQrUrl). Both gated to developer / admin / bme_head; disabled when
  token is missing or revoked.
- Phase 3 limits now superseded by Phase 4 role-specific page. Still no scan history UI yet (Phase 6);
  no PWA/offline (out of the six-phase plan).

### QR role-specific scan experience — Phase 4 (2026-05-15)
- New service `src/services/qr-context.service.ts` (server-only): exports `getQrRoleCategory()` and
  `getQrRoleContext({ asset, profile, client })`. It uses the normal Supabase server client/RLS,
  never service_role, and wraps every evidence query with section-level availability.
- Role categories: developer, bme_head (admin behaves operationally as BME Head), technician,
  department_head, department_user, store_user, viewer, unknown. No new database roles.
- Department scoping: `department_head` and `department_user` must have `profile.department_id` and it
  must match `asset.department_id`; otherwise the QR page shows a restricted state with no asset
  details, no request actions, and no operational rows. Never fallback to all-hospital data.
- `QrAssetLandingPage` now renders: common header/security note, asset identity card,
  role-specific primary actions, metric cards, and tabs for Current Status, Requests & Work,
  PM & Calibration, Parts / Blockers, History, and QR Info (developer/admin category only).
- Developer sees QR/debug data: masked token, token format validity, QR lifecycle timestamps,
  route path/base URL, role category, query health, Developer Lab, QR Label Sheet, Copy QR URL,
  asset profile, maintenance, and reports.
- BME Head/Admin sees operational context and state-aware navigation: critical/high request first,
  then open work order, condition repair flow, overdue PM, overdue calibration, or asset profile.
  Risk/RPN and replacement band appear only when existing score rows are available.
- Technician sees assigned-to-me work first, other open work second, PM/calibration status, recent
  service history, corrective request, and maintenance-event logging only when assigned work exists.
- Department Head/User see department-scoped request/readiness context only for their own department.
  Department User gets request-focused actions and no BME workflow controls.
- Store User sees direct stock/blocker/procurement context only: on-hold work, stock issues linked
  through maintenance_events, stock recommendation flags, and procurement links via
  specification_requests.procurement_request_id. No fuzzy matching and no maintenance execution actions.
- Viewer sees read-only summary/evidence/report actions only. No mutation actions.
- Scan logging remains Phase 3 behavior; metadata route is now `qr.landing.v2` with roleCategory.
  Phase 4 does not add scan history UI, deduplication, action-click logging, offline/PWA, or a new DB migration.

### QR coverage expansion — Phase 5 (2026-05-15)
- QR readiness answers only physical label readiness: Ready to Scan requires `qr_token` present,
  `qr_label_status='attached'`, and not revoked. Needs Label Generation = missing token or
  `not_generated`; Needs Printing = `generated`; Needs Attachment = `printed`; Needs Replacement =
  `needs_replacement`; Invalid/Revoked = `revoked`.
- Equipment list now shows Developer/Admin/BME Head-only QR summary cards, QR status filter, QR Status
  badge column, row selection, bulk QR toolbar, and row QR actions. Viewer/Store/Technician/Department
  tailored equipment views must not show QR admin controls.
- New route `/equipment/qr-coverage`: server-gated to admin/bme_head (developer passes via
  `requireRole`). Shows real coverage cards from `equipment_assets` plus scan record count from
  `equipment_qr_scans`, grouped tables (Missing QR Tokens, Generated Not Printed, Printed Not Attached,
  Needs Replacement, Revoked Labels, Recently Regenerated), and bulk Generate/Print/Mark Printed/Mark
  Attached/Needs Replacement actions. Bulk revoke/regenerate intentionally not added.
- Developer Lab QR section links to `/equipment/qr-coverage`, QR Label Sheet, Print Generated, and Print
  Needs Replacement, and documents the current phase state through Phase 6.
- Reports adds Developer/Admin/BME Head-only `/reports/qr-coverage` evidence report using existing
  report/PDF infrastructure. It reads QR lifecycle fields from `equipment_assets`; it does not add scan
  history, scan trends, deduplication, analytics dashboard, offline/PWA, fake data, or hardcoded counts.

### QR scan logging and evidence — Phase 6 (2026-05-15)
- Dedup constant: `QR_SCAN_DEDUP_WINDOW_MINUTES = 5`. `logQrScan` dedups only
  `action_taken='open_qr_landing'` rows for the same `asset_id` + `scanned_by` inside that window.
  Dedup failure never blocks QR page render, and historical duplicate rows are not deleted.
- Scan evidence service functions live in `src/services/qr.service.ts`: `getQrScanHistory`,
  `getAssetQrScanSummary`, `getRecentAssetQrScans`, `getQrScanCoverageStats`,
  `getAssetsNeverScanned`, `getAttachedAssetsNeverScanned`, `getMostScannedAssets`,
  `getQrScansByRole`, `getQrScansByDepartment`, `getQrAssetScanMetrics`, and
  `shouldLogQrScan`.
- Reusable table: `src/components/qr/QrScanHistoryTable.tsx`. Standard scan tables do not expose raw
  `user_agent`; scanner display is full_name → email → Unknown user.
- Full admin route: `/equipment/qr-scans`, gated to developer/admin/bme_head via `requireRole`. Filters:
  date range, role, department, asset id, online status, scan source, and action.
- Equipment detail `QrIdentityPanel` shows a collapsible QR Scan Evidence section only for
  Developer/Admin/BME Head. Other roles see no scan history UI.
- Developer Lab QR section now shows total scans, scans last 7 days, attached assets never scanned,
  most scanned asset, scans by role, scans by department, recent scans, and revoked/needs-replacement
  scan risks.
- `/equipment/qr-coverage` adds scan-aware groups/columns: Never Scanned, Scanned Recently, Attached
  Never Scanned, Revoked Recently Scanned, total scans, last scanned, last role, and scans last 30 days.
- Reports adds Developer/Admin/BME Head-only `/reports/qr-scan-evidence`.
- Still intentionally out of scope: offline/PWA/service worker/IndexedDB, background sync, browser
  notifications, real `synced_later` queue behavior, action-click tracking, fake scan rows, generated
  adoption rates, and destructive duplicate cleanup.

### Analytics utilities — src/utils/analytics/
- formulas.ts — all 7 thesis formulas (computeRPN, computeAvailability, computeMTBF,
  computeMTTR, computePMC)
- composite-scoring.ts — weighted sum computation
- normalization.ts — min-max normalization
- replacement-index.ts — replacement priority index
- recommendations.ts — recommendation flag generation logic
- index.ts — barrel export
- NEVER duplicate formula logic elsewhere — always import from these files

### Decision support utils — src/utils/decision-support/
- explanations.ts — human-readable explanations for metrics, triage, alerts, and replacement criteria
- command-center-reasons.ts — deterministic reason builders for the Command Center redesign:
  formatFmeaExplanation(), summarizeRiskDrivers(), buildCorrectiveReason(), buildCalibrationReason(),
  buildPMReason(), buildStockBlockerReason(), buildInstallationReason(), buildLifecycleReason(),
  buildReplacementReason(), buildProcurementReason(), buildTrainingReason()
  Availability/spare-part scores are INVERSE-normalized (higher = worse). No LLM calls.

### Command Center data lib — src/app/(dashboard)/command/_lib/
- command-center-data.ts — typed server-side data fetchers and types for the redesigned Command Center.
  Exports (types): EquipmentSummary, CriticalActionItem, ScoreExplanation, CorrectiveMaintenanceItem,
  NeedsRequestItem, ProactiveRiskItem, WorkOrderSummary, WorkQueueItem, CalibrationTriageItem,
  PMTriageItem, StockBlockerItem, InstallationTriageItem,
  ProcurementTriageItem, TrainingTriageItem, TechnicianWorkloadItem, CorrectiveTriageRow (legacy),
  ReplacementTriageRow, TriageCategories.
  Exports (functions): fetchEquipmentSummary(), fetchCorrectiveMaintenanceTriage()
  (work_orders work_type='corrective' + maintenance_requests, NOT v_command_center_triage),
  fetchNeedsRequestTriage() (condition-problem assets without open corrective work),
  fetchProactiveRiskWatch() (recommendation_flags + risk_scores for assets without open corrective
  and hidden when command_center_acknowledgements has the same signal_hash),
  fetchCalibrationTriage(), fetchPMTriage(), fetchStockBlockers(), fetchInstallationTriage(),
  fetchProcurementTriage() (uses title column, not description), fetchTrainingTriage(),
  fetchTechnicianWorkload() (work_orders only — no profiles.role filter bug),
  fetchWorkOrderSummary(), fetchWorkQueue(), buildCriticalActions().
  All fetchers wrap in try/catch with graceful empty fallbacks for missing tables.

### Command Center action and count semantics
- Final polishing rule: no passive dashboards. Every operational count card must filter the current surface
  or route to an exact filtered surface, and every row should expose a state-aware next action.
- BME Head decision principle: the system recommends, ranks, scores, and explains; the BME Head makes the final decision.
- Row-level action rule: if a row represents an existing record, open that exact record
  (`/maintenance/work-orders/[id]`, `/maintenance/requests/[id]`, `/pm/schedules/[id]`,
  `/command/drilldown/procurement/[id]`, or exact evidence route). Generic module routes are
  allowed only for "View all" links.
- Creation rule: if no record exists, open a prefilled creation flow with asset/part/work-order
  context and `source=command-center`; do not open empty forms from Command Center rows.
- Informational signal rule: Risk Watch items should be acknowledged/snoozed or converted into a real
  workflow item. Risk Watch acknowledgement stores item_type, item_key, asset_id, signal_hash,
  acknowledged_at, and optional snoozed_until in `command_center_acknowledgements`; a changed signal_hash reappears.
- Count consistency rule: summary card, triage tab, drilldown, and critical actions must share the
  same fetcher/source for the same metric. PM uses `fetchPMTriage()`, calibration uses
  `fetchCalibrationTriage()`, stock uses `fetchStockBlockers()`, and work queue uses
  `fetchWorkQueue()`/`fetchWorkOrderSummary()`.
- Triage meanings: Corrective = active corrective work only. Needs Request = condition-problem assets
  without open corrective work. Risk Watch = proactive risk signals without active corrective work.
  PM, Calibration, Stock, Replacement, and Procurement use their workflow-specific sources.
- Score explainability rule: every composite score shown in Command Center must use the reusable
  score explanation affordance and expose formula, criteria/weights, raw/normalized values where
  available, generated reason, timestamp/history if available, assignment method, and action suggestion.
- Role notes: developer = BME Head plus thesis/testing controls; bme_head gets the operational
  Command Center; viewer is read-only and must not see mutation labels. Training triage is hidden
  from the BME Head Command Center for now and reserved for a later Department Head workflow.

### Command Center Action Semantics
1. Exact record rule: row-level actions must open exact records when records exist.
2. Prefilled creation rule: if no record exists, open a prefilled creation flow with context.
3. Informational signal rule: informational signals use acknowledge/snooze or convert-to-workflow.
4. Count consistency rule: summary card, triage tab, drilldown, Work Queue & Assignment, and critical action count must share the same fetcher/source for the same metric.
5. State-aware action labels: Assign for unassigned work, Reassign for assigned work, View Progress for in-progress work, Resolve Blocker for on-hold work.
6. Future triage categories: new triage categories must define record IDs, exact routes, and prefilled fallback flows before being shown in the Command Center.
7. BME Head principle: the system recommends/explains; the BME Head decides.

### Final Navigation and Admin Architecture (session 17)
1. Final sidebar groups are Command, Equipment, Work, Inventory, People, Lifecycle, Support, Reports, and Administration.
2. Helpdesk is removed from navigation. `/helpdesk` redirects to `/requests`; support is covered by Requests Hub, Alerts, Maintenance Requests, and BMEDIS Copilot.
3. Users & Roles is no longer a standalone nav item. `/users` redirects to `/settings?tab=staff-access`.
4. Security is no longer a standalone nav item. `/security` redirects to `/settings?tab=security-access`.
5. Decision Support Health is renamed Developer Lab. `/command/health` and `/decision-support-health` redirect to `/developer-lab`.
6. Developer Lab is developer-only. It owns scoring methodology, sandbox sliders, ranking comparison, data health, debug/refresh tools, and thesis/demo tools.
7. Developer Lab sandbox controls must not modify live operational decision outputs unless a developer explicitly runs a real refresh action.
8. BME Head pages must not show scoring sliders, thesis debug controls, raw developer diagnostics, or sandbox weight controls.
9. Settings is the administration center: Hospital Profile, Departments, Equipment Categories, Staff & Access, Security & Access, Notifications, Reference Data, System Preferences, and Data Import/Export.
10. Staff & Access shows all profiles, auth-linked login users, profile-only staff, departments, roles, status, and grouped operational staff. Developer/system accounts are separate and visible only to developer/admin.
11. Security & Access shows role matrix, users per role, RLS/audit posture, risky accounts, profiles without roles, and recent governance events.
12. Operational page rule: show the situation, explain why it matters, show the next action, open exact records, and preserve evidence/auditability.
13. Existing record → exact record. Missing workflow → prefilled creation. Informational signal → evidence/acknowledge/convert. Composite score → explanation.

### Final Module Semantics (session 17)
1. Calibration is an accuracy/safety compliance control center with records, requests, due/overdue, failed/adjusted, external calibration, and completed-this-month signals.
2. Work Orders is the technical execution center with open/unassigned/assigned/in-progress/on-hold/completed/vendor filters and exact `/maintenance/work-orders/[id]` action routes.
3. Spare Parts is the stock-control center with inventory, low stock, stockouts, receipts, issues, blockers, and prefilled procurement for low-stock/stockout rows.
4. Logistics is a movement workflow overview backed by real receipts, issues, procurement, low-stock, pending receiving, pending issue, and work-order-linked issue counts.
5. Procurement is a pipeline page for requested/approved/ordered/in-transit/delivered/delayed rows; exact request evidence lives at `/command/drilldown/procurement/[id]`.
6. Training is a competency workflow for requests, sessions, upcoming sessions, coverage, attendance, and training evidence.
7. Replacement Priority is a planning/evidence page; it does not expose sliders. RPI explanation must show criteria, weights, formula, source data, and current calculation.
8. Disposal separates formal disposal requests from replacement/non-repairable candidates. Candidates can create disposal requests, but are not counted as formal requests.
9. Alerts is a Command Center-style operational alert inbox using recommendation flags today, with source actions and acknowledgement. A richer notification subsystem is deferred.
10. Reports is the evidence/export center for operations, inventory, maintenance, work orders, PM, calibration, risk/FMEA, replacement, readiness, stock, procurement, training, disposal, workload, audit/security, and demo reports.
11. Audit Log must not crash on empty/failing audit data. Developer/admin see diagnostics; BME Head sees governance evidence.

### Final Workflow Polishing Semantics (2026-05-11)
1. Calibration triage priority is deterministic and explainable: overdue severity + equipment criticality + last result risk + department impact + open workflow state. Triage sections are Urgent Safety Risk, Needs Scheduling, Awaiting Action, and Longest Overdue.
2. Maintenance condition trace is visible on request and work-order detail pages. Request reported_condition syncs equipment condition for needs_repair/non_functional; work start sets under_maintenance; completion applies final_equipment_condition from the completion outcome.
3. Work Orders default to active work. Critical/High counts are active-only; completed work is history/evidence and lives behind Completed filters.
4. Spare Parts uses duplicate-safe procurement behavior: low-stock/stockout rows show Track Procurement when an open procurement row already exists, otherwise Request Procurement/Create Urgent Procurement.
5. Logistics represents the MEMIS-style store workflow: Receive -> Request -> Approve -> Issue -> Balance/Bin Card -> Usage Evidence. Top cards route to filtered Spare Parts, Procurement, or local Logistics panels.
6. Procurement cards filter the pipeline and permitted users can update status inline. Delivered procurement points to Receive Stock so stock balances are updated through the stock workflow.
7. Replacement thresholds are prototype/system decision thresholds only: RPI >= 0.70 strong candidate, 0.55-0.69 review candidate, <0.55 monitor. They do not approve replacement automatically; sensitivity controls live in Developer Lab only.
8. Reports prepare a timestamped snapshot, attempt a safe decision-support snapshot refresh, write audit evidence when permitted, and display freshness/methodology notes.

### Logistics Workflow Drilldown Convention (2026-05-12)
1. `/logistics` uses `?workflow=` param (normalizeWorkflow also accepts legacy `?panel=` for backward compatibility).
2. Supported workflows: `receiving`, `requests`, `issue`, `bin-card`, `usage-linkage`.
3. Each workflow renders a real data Table from live data fetched at mount: procurement, parts, low-stock parts, receipts, issues.
4. Receiving: delivered procurement rows with "Receive Into Stock" and "Open Procurement" actions.
5. Requests: open procurement rows (status not delivered/canceled) with "Track Procurement" and "Review/Approve" actions.
6. Issue: low-stock parts with current_stock/reorder_level/deficit and "Issue Stock" (if stock > 0), "Create Urgent Procurement" (if stockout), or "Request Procurement" (if low stock) actions.
7. Bin-card: all parts with per-part receipts/issues counts and last receipt/issue dates computed from full receipt/issue arrays.
8. Usage-linkage: stockout banner + linked issues (with work-order link) + unlinked issues separated.
9. Stats cards at top route to filtered spare-parts or logistics workflow panels.

### Developer Lab Health Check Grouping (2026-05-12)
1. Health checks in /developer-lab are grouped into 4 categories: Data Integrity, Workflow Integrity, Decision-Support Integrity, Security/Auth Integrity.
2. Each group shows its own critical/warning/healthy summary badge based on the checks within it.
3. The `HealthCheck` type has a required `group` field ('data'|'workflow'|'decision-support'|'security').
4. Non-RPI sensitivity tabs (health, readiness, critical, stock) now show per-tab methodology preview with formula inputs, source tables, and "Preview only — simulation not yet connected to live scores" amber banner.

### Settings Configured-in-DB Sections (2026-05-12)
1. `spare-part-categories` section: explains that categories are free-text on `spare_parts.category`; no lookup table exists; no fake CRUD shown.
2. `procurement-statuses` section: shows all 6 enum values (requested/approved/ordered/in_transit/delivered/canceled) with descriptions. Labeled "Database enum — read-only."
3. `disposal-reasons` section: shows all 6 disposal method enum values (auction/donation/recycling/destruction/return_to_vendor/other) with descriptions. Labeled "Database enum — read-only."

### Action Button Style Convention (2026-05-12)
1. Primary operational action (first row action, must-act items): `rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]`
2. Secondary/evidence/navigation action: `rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]`
3. Stockout/urgent escalation: `rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500`
4. Warning/low-stock procurement: `rounded-lg bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500`
5. Amber warning signal: `rounded-lg border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20`
6. Success/complete/issue: `rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500`
7. Apply consistently across calibration, work-orders, alerts, spare-parts, procurement, disposal, training, replacement action buttons.
8. Button component variants already cover primary/warning/success/destructive/info/outline; use those via `<Button variant="...">` for full-width/modal buttons and the CSS class pattern for compact inline table row actions.

### Reports Module Convention (2026-05-12 redesign)
1. Reports page (`src/app/(dashboard)/reports/page.tsx`) is organized into 4 sections: Executive & Defense, Asset Lifecycle, Maintenance & Compliance, Resource/Procurement & People. Each card shows: title, purpose, evidence tag, chart count, table count, and available exports (CSV/PDF/Print).
2. Report detail page (`src/app/(dashboard)/reports/[type]/page.tsx`) structure: print-only header → PageHeader → no-print export row (Back/CSV/PDF/Print/Refresh) → Snapshot notice banner → Executive Summary → KPI cards (buildReportKPIs) → Visual Analytics charts (buildReportCharts) → Priority Findings (buildPriorityFindings) → Methodology & Interpretation → Evidence Table (filters + DataTable).
3. `buildReportCharts(type, rows): ChartSpec[]` takes the original URL slug (not effectiveReportType). ChartSpec has type ('doughnut'|'bar'|'hbar'|'line'). Handles: equipment/biomedical-operations/department-readiness/evaluation-demo→4 charts; maintenance-performance→3 charts (type donut+cost bar+monthly bar); pm-compliance→3 charts (status donut+assignment donut+dept bar); calibration-compliance→3 charts (result donut+type bar+dept bar); work-orders/technician-workload→3 charts (status donut+priority donut+technician hbar); replacement-planning/decision-support-methodology→3 charts (top 10 RPI hbar+band donut+dept bar); risk-fmea→3 charts (band donut+top 10 RPN hbar+dept bar); procurement-pipeline→2 charts; spare-parts-stock→1-2 charts; disposal-lifecycle→2 charts; training-competency→1-2 charts; audit-security→2 charts.
4. `buildReportKPIs(type, rows): KpiCard[]` — report-specific KPI cards with { label, value, color, sub? }. Color keys: blue/green/red/yellow/orange/purple/gray mapped to CSS in kpiColorMap.
5. `buildPriorityFindings(type, rows): Finding[]` — up to 3-4 critical/warning/info findings per report type. Uses AlertTriangle for critical/warning, CheckCircle for info.
6. `buildExecutiveSummary(type, rows): string` — uses real loaded counts per report type; never generic.
7. New report type configs added: `evaluation-demo` (Equipment data, demo-focused title/columns), `decision-support-methodology` (replacement-planning data, methodology title/columns with formula labels like S₁..S₅).
8. Export CSV (`src/utils/export.ts`): includes 4 metadata header rows (Report, Institution, Snapshot Generated, Source) before column headers. Filename: `bmedis-[slug]-snapshot-YYYY-MM-DD-HH-mm.csv`. `exportToCSV(data, columns, slug, { reportTitle, generatedAt })`.
9. Export PDF (jsPDF real PDF): includes snapshot timestamp in header. Filename: `bmedis-[slug]-snapshot-YYYY-MM-DD-HH-mm.pdf`. `exportToPDF({ data, columns, filename, title, filters, generatedAt })`.
10. Print CSS: added to `src/app/globals.css` `@media print` block. Hides `.no-print`, `.assistant-launcher`, `.assistant-panel`. Sets white bg, black text. DashboardLayout sidebar and topbar wrapped in `no-print` class. Report export row and filter row have `no-print` class. Print-only header div has class `report-print-header hidden` (shown in print). Chart grids get class `report-chart-grid` (break-inside: avoid). KPI grids get `report-kpi-grid`.
11. Settings consolidates profile/password, reference data, user management, role permissions, and security posture. BME Head can view governance sections; mutation controls remain developer/admin-gated.
12. Developer Lab is under Command for developer/admin roles. Sensitivity tabs are simulation only unless a deliberate refresh/recompute action is run.

### Requests Hub Semantics (session 13)
1. Requests Hub (`/requests`) is central intake and cross-category tracking, not a replacement for operational modules.
2. Request categories: corrective maintenance, calibration, training, procurement, disposal, installation, and specification/document support.
3. UI naming uses "Corrective Maintenance Requests"; do not reintroduce "Curative Maintenance Requests".
4. Shared data source: `src/app/(dashboard)/requests/_lib/requests-hub-data.ts` returns categoryCards, workflowCards, unifiedRequests, and roleScope. Cards, filters, and the unified table must share this normalized row set to prevent count mismatches.
5. Normalized table rows include request number, type, asset/subject, department, submitted by, status, owner/assignee, created date, exact href, and next action href.
6. Existing record → exact route. Maintenance opens `/maintenance/requests/[id]` or linked `/maintenance/work-orders/[id]`; procurement opens `/command/drilldown/procurement/[id]`; request types without dedicated detail pages use `/requests/[type]/[id]` as a lightweight exact status/detail route.
7. New request → type-specific contextual route with `source=requests-hub`; module pages open the relevant request/upload modal from this query where implemented.
8. BME Head/developer/admin see all request activity. Department roles see own/department-scoped activity where rows expose requester or department context. Viewer is read-only. Store focuses procurement/installation/specification visibility.
9. Specification requests mean technical specifications, standards, or document support for procurement, replacement, donation acceptance, installation, or standardization. The hub counts real `specification_requests` workflow rows; `equipment_documents` are output/evidence documents, not request rows.
10. Disposal requests are formal `disposal_requests`; replacement candidates are related evidence and may route to `/replacement`, but are not counted as disposal requests.
11. Installation counts real `installation_requests` workflow rows. `installation_records` remain installation/commissioning completion evidence and are not counted as request intake.

### Installation Request Semantics (session 14)
1. Installation Request = intake/workflow item. Installation Record = completion evidence.
2. Request flow: submitted → reviewed/approved → scheduled or assigned → in progress → installation/commissioning completed → installation record created → equipment go-live.
3. `/installation` separates Requests and Records tabs. New Installation Request opens `/installation/requests/new?source=...`; Add Installation / Commissioning Record remains the evidence action.
4. Requests Hub Installation count uses `installation_requests`, not `installation_records`.

### Specification Request Semantics (session 14)
1. Specification Request = request/tracking item. Specification Document = output/evidence.
2. Requests can be reviewed, moved in progress, linked to uploaded specification documents, completed, rejected, and retrieved.
3. `/documents` separates Document Repository and Specification Requests tabs. New Specification Request opens `/documents/specification-requests/new?source=...`; Upload Specification Document remains the output action.
4. Requests Hub Specification count uses `specification_requests`, not `equipment_documents`.

### Hospital Operations Calendar Semantics
1. `/calendar` is fully internal and must not be treated as Google Calendar integration.
2. Do not add Google OAuth, external sync, external event creation, or Google token storage for the current internal calendar.
3. Calendar events are normalized from BMEDIS operational tables with real date fields only.
4. Current sources include PM schedules, calibration records/requests, work orders, maintenance requests, training sessions/requests, installation requests/records, procurement requests, disposal requests/disposed assets, and dated specification requests where the row has `required_by`.
5. Source tables remain the source of truth; calendar sync means internal revalidation/refresh after module actions mutate source records.
6. Every event should route to the exact source record when available: `/pm/schedules/[id]`, `/maintenance/work-orders/[id]`, `/maintenance/requests/[id]`, `/installation/requests/[id]`, `/command/drilldown/procurement/[id]`, `/documents/specification-requests/[id]`. Use contextual module routes only where no exact detail route exists.
7. Viewer is read-only. Calendar does not provide direct mutation controls; operational actions stay on module pages.
8. External Google Calendar sync is intentionally deferred and would require OAuth/token storage/duplicate prevention/conflict handling before implementation.

### Maintenance Workflow Semantics (session 11)
1. Maintenance Request = reported problem. Work Order = assigned execution task.
2. Request workflow: submitted → approved → work order created → assigned → in progress → completed.
3. Maintenance main page: Requests | Work Orders tabs with custom controlled tab switching (not Tabs component). 8 summary cards drive tab+filter activation. Quick-filter chips within each tab. All counts/filters use the same loaded arrays → no mismatches.
4. Request-WO relationship: work_orders.request_id links to maintenance_requests.id. Both detail pages show the cross-link. Request table shows linked WO # and "Needs WO" if approved with no WO. WO table shows originating request #.
5. State-aware request row actions:
   - open WO on_hold → Resolve Blocker → /maintenance/work-orders/[id]?action=resolve-blocker
   - open WO in_progress → View Progress → /maintenance/work-orders/[id]
   - any other open WO → Open WO → /maintenance/work-orders/[id]
   - pending → Review → /maintenance/requests/[id]
   - approved, no WO → Create WO → /maintenance/work-orders/new?request_id=...&asset_id=...&work_type=corrective&source=maintenance-request
   - else → View → /maintenance/requests/[id]
6. State-aware WO row actions:
   - on_hold → Resolve Blocker → /maintenance/work-orders/[id]?action=resolve-blocker
   - in_progress → View Progress → /maintenance/work-orders/[id]
   - open + unassigned → Assign → /maintenance/work-orders/[id]?action=assign
   - assigned → Start / View → /maintenance/work-orders/[id]
   - completed → View Result → /maintenance/work-orders/[id]
   - else → View → /maintenance/work-orders/[id]
7. Request detail: workflow steps strip; reported_condition prominently displayed; linked WO list (status, technician, completion outcome); equipment current condition panel; state-aware action buttons (Approve/Reject/Create WO/Open WO).
8. Work order detail: originating request card (request#, urgency, reported condition, fault description); Equipment Condition panel (current / at request / final at completion / completion outcome).
9. Recurring failure banner: failure count badge, department, "Schedule diagnostic" (prefilled corrective request with source=recurring-failure), "Review risk" link. Threshold: ≥4 failures.
10. Viewer is read-only on all maintenance pages.

### Preventive Maintenance Semantics (session 15)
1. PM Plan = recurring preventive maintenance rule/program. It defines equipment, frequency, checklist expectation, and active/inactive state.
2. PM Schedule = one generated planned-maintenance task instance with scheduled date, status, assigned technician, and evidence/action state.
3. PM Completion = evidence that scheduled PM work was performed. Evidence records result, checklist, notes/findings, technician, completion date, and final equipment condition.
4. PM Compliance = completed scheduled PM tasks ÷ total scheduled PM tasks for the displayed period. Skipped/deferred PM is tracked separately and does not count as completed.
5. `/pm` is a planned-maintenance control center: summary cards, compliance chart, Plans/Schedules/Overdue tabs, quick filters, exact row actions, and shared row-derived counts must stay consistent.
6. Existing schedule rows open exact `/pm/schedules/[id]` routes. Assign/reassign/complete/defer/skip actions use action queries on that exact schedule route.
7. Completing PM updates `pm_schedules` evidence fields, inserts `pm_completions`, updates equipment condition from final condition, refreshes analytics/risk detectability through the existing recompute pipeline, and revalidates PM, Equipment, and Command Center paths.
8. If PM finds an issue, the completion flow can create/open a corrective maintenance request with duplicate prevention using the existing open-request guard.
9. Defer/skip PM requires a reason. Deferred PM may move the scheduled date and is still not counted as completed compliance.
10. Developer/admin/BME Head manage PM plans and schedules; technicians can execute PM work; viewer is read-only. The system recommends/prioritizes/explains; the BME Head decides.

### PM Count and Action Semantics (session 16)
1. PM Schedule Records = all generated `pm_schedules` rows, including historical completed, skipped, deferred, canceled, overdue, and upcoming task records.
2. Active PM Tasks = unfinished PM schedules requiring action. Active statuses are `scheduled`, `in_progress`, `overdue`, and `deferred`; completed, skipped, and canceled are not active.
3. PM Plan status is separate from asset criticality. Plan: Active/Paused comes from `pm_plans.is_active`; Asset criticality comes from `equipment_categories.criticality_level`.
4. `Needs next task` means the plan has no unfinished upcoming/active schedule. It does not mean there is no PM history.
5. Generate Next Task creates the next `pm_schedules` row only when the plan has no unfinished active task. If an unfinished task exists, open that exact task instead of creating a duplicate.
6. Pause Plan sets `pm_plans.is_active=false`, disables future task generation, and preserves all existing schedule history and active task rows. Resume Plan sets `is_active=true`.
7. History opens exact `/pm/plans/[id]/history` with plan metadata, schedule/evidence history, active/upcoming task state, and exact schedule-detail links.
8. PM Compliance = completed scheduled tasks ÷ total scheduled tasks × 100. Skipped/deferred are tracked separately and do not count as completed.

### Equipment Section Semantics (session 9)
1. Condition is the primary operational state. Status (active/inactive/disposed) is NOT shown in the main Equipment list or table; it stays in the DB and admin/edit forms only.
2. Canonical condition labels: functional→"Functional", needs_repair→"Needs repair", non_functional→"Non-functional", under_maintenance→"Under maintenance". Always import from `src/utils/equipment/condition-labels.ts`.
3. Maintenance state is derived from open requests/work orders and shown in the Equipment table.
   - Maintenance state values: no_issue / no_request / request_pending / wo_open / wo_assigned / wo_in_progress / wo_on_hold
   - Open request: status in pending/approved/assigned/in_progress. Open WO: status in open/assigned/in_progress/on_hold.
4. Condition synchronization rules (session 10 corrected):
   - reported_condition on maintenance_requests is stored in DB (migration 00038). Values: functional_issue (no condition change), needs_repair (sync), non_functional (sync).
   - When maintenance request is created with reported_condition=needs_repair or non_functional: updateEquipmentConditionAction() syncs equipment_assets.condition.
   - When work order status → in_progress: equipment condition set to under_maintenance.
   - When work order status → completed: condition set to final_equipment_condition from completion modal, defaulting from completion_outcome (resolved→functional, partially_resolved→needs_repair, not_resolved→non_functional, awaiting_parts_or_vendor→under_maintenance). Never unconditionally sets functional.
   - When work order status → on_hold: condition unchanged (remains under_maintenance or needs_repair).
   - completion_outcome and final_equipment_condition are stored in work_orders (migration 00039).
   - Reported condition source is stored in reported_condition_source column for audit trail.
5. Equipment list page state-aware row actions:
   - Open WO (on_hold) → Resolve Blocker → workOrderDetail(id, 'resolve-blocker')
   - Open WO (in_progress) → View Progress → workOrderDetail(id)
   - Open WO (assigned) → Open Work Order → workOrderDetail(id, 'reassign')
   - Open WO (open) → Open Work Order → workOrderDetail(id)
   - Open request → Open Request → maintenanceRequestDetail(id)
   - needs_repair / non_functional + no request + canCreateRequests → Create Request → createMaintenanceRequestFromAsset(...)
   - High/critical risk, functional → Review Risk → /equipment/${id}
   - Replacement candidate (RPN > 200) → Evidence → replacementEvidence(id)
   - Default → View → /equipment/${id}
6. Create Request from equipment always uses source=equipment (not command-center) and passes reportedCondition in the URL.
7. Reliability display rules: never show "Availability: 0 failures". If failure_count=0 → "No recorded failures". If availability_ratio is null but failures exist → "Insufficient downtime data". If no failures at all → "100% (no failures)". Always show formula explanation.
8. Every composite score on equipment detail is explainable: RPN (S×O×D, drivers, method), RPI (weighted sum, 7 criteria, /100), PMC (completed/scheduled, formula), reliability (operational/failure count, formula), calibration (last/next/result).
9. Equipment list page loads all data at mount and filters entirely client-side (80 assets; no re-fetch on filter change).
10. Summary cards on equipment list are clickable and apply quick filters to the table.
11. updateEquipmentConditionAction() in equipment.actions.ts — lightweight action only updating condition; allowed by admin/bme_head/technician/department_head/department_user.

### Components
- Reusable UI: src/components/ui/
- Layout: src/components/layout/ (Sidebar.tsx, Topbar.tsx, DashboardLayout.tsx)
- Charts: src/components/charts/
- Assistant/chatbot: src/components/assistant/
- Theme: src/components/theme/
- Page-specific: src/app/(dashboard)/[route]/_components/
- Always check src/components/ui/ before building a new component

### Command Center components (session 6-8 redesign/action accuracy)
- AutoRefreshStatus.tsx — client component; router.refresh() every 10s, "Updated Xs ago" display, pauses when tab hidden
- SummaryActionCards.tsx — 10 summary cards (total/functional/non-functional/WOs/critical/PM/calibration/stock/replacement/reports); operational cards link to `/command/drilldown/[type]`
- CriticalActionStrip.tsx — top 6 critical action items with category/urgency badges and exact record or prefilled action links
- ScoreExplanation.tsx — reusable score details drawer for RPN, RPI, readiness, triage/critical scores, PM/calibration/stock scores, and workload suggestions
- TriageCenterTabs.tsx — 9-category BME triage (corrective, needs request, risk watch, calibration, PM, stock, installation, replacement, procurement); training is hidden for BME Head for now. Store user sees logistics-focused subset.
- TechnicianWorkload.tsx — original standalone component (no longer used in page.tsx; replaced by WorkloadAssignment.tsx)
- WorkloadAssignment.tsx — integrated Work Queue & Assignment section with open/unassigned/assigned/in-progress/on-hold/critical counts, exact work-order row actions, technician availability cards, and explainable workload-only suggested assignee. Accepts WorkOrderSummary + WorkQueueItem[] + TechnicianWorkloadItem[].
- CommandCenterInteractive.tsx — existing component; added `showTriage?: boolean` prop (default true) so triage section can be hidden when TriageCenterTabs is shown instead. Department readiness cards now show "N essential unavailable" label and detail panel shows essential/total/non-essential reconciliation.
- TriageCenterTabs.tsx — updated: corrective tab uses CorrectiveMaintenanceItem[] (open work_orders + maintenance_requests, not v_command_center_triage). Needs Request uses condition-problem assets without open corrective work. Risk Watch uses ProactiveRiskItem[] and acknowledge action. RPI shown as X/100. Row actions are exact records or prefilled creation flows.

---

## Database — complete table reference

### Reference/Master Data (Migration 00001)
| Table                    | Key columns                                              |
|--------------------------|----------------------------------------------------------|
| departments              | id, name(UQ), code(UQ), description, is_active           |
| equipment_categories     | id, name(UQ), code(UQ), criticality_level(enum)          |
| manufacturers            | id, name(UQ), country, contact_info(JSONB), is_active    |
| equipment_models         | id, name, manufacturer_id(FK), category_id(FK)          |
| vendors                  | id, name(UQ), contact_person, phone, email, is_active    |
| suppliers                | id, name(UQ), contact_person, phone, email, is_active    |
| failure_codes            | id, code, description, category, is_active               |
| maintenance_action_codes | id, code, description, category, is_active               |
| calibration_types        | id, name, description, interval_months                   |
| pm_templates             | id, name, category_id(FK), frequency_days, checklist_items(JSONB), is_active |
| risk_scales              | id, dimension, level, label, description                 |
| scoring_weights          | id, profile_name, description, criteria(JSONB), is_default |
| status_labels            | id, entity_type, code, label, color, sort_order          |
| memis_lookup_values      | lookup_group, code, label, description, is_active        |

### Auth/Users (Migration 00002)
| Table       | Key columns                                                                  |
|-------------|------------------------------------------------------------------------------|
| roles       | id, name(UQ), description, permissions(JSONB)                                |
| profiles    | id, user_id(FK auth.users,UQ), full_name, email, phone, department_id(FK), job_title, is_active |
| user_roles  | id, user_id(FK profiles), role_id(FK roles), assigned_at — unique(user_id,role_id) |
| audit_logs  | id, user_id(FK profiles), performed_by(FK profiles), action, entity_type, entity_id, old_values(JSONB), new_values(JSONB), details(JSONB), ip_address, created_at |

### Assets (Migration 00003)
| Table                 | Key columns                                                               |
|-----------------------|---------------------------------------------------------------------------|
| equipment_assets      | id, asset_code (partial UQ: unique among rows where deleted_at IS NULL — migration 00029), serial_number, name, model_id(FK), category_id(FK,NN), department_id(FK,NN), manufacturer_id(FK), vendor_id(FK), supplier_id(FK), installation_date, warranty_expiry, service_contract_expiry, condition(enum), status(enum), purchase_date, purchase_cost, source, deleted_at |
| asset_status_history  | id, asset_id(FK,CASCADE), old_status, new_status, old_condition, new_condition, changed_by(FK), changed_at |
| equipment_documents   | id, asset_id(FK,SET NULL), document_type(enum), title, file_path, file_size, mime_type, uploaded_by |
| installation_records  | id, asset_id(FK), installed_by, installation_date, commissioning_date, acceptance_checklist(JSONB[]) |

condition enum: functional / needs_repair / non_functional / under_maintenance / decommissioned
status enum: active / inactive / disposed / in_storage

### Maintenance (Migration 00004)
| Table                    | Key columns                                                         |
|--------------------------|---------------------------------------------------------------------|
| maintenance_requests     | id, request_number(UQ), asset_id(FK), requested_by(FK), department_id(FK), fault_description, urgency(enum), status(enum), reported_condition(text,nullable CHECK functional_issue/needs_repair/non_functional — 00038), reported_condition_source(text,nullable — 00038) |
| work_orders              | id, work_order_number(UQ), request_id(FK), asset_id(FK), assigned_to(FK), status(enum), priority(enum), work_type(enum), completion_outcome(text,nullable CHECK resolved/partially_resolved/not_resolved/awaiting_parts_or_vendor — 00039), final_equipment_condition(text,nullable CHECK functional/needs_repair/non_functional/under_maintenance — 00039) |
| maintenance_events       | id, work_order_id(FK), asset_id(FK), event_type(enum), failure_date, downtime_start, downtime_end, repair_duration_hours (CHECK ≥0 when set — migration 00029), failure_code_id(FK), action_code_id(FK), service_cost |
| downtime_logs            | id, asset_id(FK), event_id(FK), start_time, end_time, duration_hours (CHECK ≥0 when set — migration 00029) |
| maintenance_parts_used   | id, event_id(FK), spare_part_id(FK), quantity_used, unit_cost       |

maintenance_requests status enum: pending / approved / assigned / in_progress / completed / rejected / canceled
work_orders status enum: open / assigned / in_progress / on_hold / completed / canceled

### Preventive Maintenance (Migration 00005)
| Table          | Key columns                                                                       |
|----------------|-----------------------------------------------------------------------------------|
| pm_plans       | id, asset_id(FK), template_id(FK), name, frequency_days, next_due_date, last_completed_date, is_active |
| pm_schedules   | id, plan_id(FK), asset_id(FK), scheduled_date, status(enum), assigned_to(FK profiles), completed_by(FK profiles), completion/defer evidence |
| pm_checklists  | id, schedule_id(FK), items(JSONB)                                                 |
| pm_completions | id, schedule_id(FK), completed_by(FK), completion_date, duration_hours, checklist_results(JSONB) |

pm_schedules status enum: scheduled / completed / overdue / skipped / deferred / in_progress / canceled

### Calibration (Migration 00006)
| Table                    | Key columns                                                           |
|--------------------------|-----------------------------------------------------------------------|
| calibration_requests     | id, request_number(UQ), asset_id(FK), requested_by(FK), calibration_type_id(FK), urgency, status |
| calibration_records      | id, asset_id(FK), calibration_type_id(FK), calibrated_by(FK), calibration_date, next_due_date, result(pass/fail/adjusted) |
| calibration_certificates | id, record_id(FK), file_path, issued_by, issue_date                  |

### Logistics / Spare Parts (Migration 00007)
| Table          | Key columns                                                                         |
|----------------|-------------------------------------------------------------------------------------|
| spare_parts    | id, part_code(UQ), name, category, unit, reorder_level, current_stock, unit_cost, is_active |
| stock_receipts | id, part_id(FK), quantity, received_by(FK), received_date, supplier_id(FK), invoice_ref |
| stock_issues   | id, part_id(FK), quantity, issued_to_event_id(FK), issued_by(FK), department_id(FK) |

### Training (Migration 00008)
| Table                      | Key columns                                                         |
|----------------------------|---------------------------------------------------------------------|
| training_requests          | id, request_number(UQ), asset_id(FK), requested_by(FK), department_id(FK), training_type(enum), status |
| training_sessions          | id, title, asset_id(FK), category_id(FK), trainer, training_date, duration_hours |
| staff_training_records     | id, session_id(FK), staff_user_id(FK), status(registered/attended/absent/certified) |
| equipment_training_records | id, asset_id(FK), session_id(FK), topics_covered                    |

### Disposal (Migration 00009)
| Table              | Key columns                                                                    |
|--------------------|--------------------------------------------------------------------------------|
| disposal_requests  | id, request_number(UQ), asset_id(FK), requested_by(FK), reason, disposal_method_proposed(enum), status |
| disposed_assets    | id, asset_id(FK), disposal_request_id(FK), disposal_date, disposal_method, disposal_value |

### Analytics / Computed Metrics (Migration 00010)
| Table                         | Key columns                                                        |
|-------------------------------|---------------------------------------------------------------------|
| equipment_reliability_metrics | id, asset_id(FK,CASCADE), period_start, period_end, mttr_hours, mtbf_hours, **availability_ratio** (DECIMAL 0–1, not availability_percentage), total_downtime_hours, failure_count — **one row per asset**: UNIQUE index idx_reliability_metrics_asset_unique(asset_id) (migrations 00034–00035) |
| equipment_risk_scores         | id, asset_id(FK,CASCADE), severity(1-10), occurrence(1-10), detectability(1-10), rpn(GENERATED AS S*O*D), risk_level(GENERATED), assessed_at |
| pm_compliance_metrics         | id, department_id(FK), category_id(FK), asset_id(FK), period_start, period_end, scheduled_count, completed_count, pmc_percentage(GENERATED) — UNIQUE grain NULLS NOT DISTINCT (00029) |
| equipment_performance_scores  | id, asset_id(FK), period_start, period_end, normalized_availability, normalized_mttr, normalized_downtime, normalized_pmc, normalized_failure_rate, composite_score, weights_profile_id(FK) |
| replacement_priority_scores   | id, asset_id(FK), period_start, period_end, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, rank, justification |
| recommendation_flags          | id, asset_id(FK), flag_type(enum), severity(enum), message, details(JSONB), is_acknowledged, acknowledged_by(FK), generated_at, expires_at |

risk_level: critical (RPN≥500) / high (≥200) / medium (≥80) / low (<80)
flag_type enum: urgent_maintenance / monitor_closely / prioritize_pm / calibrate_soon / replacement_candidate / recurring_failure / part_shortage / high_risk / low_availability / overdue_pm / warranty_expiring / contract_expiring / low_stock (00029)

### Decision Support / Command Center (Migration 00013)
| Table                            | Key columns                                                     |
|----------------------------------|------------------------------------------------------------------|
| triage_action_queue              | id, asset_id(FK), priority_score(NUMERIC), status(enum), recommendation, rationale(JSONB[]), generated_at, due_by, assigned_to |
| equipment_health_snapshots       | id, asset_id(FK), snapshot_date, health_score(INT 1-100), explanation(JSONB) |
| clinical_readiness_snapshots     | id, department_id(FK), snapshot_date, readiness_score(INT), essential_total, essential_functional |
| workload_capacity_snapshots      | id, assignee_id(FK profiles), snapshot_date, open_assignments, overdue_assignments, estimated_hours |
| decision_support_refresh_log     | id, started_at, finished_at, status(running/success/error), error_message, triggered_by(FK profiles), scope(asset/all), asset_id(FK) — created in 00021 |
| procurement_requests             | id, request_number(UQ), title, justification, status(enum), priority, requested_by(FK), department_id(FK) |
| command_center_acknowledgements  | id, profile_id(FK), item_type, item_key, asset_id(FK), signal_hash, acknowledged_at, snoozed_until, reason — migration 00037 |

procurement status enum: requested / approved / ordered / in_transit / delivered / canceled
NEVER use 'under_review' — it is not a valid value.

### Chatbot (Migration 00015)
| Table          | Key columns                                                                              |
|----------------|------------------------------------------------------------------------------------------|
| chat_sessions  | id, user_id(FK profiles,CASCADE), title, asset_id(FK equipment_assets,NULL), work_order_id(FK,NULL), department_id(FK,NULL) — column renamed from equipment_id in 00033 |
| chat_messages  | id, session_id(FK,CASCADE), role(user/assistant), content(TEXT), intent, decision(enum), answer_basis, confidence(enum), metadata(JSONB) |

RLS: chat_sessions — owner select/insert/update, admin can see all. chat_messages inherit.

### Offline Sync (Migration 00017)
| Table                | Key columns                                                                    |
|----------------------|---------------------------------------------------------------------------------|
| offline_sync_events  | id, client_action_id, actor_user_id(FK), entity_type, entity_id, action_type, payload(JSONB), sync_status(pending/synced/failed), synced_at |

---

## Database views (alter via new migrations only; 00031 refreshed several read models)

| View               | Purpose                                                         |
|--------------------|-----------------------------------------------------------------|
| v_dashboard_stats         | Aggregates: total_equipment, functional_count, open_work_orders, overdue_pm, calibration_due_soon, low_stock_parts, pending_disposals |
| v_open_work_orders        | Open WOs excluding soft-deleted equipment — migration 00031 |
| v_overdue_pm              | PM schedules overdue / past scheduled_date; excludes soft-deleted assets — 00031 |
| v_calibration_due         | Calibration due soon; excludes soft-deleted assets — 00031 |
| v_low_stock_parts         | spare_parts where current_stock <= reorder_level               |
| v_equipment_summary       | Equipment with joined department/category/manufacturer/model  |
| v_command_center_triage   | triage_action_queue + asset/dept context + top open flag per asset (security_invoker) — 00021 |
| v_asset_health_summary    | Latest health snapshot per asset (DISTINCT ON asset_id) — 00021 |
| v_department_readiness    | Latest readiness snapshot per department (DISTINCT ON dept_id) — 00021 |
| v_replacement_decision    | Latest replacement score + COALESCE on joined analytics — 00031 |
| v_maintenance_risk_context | Per active asset; COALESCE availability; part_shortage/low_stock flags — 00031 |

---

## SQL functions reference (do not modify — add new ones instead)

| Function                                   | Migration | Notes                                        |
|--------------------------------------------|-----------|----------------------------------------------|
| update_updated_at_column()                 | 00002     | Trigger fn for updated_at                    |
| auth_user_has_role(role_name TEXT)         | 00012     | RLS helper — checks current user's role      |
| auth_user_in_department(dept_id UUID)      | 00012     | RLS helper — checks current user's dept      |
| fn_compute_mtbf(asset_id)                  | 00011     | MTBF = operational_hours / failure_count     |
| fn_compute_mttr(asset_id)                  | 00011     | MTTR = repair_hours / repair_count           |
| fn_compute_availability(asset_id)          | 00011     | A = MTBF / (MTBF + MTTR)                     |
| fn_compute_pmc(asset_id)                   | 00011     | PMC = (completed / scheduled) × 100         |
| compute_equipment_reliability_metrics(id)  | 00011     | SECURITY DEFINER — writes reliability table  |
| compute_equipment_risk_scores(id)          | 00011     | SECURITY DEFINER — writes risk table         |
| compute_pm_compliance_metrics(id)          | 00011     | SECURITY DEFINER — writes PMC table          |
| compute_equipment_performance_scores(id)   | 00011     | SECURITY DEFINER — writes performance table  |
| generate_recommendation_flags(id)                  | 00011     | SECURITY DEFINER — writes flags table        |
| _recompute_asset_metrics(p_asset_id)               | 00023, 00034 | INTERNAL — reliability UPSERT ON CONFLICT(asset_id); PMC (department_id/category_id) |
| recompute_equipment_analytics(p_asset_id)          | 00019     | SECURITY DEFINER — _recompute + baseline + refresh |
| recompute_all_equipment_analytics()                | 00023     | SECURITY DEFINER — loops all assets + replacement scores |
| refresh_decision_support_snapshots()               | 00023     | SECURITY DEFINER — DELETE all 'open' triage rows before re-inserting (fixed accumulation) |
| _ensure_baseline_risk_scores()                     | 00019     | INTERNAL — ensures every asset has a risk row |
| compute_replacement_priority_scores_all()          | 00023     | SECURITY DEFINER — scores all 80 active assets; weights_profile_id IS NULL to distinguish from seed |
| asset_passes_health_criteria(id)                   | 00013     | SECURITY DEFINER — health qualification check |

New SQL functions must use SECURITY DEFINER if they touch analytics or decision support tables.

---

## Service inventory — every exported function

### analytics.service.ts
- getReliabilityMetrics(filters) — queries equipment_reliability_metrics, joins equipment_assets
- getRiskScores(filters) — queries equipment_risk_scores
- getPMComplianceMetrics(filters) — queries pm_compliance_metrics, joins departments
- getPerformanceScores(filters) — queries equipment_performance_scores
- getReplacementPriorities(filters) — queries replacement_priority_scores WHERE weights_profile_id IS NULL (computed rows only), ordered by rank
- getRecommendationFlags(filters) — queries recommendation_flags ordered by generated_at DESC
- acknowledgeFlag(id) — marks recommendation_flags.is_acknowledged; sets acknowledged_by to current profile id (not auth.users.id)

### audit.service.ts
- getCurrentProfileId() — gets current auth user's profile UUID
- logAuditEvent(params) — inserts audit_logs with user_id, performed_by (same profile), optional details JSONB; returns `{ success, error? }`; failures use console.error in all environments

### auth.service.ts (client-side only)
- signIn(email, password), signUp(email, password), signOut()
- resetPassword(email), updatePassword(newPassword)

### calibration.service.ts
- getCalibrationRecords(filters), createCalibrationRecord(data)
- getCalibrationRequests(), createCalibrationRequest(data) — request_number: CAL-{timestamp}
- getUpcomingCalibrations(days)

### dashboard.service.ts
- getDashboardStats() — queries v_dashboard_stats (single-row aggregate)
- getEquipmentByDepartment() — groups equipment_assets by department_id
- getEquipmentByCondition() — groups equipment_assets by condition
- getRecentAlerts() — recommendation_flags where is_acknowledged=false, LIMIT 10
- getOpenWorkOrders() — v_open_work_orders, LIMIT 10
- getOverduePM() — v_overdue_pm, LIMIT 10

### decision-support.service.ts
- refreshDecisionSupportSnapshots() — RPC: refresh_decision_support_snapshots()
- computeFromOperationalData() — falls back to live query when snapshots are stale
- getDecisionSupportSnapshot() — reads snapshot tables, falls back to computeFromOperationalData

### disposal.service.ts
- getDisposalRequests(filters), createDisposalRequest(data) — request_number: DSP-{timestamp}
- updateDisposalRequestStatus(id, status), createDisposedAsset(data)

### documents.service.ts
- getDocuments(assetId), uploadDocument(file, assetId, metadata), deleteDocument(id)
- Uploads to Supabase Storage bucket 'equipment-documents'

### equipment.service.ts
- getEquipmentList(filters) — joins departments/categories/manufacturers/models, filters deleted_at IS NULL
- getEquipmentById(id), createEquipment(data), updateEquipment(id, data), deleteEquipment(id)
- asset_code auto-uppercased, createEquipment checks for duplicates, all mutations log audit

### Equipment utilities — src/utils/equipment/
- condition-labels.ts: formatEquipmentCondition(condition), getConditionBadgeClass(condition), EQUIPMENT_CONDITION_OPTIONS, isFaulted(condition)
- maintenance-state.ts: getMaintenanceState(condition, openRequest?, openWO?), formatMaintenanceState(state), getMaintenanceStateBadgeClass(state), types MaintenanceState/OpenRequestInfo/OpenWorkOrderInfo
- Canonical condition labels: functional→"Functional", needs_repair→"Needs repair", non_functional→"Non-functional", under_maintenance→"Under maintenance", decommissioned→"Decommissioned"
- NEVER use "Non Functional" (no hyphen), "none functional", or "not functional"

### maintenance.service.ts
- getMaintenanceRequests(filters), getRequestById(id)
- createRequest(data) — request_number: MR-{timestamp}
- updateRequestStatus(id, status) — sets resolved_at if completed
- getWorkOrders(filters), getWorkOrderById(id)
- createWorkOrder(data) — work_order_number: WO-{timestamp}
- updateWorkOrder(id, data) — triggers recomputeAssetAnalytics if status='completed'
- getMaintenanceEvents(assetId), createMaintenanceEvent(data)
- getOpenMaintenanceRequests() — all requests with status in pending/approved/assigned/in_progress (uses OPEN_MAINTENANCE_REQUEST_STATUSES)
- getOpenWorkOrders() — all work orders with status in open/assigned/in_progress/on_hold (no filters)
- getOpenRequestsForAsset(assetId) — open requests for a specific asset; includes reported_condition + reported_condition_source
- getOpenWorkOrdersForAsset(assetId) — open work orders for a specific asset
- getLastCompletedWorkOrderForAsset(assetId) — last completed WO; returns completion_outcome + final_equipment_condition
- getWorkOrdersByRequestId(requestId) — all WOs linked via request_id; returns full WORK_ORDER_SELECT
- getOpenCorrectiveRequestForAsset(assetId) — returns OpenCorrectiveRequestDetail | null (id, request_number, status, urgency, reported_condition, fault_description, created_at); used by duplicate prevention guards

### pm.service.ts
- getPMPlans(filters), createPMPlan(data)
- getPMSchedules(filters), updateScheduleStatus(id, status)
- createPMCompletion(data) — triggers recomputeAssetAnalytics
- getOverduePMSchedules() — queries v_overdue_pm

### procurement.service.ts
- getProcurementPipeline() — queries procurement_requests ordered by created_at DESC
- createProcurementRequest(payload) — request_number: PR-{timestamp}

### reports.service.ts
- getEquipmentReport(filters), getMaintenanceReport(filters), getPMReport(filters)
- getCalibrationReport(filters), getTrainingReport(filters)
- getSparePartsReport(filters), getDisposalReport(filters)

### settings.service.ts (generic reference data CRUD)
- getAll(table), getById(table, id), create(table, data), update(table, id, data), remove(table, id)
- Allowed tables: departments, equipment_categories, manufacturers, equipment_models, vendors,
  suppliers, failure_codes, maintenance_action_codes, calibration_types, pm_templates,
  scoring_weights, memis_lookup_values
- All mutations log audit events

### spare-parts.service.ts
- getSpareParts(filters), createSparePart(data), updateSparePart(id, data)
- getStockReceipts(partId), createStockReceipt(data) — manually increments current_stock
- getStockIssues(partId), createStockIssue(data) — validates stock, manually decrements
- getLowStockParts() — queries v_low_stock_parts
- KNOWN RACE CONDITION: stock updates use two separate queries (no transaction) — do not copy

### training.service.ts
- getTrainingSessions(filters), createTrainingSession(data)
- getStaffTrainingRecords(sessionId), createStaffTrainingRecord(data)
- getTrainingRequests(), createTrainingRequest(data) — request_number: TR-{timestamp}

### users.service.ts
- getProfiles() — is_active=true, joins departments + user_roles + roles
- getProfileById(id), updateProfile(id, data)
- getRoles(), assignRole(userId, roleId), removeRole(userId, roleId)

---

## Component inventory

### src/components/ui/ — always check here before building new UI

| Component       | Props summary                                                              |
|-----------------|----------------------------------------------------------------------------|
| Badge           | label, color?, variant?('default'/'outline'/'pill')                        |
| Button          | variant?('primary'/'secondary'/'danger'/'outline'), size?('sm'/'md'/'lg'), children |
| Card            | title?, description?, footer?, className?, children                        |
| ConfirmDialog   | open, title, message, onConfirm, onCancel                                  |
| DataTable<T>    | columns: ColumnDef<T>[], data: T[], onRowClick?                            |
| Dropdown        | label, options: Option[], onSelect                                         |
| EmptyState      | icon?, title, description?, action?                                        |
| ExpandableText  | text, maxLength?                                                           |
| FilterBar       | filters: Filter[], onApply                                                 |
| Input           | extends InputHTMLAttributes + label?, error?, icon?                        |
| Modal           | open, title, onClose, children                                             |
| PageHeader      | title, description?, action?                                               |
| Pagination      | current, total, onPageChange                                               |
| SearchInput     | placeholder?, onSearch (debounced)                                         |
| Select          | label?, options: Option[], value?, onChange                                |
| Spinner         | size?('sm'/'md'/'lg'), label?                                              |
| StatCard        | label, value: string|number, trend?, icon?                                 |
| StatusBadge     | status, variant?('primary'/'warning'/'success'/'danger')                   |
| Table           | headers: string[], rows: any[][], onRowClick?                              |
| Tabs            | tabs: Tab[], onTabChange                                                   |
| Textarea        | extends TextareaHTMLAttributes + label?, error?                            |
| Toast           | message, type?('success'/'error'/'info'/'warning'), duration?              |

### src/components/charts/
- BarChart, LineChart, DoughnutChart, GaugeChart, HorizontalBarChart — all Chart.js wrappers
- ChartCard — card wrapper with title/legend
- useChartTheme — custom hook applying CSS variable colors to Chart.js
- No gradients on charts — flat colors only (CSS variable colors)

### src/components/layout/
- Sidebar.tsx — role-filtered navigation, highlights active route
- Topbar.tsx — user profile, theme toggle, search
- DashboardLayout.tsx — wraps Sidebar + Topbar + main content

### src/components/assistant/
- AssistantPanel.tsx — right-panel chat history + input
- AssistantProvider.tsx — context for session, messages, input state
- AskAiButton.tsx — floating action button
- AssistantContextChips.tsx — resolved context display (equipment, work order, dept)
- AssistantLauncher.tsx — launcher widget
- AssistantMessageCard.tsx — message display with decision/confidence badges
- assistant-ui-display.ts — maps ChatDecision → UI display strings

### src/components/theme/
- ThemeProvider.tsx — React context, reads/writes THEME_COOKIE_KEY cookie
- ThemeToggle.tsx — light/dark switch
- ThemeScript.tsx — inline script to prevent FOUC (runs before React hydrates)
- theme-contract.ts — defines CSS custom property names

---

## Routing rules

- Canonical equipment (biomedical assets) route: /equipment
- /inventory and /inventory/[id] exist as redirect/alias pages to /equipment
- Sidebar must highlight "Equipment" for both /inventory and /equipment paths
- /command is the home page — no separate /dashboard page
- /command/health and /command/triage are sub-pages, not in main sidebar
- Deprecated analytics/dashboard redirects live in src/middleware.ts; /inventory aliases are page-level redirects

---

## Roles — exact strings used throughout codebase

```
'developer'       — super-role for testing: passes all role checks (admin+technician+store_user+dept_user+viewer)
'admin'           — full access, all CRUD, user management, analytics, audit
'technician'      — equipment, work orders, PM, calibration, maintenance
'department_user' — request maintenance/training, view own records
'store_user'      — spare parts, procurement, logistics
'viewer'          — read-only, no mutation buttons
```

NEVER use 'engineer' — caused a silent bug in chatbot task-data-loaders.ts.
NEVER use 'Admin' (capital A) — role comparison is case-sensitive.
Viewer role must never see create/edit/delete/approve/acknowledge buttons.
'developer' role exists in roles table (id b1000001-0000-0000-0000-000000000006).
useRole() treats developer as true for all isAdmin/isTechnician/etc flags.
RLS policies do NOT include 'developer' — the profile also has 'admin' to satisfy RLS.

### Navigation access by role (from src/constants/index.ts NAV_SECTIONS)
```
Command:     all roles
Equipment:   all roles
Maintenance: admin, technician, department_user
PM:          admin, technician
Calibration: admin, technician
Spare Parts: admin, technician, store_user
Procurement: admin, technician, store_user
Logistics:   admin, technician, store_user
Training:    admin, technician, department_user
Users:       admin only
Settings:    admin only
Audit:       admin only
Security:    admin only
```

### Server-side auth helpers (src/lib/auth/helpers.ts)
- requireAuth() — redirects to /login if not authenticated
- requireRole(allowedRoles[]) — redirects to / if user lacks required role
- Always call these in server components before rendering sensitive mutations

---

## Chatbot architecture

### Pipeline (src/services/chatbot/)
```
User message
  → assistant-orchestrator.ts
    → classifier-service.ts       (ChatIntent + CapabilityId, confidence score)
    → entity-resolution-service.ts (equipment_id, work_order_id, dept_id)
    → task-context-service.ts     (loads grounded data blocks for capability)
    → safety-service.ts           (role scope, data access, unsafe content check)
    → [if blocked] → return REFUSE/ESCALATE immediately
    → prompt-service.ts           (builds system + user prompt with context)
    → llm-service.ts              (Gemini call)
    → chat-response-normalizer.ts (validate schema, recover parsing errors)
    → telemetry-service.ts        (log intent, capability, confidence, latency, role)
  → ChatResponse
```

### 18 registered capabilities (capability-registry.ts)
assistant_intro, general_conversation, off_topic_safe, my_tasks, prioritize_tasks,
summarize_work_order, summarize_equipment, explain_equipment_risk, explain_pm_status,
summarize_alerts, safe_troubleshooting, maintenance_tips, logistics_status,
procurement_status, summarize_department_readiness, training_status, disposal_status,
unsafe_or_restricted, general_system_fallback

### Chatbot tools (src/services/chatbot/tools/)
- get-current-user-context — profile, department, roles, open assignments
- get-my-tasks — work orders (assigned to user), requests (dept scope), PM schedules
- get-work-order-summary — work order detail, asset, maintenance history
- get-equipment-summary — equipment detail, reliability, risk, maintenance history
- get-alerts-summary — unacknowledged recommendation_flags by severity
- get-department-readiness — essential equipment count + functional count
- get-safe-troubleshooting-context — equipment specs, common failures (NOT internal repair docs)
- get-inventory-logistics-status — low stock, receipts, issues, reorder status
- get-procurement-status — procurement requests + expected deliveries
- task-data-loaders.ts — shared data loading helpers (role-scoped queries)

### Decision outcomes
answer / limited_answer / check_manual / escalate / refuse

### Confidence levels
high (≥0.8) / medium (0.5–0.8) / low (<0.5)
Confidence < 0.5 returns limited_answer or escalate, not full LLM response.

---

## Analytics pipeline

Data flows: seed data → operational events → recompute RPCs → snapshot tables → services → UI

1. Operational events: work order completion, downtime logged, PM completed, equipment updated
2. Recompute trigger: updateWorkOrder(status=completed) or updateScheduleStatus(completed)
   → calls recomputeAssetAnalytics(assetId) → RPC recompute_equipment_analytics(p_asset_id)
3. RPC orchestrates in transaction:
   - compute_equipment_reliability_metrics → equipment_reliability_metrics
   - compute_equipment_risk_scores → equipment_risk_scores
   - compute_pm_compliance_metrics → pm_compliance_metrics
   - compute_equipment_performance_scores → equipment_performance_scores
   - compute_replacement_priority_scores → replacement_priority_scores
   - generate_recommendation_flags → recommendation_flags
   - refresh_decision_support_snapshots → triage + health + readiness + workload
4. TypeScript services read from snapshot tables (decision-support.service.ts falls back
   to computeFromOperationalData() if snapshots are stale > 7 days)
5. UI: /command reads decision-support.service, /inventory/[id] reads analytics.service

---

## Theme and CSS variables

Theme managed via src/components/theme/ThemeProvider.tsx + src/app/globals.css.
ThemeScript.tsx prevents FOUC by setting data-theme before hydration.

### Core CSS variables
```css
/* Light (default)             /* Dark (data-theme="dark") */
--background:   #f3f6fb        --background:   #070a14
--foreground:   #172033        --foreground:   #e6ebff
--surface-1:    #ffffff        --surface-1:    #0e1324
--surface-2:    #eef3fc        --surface-2:    #131a31
--surface-3:    #dde7f6        --surface-3:    #1a2340
--border-subtle:#c8d4e7        --border-subtle:#2a3352
--text-muted:   #5f6f8a        --text-muted:   #9ca8cf
--brand:        #4f46e5        --brand:        #7b61ff
--brand-strong: #4338ca        --brand-strong: #6a4dff
--danger:       #dc2626        --danger:       #f87171
--success:      #059669        --success:      #34d399
--warning:      #d97706        --warning:      #fbbf24

/* Assistant/Chatbot accent (gold, both themes) */
--assistant-accent:       #d6a547
--assistant-accent-soft:  rgba(214, 165, 71, 0.24)
```

---

## Export and reporting

PDF uses jsPDF (^4.2.1) + jspdf-autotable (^5.0.7) — IS installed and functional.
CSV export also available.
Export lives in src/utils/export.ts.
Report routes: /reports (selector) → /reports/[type] (Equipment/Maintenance/PM/Calibration/Training/SpareParts/Disposal).

---

## Testing

- Framework: Node.js native test runner via `tsx --test`
- Run: `npm run test:chatbot`
- Test files: src/services/chatbot/__tests__/*.test.ts
- No Jest, no Vitest, no Cypress/Playwright
- Coverage: chatbot pipeline (orchestrator, classifier, safety, context, memory, entity resolution)
- No UI component tests, no E2E tests

---

## Offline sync

Location: src/lib/offline/technician-queue.ts
Storage: localStorage key `memis.offline.workorder.queue.v1`
Server replay: src/actions/offline-sync.actions.ts
Scope: work-order `update_status` and `log_event` only; no background service worker.

Queue item shape:
```ts
interface OfflineWorkOrderAction {
  id: string          // auto-generated
  type: 'update_status' | 'log_event'
  workOrderId: string
  payload: Record<string, unknown>
  createdAt: string
  syncedAt?: string
  retryCount?: number
  lastError?: string
}
```

Functions: getOfflineQueue(), saveOfflineQueue(items), enqueueOfflineAction(action),
removeOfflineAction(id), markOfflineActionFailed(id, errorMessage)

Status:
- Enqueue to localStorage: DONE
- Persist across reloads: DONE
- Sync transport to server: NOT IMPLEMENTED
- Conflict resolution: NOT IMPLEMENTED

Do not use localStorage or sessionStorage for anything else — not supported across SSR.

---

## Environment variables

### Required
```
NEXT_PUBLIC_SUPABASE_URL       Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY  Supabase anon key
```

### Chatbot / AI (optional, falls back to deterministic responses)
```
AI_PROVIDER              "gemini"
GEMINI_API_KEY           Gemini API key
GEMINI_BASE_URL          Default: https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_MODEL             e.g. "gemini-2.5-flash"
GEMINI_TEMPERATURE       Default: 0.1
GEMINI_TIMEOUT_MS        Default: 12000
GEMINI_MAX_COMPLETION_TOKENS  Default: 900
CHAT_DEBUG_PROVIDER_FLOW "true" to enable debug logging in orchestrator
```

---

## Duplicate corrective request prevention

One active corrective maintenance request per asset is the rule.

**Active (open) statuses** — defined in `src/utils/maintenance/request-status.ts`:
- `pending`, `approved`, `assigned`, `in_progress`

**Closed statuses** — do NOT block new requests:
- `completed`, `rejected`, `canceled`

**Implementation layers:**

1. **Shared constants** (`src/utils/maintenance/request-status.ts`):
   - `OPEN_MAINTENANCE_REQUEST_STATUSES`, `CLOSED_MAINTENANCE_REQUEST_STATUSES`
   - `isOpenMaintenanceRequestStatus()`, `isClosedMaintenanceRequestStatus()`, `formatRequestStatus()`

2. **Service helper** (`maintenance.service.ts → getOpenCorrectiveRequestForAsset(assetId)`):
   - Returns `OpenCorrectiveRequestDetail | null`.
   - Used by the new-request page and any future UI that needs to check before showing Create Request.

3. **Server action guard** (`maintenance.actions.ts → createMaintenanceRequestAction()`):
   - Queries for existing open request before insert.
   - If found: returns `{ success: false, error: '...', data: { reason: 'duplicate_open_request', existingRequestId, existingRequestNumber, existingRequestStatus } }`.
   - This fires regardless of source (UI, direct POST, command center, etc.).

4. **UI layer** (`/maintenance/requests/new`):
   - On asset select, fetches `getOpenCorrectiveRequestForAsset(assetId)`.
   - If found: shows amber warning panel with "Open Existing Request" and "Back" buttons; Submit is disabled.
   - If server action still returns duplicate (race condition): redirects to existing request with `?duplicatePrevented=1`.

5. **Request detail page** (`/maintenance/requests/[id]`):
   - If `?duplicatePrevented=1` is in URL: shows amber banner "Duplicate request prevented. This existing open request was opened instead."

6. **Maintenance page recurring failure card**:
   - Checks `openRequestByAsset` map (derived from loaded `requests` array).
   - If open request exists for the recurring-failure asset: shows amber "Open Request (MR-xxx)" button instead of "Schedule diagnostic".

7. **Equipment list + detail** — already correct: show "Open Request" action when `openRequest` is set; "Create Request" only when no open request/WO exists.

8. **Command Center Needs Request triage** — already correct: `fetchActiveCorrectiveAssetIds()` excludes assets with open corrective work.

**No DB migration added** — a partial unique index would conflict with historical duplicate seed rows. Service/action guard is the enforcement layer.

---

## Offline Capability — Phase 1 Foundation (2026-05-16)

1. Offline/PWA is separate from QR. QR is complete through six phases; do not alter QR token generation, QR landing, QR labels, QR coverage, or QR scan evidence for offline work.
2. Phase 1 implements infrastructure only:
   - PWA manifest: `public/manifest.webmanifest`
   - Service worker: `public/sw.js`
   - Registration: `src/components/offline/ServiceWorkerRegister.tsx`
   - Offline fallback: `src/app/offline/page.tsx`
   - Connectivity: `src/hooks/useOnlineStatus.ts`
   - Dashboard banner/indicator: `OfflineStatusBanner`, `SyncStatusIndicator`
   - IndexedDB queue: `src/lib/offline/db.ts`, `src/lib/offline/queue.ts`
   - Types/model: `src/types/offline.ts`
   - Sync skeleton: `src/lib/offline/sync-engine.ts`, `SyncEngineProvider`
   - Role foundation: `src/lib/offline/offline-permissions.ts`
   - Diagnostics: Developer Lab `OfflineDiagnosticsPanel`
   - Design doc: `documents/offline-capability-design.md`
3. Service worker strategy is intentionally conservative: cache `/offline`, manifest, icons, health probe, and static assets. Do not cache authenticated server-rendered pages, Supabase auth/API responses, service-role data, sensitive reports, or broad operational datasets in Phase 1.
4. Offline works only after the device opens BMEDIS once online. PC/phone installation is optional; the service worker registration is what enables the cached shell.
5. New serious offline actions must use IndexedDB, not localStorage. Existing legacy `technician-queue.ts` remains only for the older work-order page and now uses Web Crypto IDs. Do not use `Math.random` for offline IDs.
6. Queue actions are not marked synced without server confirmation. Failed/conflict actions must remain visible and retryable/reviewable; do not silently delete them.
7. Phase 1 defines action categories but does not wire production workflows. Online-only actions include procurement/disposal approvals, QR token regeneration, user/settings/security changes, analytics refresh, final work-order closure/assignment, and replacement decisions.
8. Existing `offline_sync_events` has only pending/synced/failed. Conflict evidence is stored as `sync_status='failed'` with `payload.conflict_reason`; asset_id, role_name, queued_at, source_route, and errors are also stored in payload until a future migration expands the table.
9. Developer Lab diagnostics must show Unknown for unavailable browser/service-worker/cache state. Do not hardcode healthy statuses or fake queue rows.
10. Offline phases: Phase 1 Foundation/App Shell/Sync Infrastructure; Phase 2 Offline-Capable Role Workflows; Phase 3 Conflict Handling/Cached Read Views/Sync Evidence.

## Offline Capability — Phase 2 Role Workflows (2026-05-16)

1. Phase 2 implements useful offline capture for selected real workflows while keeping authority actions online-only.
2. Replay handler registry: `src/lib/offline/handlers/index.ts`. Domain handler files: `maintenance.ts`, `department-requests.ts`, and `store.ts`.
3. Server replay action: `syncOfflineQueuedActionAction()` in `src/actions/offline-sync.actions.ts`. It reloads the current authenticated profile, checks role offline permission, validates asset/QR/department scope when needed, calls existing server actions, and writes sync-event evidence.
4. Supported replay action types: `maintenance_request.create`, `department_issue.report`, `maintenance_event.log`, `qr_note.create`, `calibration_request.create`, `training_request.create`, `store_reorder.create`, `stock_receipt.draft`, `stock_issue.draft`, `work_order.start_intent`, `work_order.complete_draft`.
5. Integrated UI surfaces:
   - `/maintenance/requests/new`
   - `/maintenance/work-orders/[id]`
   - `/maintenance/work-orders/[id]/events/new`
   - `/calibration`
   - `/training`
   - `/requests` department view local queued rows
   - `/procurement/requests/new`
   - `/spare-parts` operational stock modals and store stock-control draft panel
   - `/qr/a/[token]` capture panels by role
6. Role behavior:
   - technicians: maintenance note/event, corrective request, parts-needed note, start intent, completion draft
   - department users/heads: maintenance/problem report, calibration request, training request
   - store users: reorder, receipt draft, issue draft
   - BME Head/Admin: draft notes only where exposed; no final approvals offline
   - viewer: no offline writes
   - developer: diagnostics/retry/inspect only; no fake production test actions
7. Conflict rules already used: missing/deleted asset, revoked QR token, wrong department, duplicate request, terminal work order, already-started work order, invalid stock quantity, inactive/missing spare part, insufficient stock, closed linked work order, and receipt drafts requiring procurement linkage unsupported by current schema.
8. Do not mark an offline action synced unless the handler receives server acceptance. Do not delete failed/conflict rows. Do not queue online-only actions such as procurement/disposal approval, QR token regeneration, analytics refresh, user/settings/security changes, replacement decisions, final assignment, or final work-order closure.
9. Phase 3 (2026-05-16) implements: full conflict engine, Sync Review Center, retry/resolution workflow, scoped cached read views, richer sync evidence reporting, Developer Lab diagnostics finalization, and an admin/bme_head Offline Sync Evidence report. Browser notification decisions and Background Sync API dependence are intentionally still out of scope.

## Offline Capability — Phase 3 Conflict Handling, Sync Review, Cached Reads (2026-05-16)

1. Phase 3 is the final planned offline phase. Phase 1 (app shell + IndexedDB queue + sync skeleton) and Phase 2 (workflow handlers) remain in place; Phase 3 adds safety + reviewability.
2. Conflict engine + validation: `src/lib/offline/conflicts.ts` (`OfflineConflictDetail`, `OfflineConflictType`, `buildConflictDetail`, `deriveConflictDetail`, `inferConflictTypeFromReason`, `conflictTypeLabel`) and `src/lib/offline/validation.ts` (typed helpers per conflict type). Original payload is never removed.
3. Conflict types: asset_missing/asset_deleted/department_scope_mismatch/duplicate_open_request/work_order_completed/work_order_status_changed/insufficient_stock/procurement_state_changed/stock_already_received/unsupported_action/permission_denied/stale_server_state/unknown_sync_error/invalid_payload/part_missing/part_inactive. Resolution statuses: conflict/under_review/resolved_synced/resolved_discarded/resolved_manual.
4. `OfflineQueueRecord` carries `conflict_detail`, `resolution_status`, `resolution_note`, `resolved_at`, `resolved_by`. New IndexedDB statuses: `under_review`, `resolved_discarded` (in addition to queued/syncing/synced/failed/conflict).
5. IndexedDB DB version bumped to 2. New `offline_read_cache` store for scoped cached reads — do not bump DB version again unless absolutely necessary (re-test upgrade path with seeded users).
6. Sync Review Center route: `/offline-sync` (`src/app/(dashboard)/offline-sync/page.tsx` + `SyncReviewCenterClient.tsx`). Gate: `admin` + `bme_head` (developer always passes via `requireRole`). Sidebar entry capability: `nav.offline_sync` (defined in `src/lib/rbac.ts`, granted to developer/admin/bme_head).
7. Local queue actions in Sync Review Center: Details modal (read-only), Open exact record, Retry, Mark Under Review, Manual Resolve (confirm dialog), Discard (confirm dialog). Raw payload is NEVER editable in the UI. Fixes happen on the source record then a retry, or the local draft is discarded.
8. Server resolution audit: `recordOfflineConflictResolutionAction(input)` writes `audit_logs` row and appends an `offline_sync_events` row with `reported_status` and `resolution_status` inside payload. Use this whenever resolving a conflict in the Sync Review Center.
9. Local queue helpers added in `src/lib/offline/queue.ts`: `markUnderReview`, `markResolvedDiscarded`, `markResolvedManual`, and `retryOfflineAction(id, { allowConflict })`. `clearSyncedActions()` now also clears `resolved_discarded` rows from IndexedDB. Conflict and pending_not_supported rows are NEVER auto-retried.
10. Cached read views: `src/lib/offline/cache.ts` exports `saveOfflineReadCache`, `getOfflineReadCache`, `clearOfflineReadCache`, `getCacheSummary`, `isCacheFresh`, `formatCacheAge`, plus `OfflineCacheScope` and `RoleCachedView`. Storage key includes `profile_id::role_name::department_id::cache_key`. Default freshness window is 12 hours.
11. Logout clears the current profile's caches in `src/app/(dashboard)/layout.tsx`. Do not switch to a global `clearOfflineReadCache()` on logout — multi-user shared devices must not lose another user's cached data.
12. Department equipment is the first cached read view wired in Phase 3 (`DepartmentEquipmentOverview`): cache fallback when live load fails, with the standard amber "Offline cached data — may be stale" banner and last-synced age. The scaffolding (`saveOfflineReadCache` + `getOfflineReadCache` + `OfflineCacheRegistrar`) is reusable for technician/store/viewer/BME Head views — opt in narrowly, do NOT auto-cache every page.
13. offline_sync_events: schema still pending/synced/failed only. Phase 3 stores `reported_status`, `conflict_detail`, `resolution_status`, `retry_count`, `role_name`, `source_route`, `asset_id`, `masked_qr_token`, `error_message` inside payload. Phase 3 uses `phase: 'offline.phase3.workflow-replay'` / `'offline.phase3.resolution'`. Service helpers in `src/services/offline-sync.service.ts` (`enrichSyncEvent`, `getOfflineSyncServerSummary`, `listOfflineSyncEvents`) reconstruct the richer view server-side.
14. Global sync indicator (`src/components/offline/SyncStatusIndicator.tsx`) now shows Needs Review count + Sync Review link for privileged users and last-sync-run summary. Do not move review/diagnostics links to non-privileged users.
15. Developer Lab Offline Diagnostics (`OfflineDiagnosticsPanel.tsx`) finalized: app shell version from `caches.keys()`, Offline Read Cache section, Local↔Server Mismatch Warnings, links to Sync Review Center and Offline Sync Evidence report. Keep the unknown-state honesty rule (no fake healthy badges).
16. Offline evidence report at `/reports/offline-sync-evidence` (admin/bme_head). Reads only `offline_sync_events`. Has CSV export with snapshot metadata header + print/save-as-PDF. Surfaced from `/reports` as `adminOnly` under Resource/Procurement/People.
17. Strict non-goals preserved: no browser notifications, no Background Sync API dependence, no offline procurement/disposal/user/settings/security/QR-token-admin actions, no offline analytics refresh/replacement decisions/final work-order closure or assignment, no fake reports, no fake cached data, no forced unsafe sync, no cross-user cache leakage, no all-hospital fallback for department cache, no viewer offline writes, no schema migration.
18. Static checks performed: no `service_role` in offline code, no `Math.random` in offline code, no fake/mock cached data, viewer write handlers absent, online-only actions still rejected at enqueue time and replay time. Manual checks (browser DevTools, multi-user logout/login isolation, live conflict scenarios) deferred to QA.

## Offline Capability — Phase 3 Completion Pass (2026-05-16)

1. All four documented next-step cached views wired:
   - Technician assigned work in `/work-orders` (cache key `technician.assigned_work`).
   - Store stock list in `/spare-parts` (cache key `store.stock_list`).
   - Viewer executive snapshot in `/command` (cache key `viewer.executive_summary`).
   - BME Head operational summary in `/command` (cache key `bme_head.operational_summary`).
   Each falls back to its IndexedDB cache on live load failure and renders the standard amber stale banner with last-synced age.
2. Server-rendered pages (`/command`) persist their snapshot via `OfflineCacheRegistrar` client component. Client pages (`/work-orders`, `/spare-parts`, `/equipment`) read and write cache inline in their useEffect data loader.
3. `/offline` fallback page now also renders `CachedSnapshotList`, a small client that lists this device's cached views (scoped to the current profile/role/department) and links back to the operational routes.
4. Migration 00046 — `offline_sync_events` Phase 3 schema:
   - New columns: `reported_status`, `resolution_status`, `conflict_type`, `conflict_reason`, `error_message`, `role_name`, `source_route`, `asset_id`, `retry_count`, `resolved_by`, `resolved_at`.
   - CHECK on `sync_status` relaxed to accept all Phase 3 statuses while still accepting legacy `pending|synced|failed`.
   - New CHECK on `resolution_status` constrains it to the resolution enum.
   - Indexes: created_at DESC, (actor_user_id, created_at DESC), action_type, conflict_type, reported_status, asset_id.
   - One-shot backfill copies the most important payload fields into the new columns for historical rows (idempotent).
   - RLS UPDATE policy reaffirmed for `bme_head` alongside admin/developer/technician so Sync Review Center can patch resolution columns.
5. `recordOfflineSyncEventAction` writes BOTH the new columns and the payload mirror. `recordOfflineConflictResolutionAction` writes resolution_status/resolved_by/resolved_at/role_name into columns. Service `enrichSyncEvent` prefers columns when present, falls back to payload for pre-migration rows.
6. After applying migration 00046 with `supabase db push --linked`, regenerate Supabase types: `npx supabase gen types typescript --linked > src/types/database.ts`. Historical note: migration 00047 is now used by Copilot Phase 1; next migration is 00048.
7. IndexedDB v1→v2 upgrade path verified: `onupgradeneeded` uses an explicit `oldVersion` check. v0→v1 creates `offline_actions`; v1→v2 adds `offline_read_cache` WITHOUT touching the existing queue store. Queued offline actions survive the upgrade.
8. Build, tsc, and lint clean. Manual browser validation (multi-user logout/login cache isolation, IDB v1→v2 with pre-existing queue, post-migration event insertion) deferred to QA.

## AI Copilot Upgrade — Phase 1 (2026-05-16)

1. Central copilot RBAC lives in `src/services/chatbot/copilot-rbac.ts`. Use it for chat/context decisions; do not reintroduce `roleNames[0]` or `admin`-only checks.
2. Final copilot roles are developer, admin, bme_head, technician, department_head, department_user, store_user, and viewer. Developer gets raw diagnostics; admin/bme_head get operational breadth; department roles stay department-scoped; store_user stays logistics-scoped; viewer is read-only.
3. Provider output normalization is in `src/services/chatbot/assistant-response-pipeline.ts`. It must always return schema-safe `AssistantContent` and parser metadata; malformed Gemini output must never reach the UI raw.
4. App-tracked Gemini usage is stored in `copilot_usage_events` (migration `00047_copilot_usage_tracking.sql`). This is BMEDIS request/token tracking, not the Google AI Studio billing dashboard. If provider tokens are absent, estimate tokens by character count and mark usage as estimated.
5. Usage limits live in `src/services/chatbot/usage-limits.ts`. Hard blocking is off unless `COPILOT_HARD_LIMIT_ENABLED=true`; otherwise show warnings only.
6. Developer Lab has AI Copilot Diagnostics via `CopilotDiagnosticsSection`, `CopilotDiagnosticsClient`, and `src/actions/copilot-diagnostics.actions.ts`.
7. AssistantPanel shows the signed-in user's own app-tracked usage status from `/api/chat` GET/POST responses.
8. New/planned capabilities added: `qr_asset_context`, `offline_sync_status`, `report_summary`, `metric_debug`, `copilot_diagnostics`, and `usage_status`. Do not claim page-aware workflows or mutation execution until later phases implement tools/drafts.
9. Architecture notes live in `documents/copilot-architecture.md`.

## Known bugs — do not repeat these

1. task-data-loaders.ts previously checked role 'engineer' — fixed to 'technician'.
   Do not re-introduce 'engineer' anywhere.

2. task-data-loaders.ts previously queried procurement_requests with status 'under_review'
   which is not a valid enum value. Valid values: requested / approved / ordered /
   in_transit / delivered / canceled. Fixed — do not re-introduce 'under_review'.

3. spare-parts.service.ts race condition: createStockReceipt and createStockIssue
   manually increment/decrement current_stock with two separate queries (no transaction).
   Known deferred issue — do not copy this pattern elsewhere.

4. FIXED (migration 00023) — triage_action_queue accumulation resolved. DELETE now removes
   ALL rows WHERE status='open' before re-inserting. Table now holds exactly 80 open rows.

5. Supabase analytics queries may return "No data" when seed data exists — check column
   names match migration 00010 exactly. The join key is asset_id (not equipment_id).

6. RESOLVED (2026-05-05, migrations 00028 + app) — logAuditEvent() now sets performed_by,
   optional details, returns success flag, and uses console.error on failure. Callers should
   check the return value when compliance matters.

7. RESOLVED/PARTIAL HARDENING (2026-05-07) — operational writes now route through
   server actions with server-side role checks, audit logging, and revalidation.
   Some interactive pages remain client components for read/form UX; do not add new
   client-side mutation calls that bypass src/actions/.

8. Cascading deletes: asset_status_history has ON DELETE CASCADE on asset_id.
   equipment_locations table removed in migration 00032 (unused). Equipment uses
   soft-delete (deleted_at) so physical DELETE should never be called on equipment_assets directly.

9. FIXED (migration 00023) — compute_replacement_priority_scores_all() now computes scores for
   all 80 active assets using min-max normalized weighted sum (weights: age 0.15, failure 0.15,
   availability 0.20 inverted, burden 0.15, spare 0.10, risk 0.15, cost 0.10). Computed rows use
   weights_profile_id IS NULL to distinguish from 8 original seed rows. getReplacementPriorities()
   filters to computed rows. Called automatically by recompute_all_equipment_analytics().

10. Ghost migration risk: if a migration is marked 'applied' in supabase_migrations but
    the DDL was never executed, the objects won't exist. Verify with:
      SELECT viewname FROM pg_views WHERE schemaname='public';
      SELECT tablename FROM pg_tables WHERE schemaname='public';
    To fix: supabase migration repair --status reverted <N> --linked && supabase db push --linked
    This happened to migration 00021 (fixed 2026-05-03).

---

## What not to do

- Do not use localStorage or sessionStorage for new offline capability; serious offline actions use IndexedDB
- Do not import recharts — it is not installed
- Do not add gradients to visualizations — flat colors only (CSS variables)
- Do not add decorative orbs, blur effects, or glassmorphism
- Do not use useEffect for initial data fetching in server components
- Do not create a Supabase client outside of src/lib/supabase/
- Do not modify seed files (supabase/seed/)
- Do not modify migrations 00001–00067; next migration is 00068
- Do not add npm dependencies without checking existing packages first
  (chart.js, jsPDF, jspdf-autotable, lucide-react, zod, date-fns are all available)
- Do not use rounded-2xl on cards — rounded-lg maximum
- Do not add heavy box-shadows to cards — use subtle border (var(--border-subtle))
- Do not fake or stub data — render EmptyState instead
- Do not call services directly from client components — use server components or actions

---

## Performance targets

- /command full render: under 800ms on seed data
- Use Promise.all() for all parallel data fetches on a single page
- LIMIT clauses must have a comment explaining the limit
- Never use a small LIMIT (< 100) on an analytics query unless intentionally top-N
- Decision support snapshots are refreshed daily — reads are fast (no recomputation)
- recompute_all_equipment_analytics() is synchronous DB transaction — may timeout on
  large datasets; call only from admin UI, not automatically on every page load

---

## Deployment notes

1. Migrations must be applied in order: 00001 → 00022+
2. Seed scripts must be run after deployment to populate reference data
3. Decision support snapshots need periodic refresh — either via cron job calling
   refresh_decision_support_snapshots() or via the Command Center refresh button
4. Chatbot gracefully falls back to deterministic structured responses if Gemini API
   key is missing or API call fails
5. Storage bucket 'equipment-documents' must be created with appropriate RLS policies
6. Supabase Auth users must be created and linked to profiles via
   supabase/seed/99_link_auth_users.sql for RLS to work with seeded data

---

## AI Copilot Upgrade — Phase 2 (2026-05-16)

1. Page-aware copilot context bridge: use `src/components/assistant/AssistantPageContextBridge.tsx` to register lightweight page context with the global assistant. Do not rely on pathname-only inference for new major pages.
2. Safe `ChatModuleContext` fields include module/page labels, route/pathname, active tab, search, selected record type/id/label, report type, QR token, offline status, queue status, page summary, role hints, page data hints, visible counts, current filters, and evidence links. Keep this bounded; never send full table rows through module context.
3. Covered pages include Command Center, Equipment list/detail, Maintenance list/request/work-order detail, Requests Hub, PM, Calibration, Spare Parts, Logistics, Procurement, Training, Replacement, Disposal, Alerts, Calendar, Reports/index/detail, Offline Sync, QR Coverage, QR Scans, QR landing, and Developer Lab.
4. Formal copilot tool contracts live in `src/services/chatbot/tools/tool-types.ts`, `tool-registry.ts`, and `tool-executor.ts`. Tools are read-only in Phase 2 and return `{ ok, data, evidenceSignals, sourceTables, routeLinks, warnings, deniedReason, staleDataWarning }`.
5. Tool access must validate roles and required context before querying. Department roles stay department-scoped. Developer/admin/bme_head have operational broad reads. Developer-only diagnostics remain developer-only. Store, technician, and viewer selected-record reads must not become all-hospital data fetches.
6. Exact route link helpers live in `src/services/chatbot/route-link-builder.ts`; use these for assistant evidence links to equipment, work orders, maintenance requests, PM schedules, calibration records/requests, procurement evidence, replacement evidence, reports, QR, offline sync, and Developer Lab.
7. Assistant responses support `evidence_used`, `links`, `limitations`, `data_freshness`, and `source_tables`; render them as safe UI links/chips only. Never render raw HTML from model output.
8. QR integration: QR landing registers `qrToken`, selected equipment, role category hint, label status, and evidence links. `read_qr_asset_context` and `read_qr_scan_evidence` are read-only; raw token exposure remains role-aware.
9. Offline integration: pages can register `offlineStatus` and `queueStatus`; `read_offline_sync_summary` is read-only and non-operational users are scoped to own visible events. Do not execute sync mutations from the copilot in Phase 2.
10. Phase 3 is for action drafts, confirmations, approvals, and audited mutation execution. Do not add copilot workflow-changing actions yet.

## AI Copilot Upgrade — Phase 3 (2026-05-16)

1. Action drafts are proposals, never silent mutations. Pattern: ask → context → propose → review card → confirm in dialog → existing server action executes → audit log → exact created-record link.
2. Types live in `src/types/copilot-actions.ts` (`CopilotActionDraft`, `CopilotActionResult`, `CopilotActionKind`, execution modes). Strict Zod validation at every boundary. Kinds: `maintenance_request_create`, `calibration_request_create`, `training_request_create`, `reorder_request_create`, `maintenance_event_note`, `work_order_closure_note` (draft-only), `department_issue_report`, `open_record`, `open_report`, `copy_summary`, `offline_queue_action`.
3. Draft generation lives in `src/services/chatbot/action-draft-service.ts`. Drafts are proposed only when (a) the user message regex-matches an intent AND (b) `canCreateCopilotDraft()` allows the active role/draft type. Viewer never gets mutation drafts. Department roles are auto-scoped to their own department. At most 4 drafts per response, one per kind.
4. `AssistantContent.action_drafts` is the carrier (default `[]`). The orchestrator attaches drafts after normalization. All deterministic-fallback paths include `action_drafts: []` to keep schema-safe.
5. UI: `src/components/assistant/CopilotActionCard.tsx` and `CopilotActionConfirmDialog.tsx`. Card shows risk + execution mode + warnings + evidence + Open/Copy/Review actions. Dialog shows readonly linked context + editable safe fields. Server re-validates regardless.
6. Server executor: `src/actions/copilot-actions.actions.ts#executeCopilotActionDraftAction`. Re-authenticates, re-checks role + department scope, refuses `draft_only`/`link_only`, merges only editable overrides, calls existing actions (`createMaintenanceRequestAction`, `createCalibrationRequestAction`, `createTrainingRequestAction`, `createProcurementRequestAction`, `createMaintenanceEventAction`), surfaces `duplicate_open_request` as `conflict`, audit-logs `action='copilot.draft.executed.<kind>'`.
7. Offline integration via `src/components/assistant/copilot-offline.ts`: offline-capable kinds map to existing `OfflineActionType`s and queue via `enqueueOfflineAction`. Online-only kinds (procurement approval, disposal, QR token admin, settings/security, analytics refresh, final closure/assignment, replacement decisions) never queue from copilot.
8. Usage hardening: AssistantPanel shows warning + hard-stop bands. Orchestrator skips Gemini call when `usageBeforeProvider.hardLimited` is true and returns a deterministic limited response. Local intros are not counted.
9. Developer Lab Copilot Diagnostics adds an Action Drafts Executed Today metric and per-kind breakdown derived from `audit_logs` rows.
10. Tests: `src/services/chatbot/__tests__/copilot-action-drafts.test.ts` covers role gating, department scoping, intent matching, Zod validity, and offline mapping. 129/129 chatbot tests pass.
11. No new migration. Audit metadata uses `audit_logs.details` jsonb. No new offline action types. Existing server actions remain the authority for RLS, validation, audit, and revalidation.

## AI Copilot Quality/Grounding Pass (2026-05-16)

1. Copilot answers must follow the tool/data-first path: role + page/entity context → scoped BMEDIS tools/services → deterministic answer candidate → Gemini naturalization → response normalization → usefulness guard. BMEDIS data and current page context are the source of truth.
2. Deterministic builders live in `src/services/chatbot/deterministic-answer-builders.ts`; they cover operational priority, asset context, work orders, department readiness, stock blockers, viewer summaries, developer diagnostics, safe troubleshooting, reports, offline sync, QR asset context, and RPN/MTTR/MTBF/PM compliance concepts.
3. `src/services/chatbot/response-usefulness-guard.ts` replaces generic/failure-style provider output with deterministic system-data answers when evidence exists. Gemini failure and hard-limit paths should prefer retrieved system context before showing unavailable copy.
4. Classifier/page-aware routing now handles normal chat, "how do I use this page", page summaries, QR asset questions, reports, offline conflicts, stock blockers, priority questions, safe troubleshooting, and developer diagnostic phrasing.
5. Action cards are rare: summary/explain/prioritize/evidence questions must not show mutation drafts. Drafts require explicit create/draft/request/report/log/reorder/write/submit/queue intent. Viewer never receives mutation drafts.
6. Normal users see natural paragraphs, compact evidence chips, and useful next steps. Provider/parser/classifier/tool traces stay hidden from normal roles; developer debug remains collapsed and can expose routing/tools/provider/parser details.
7. Troubleshooting remains safe first-line only: external inspection, power/accessories, visible damage, battery, ventilation, cleaning, error observation, PM/calibration/history, and escalation criteria. Never provide bypass, service mode, firmware, internal board, hidden-menu, or manufacturer-specific calibration steps.
8. Chatbot tests now include deterministic builder/usefulness-guard coverage; current count after this pass is 137/137.

## Notifications subsystem (2026-05-17)

1. In-app notifications are the single source of truth. Telegram is one external delivery channel; the developer monitor receives copies of every Telegram-eligible notification for testing across roles. No SMS, no email, no browser push.
2. Migration `00055_notifications.sql` adds `notification_events`, `notifications`, `notification_rule_logs`, `notification_deliveries`, and `telegram_connections` with hot-path indexes and RLS (own-row read/update for `notifications`; developer/admin/bme_head read diagnostics; privileged insert via server actions). Next migration must be 00056.
3. Types live in `src/types/notifications.ts`. Engine lives in `src/services/notifications/`:
   - `notification-engine.ts` — `createNotificationEvent`, `processNotificationEvent`, `createNotificationForProfile`, `emitNotificationEvent` (fire-and-forget wrapper used by server actions).
   - `notification-rules.ts` — role-aware fan-out per event type. Generates per-recipient `CreateNotificationInput` rows; never broadcasts raw payloads.
   - `recipient-resolver.ts` — `getActiveProfilesByRole`, `getDevelopers`, `getBmeHeads`, `getAdmins`, `getDepartmentHeads(deptId)`, `getDepartmentUsers(deptId)`, `getStoreUsers`, `getViewers`, `getProfileById`, `getAssetDepartmentId`, `getLeadershipRecipients`, `dedupeRecipients`.
   - `notification-dedupe.ts` — `computeDedupeKey`, `applyDedupe`. Default cooldown 10 min; same recipient + event + source within window updates the existing row instead of inserting; Telegram suppressed unless priority increased to critical.
   - `notification-links.ts` — `buildNotificationLink(eventType, ctx)` returns the exact deep link (exact request/WO/PM schedule/procurement drilldown/replacement evidence/spare parts blocker/offline-sync/asset QR tab).
   - `notification.service.ts` — `getMyNotifications`, `getMyNotificationSummary`, `markNotificationStatus`, `markAllMyNotificationsRead`, `getNotificationDiagnostics`, `listNotificationDeliveries`, `listNotificationRuleLogs`, `runNotificationRuleCheck`.
   - `telegram-provider.ts` — `sendTelegramMessage`, `getTelegramBotUpdates`, `testTelegramBot`, `formatTelegramNotification`, `formatTelegramMonitorMessage`, `isTelegramConfigured`, `isTelegramMonitorConfigured`, `getTelegramMonitorChatId`, `maskTelegramChatId`, `getAppBaseUrl`. Hits Telegram Bot API directly via `fetch` with `AbortController` timeout; never throws.
   - `notification-delivery.service.ts` — `deliverTelegramIfEligible`, `isTelegramEligible`. Records `notification_deliveries` for every attempt; developer monitor copy is sent in addition to the real recipient.
4. Server actions live in `src/actions/notifications.actions.ts`:
   - User-facing: `markNotificationStatusAction`, `markAllNotificationsReadAction`, `getMyNotificationSummaryAction`, `getMyNotificationsAction`.
   - Developer-only (`developer.diagnostics` capability): `getNotificationDiagnosticsAction`, `listDeliveriesAction`, `listRuleLogsAction`, `runNotificationRuleCheckAction`, `createTestNotificationToSelfAction`, `sendTelegramTestMessageAction`, `sendSampleRoleNotificationAction`, `fetchTelegramBotUpdatesAction`, `testTelegramBotAction`, `saveTelegramConnectionAction`, `deliverNotificationAgainAction`, `emitNotificationEventAction`.
5. Trigger integrations (all fire-and-forget, wrapped in try/catch — notification failures must never break primary workflows):
   - `createMaintenanceRequestAction` → `maintenance_request.created` (priority follows urgency).
   - `updateRequestStatusAction` → `maintenance_request.status_changed`.
   - `assignWorkOrder` / `reassignWorkOrder` → `work_order.assigned`.
   - `updateWorkOrderAction` → `work_order.status_changed` / `work_order.on_hold` / `work_order.completed`.
   - `createPMCompletionAction` → `pm.completed`. `assignPMScheduleAction` → `pm.assigned`.
   - `createCalibrationRequestAction` → `calibration.request_created`.
   - `updateProcurementStatusAction` → `procurement.delivered` (the enum has no `delayed` value; delayed is detected by the rule check).
   - `markQrLabelNeedsReplacementAction` → `qr.label_needs_replacement`.
   - `recordOfflineSyncEventAction` → `offline_sync.conflict` / `offline_sync.failed` for new conflicts.
6. UI components:
   - `src/components/notifications/NotificationBell.tsx` — Topbar bell. 45 s polling for unread summary, opens a drawer with the latest 8 unread/read notifications, supports mark-read/mark-all-read/dismiss, links into deep routes, critical unread shows a red ring.
   - `src/app/(dashboard)/notifications/page.tsx` — full Notification Center. Tabs: For Me, Critical, Tasks, Requests, Compliance, Stock & Procurement, System, Reviewed. Filters: priority, category, status, search. Mark-all-read + Send test buttons. Developer-only callout linking to Developer Lab diagnostics.
   - `src/app/(dashboard)/developer-lab/NotificationDiagnosticsSection.tsx` — in-app stats, Telegram stats (token presence/monitor presence/masked chat id), test tools (test notification, Telegram test, verify bot, run rule check, fetch bot updates, save chat id for a profile), sample role notifications, recent delivery logs, recent rule activity. Rendered under `/developer-lab` after the Copilot Diagnostics section.
7. Alerts page is removed from navigation. `Notifications` (icon `Bell`, href `/notifications`, capability `nav.alerts`) replaces the entry in `NAV_SECTIONS`. Middleware redirects `/alerts` → `/notifications`; the legacy page renders a client-side fallback redirect with a link in case middleware is bypassed. `recommendation_flags` is still useful internally as a notification trigger source, but it is not rendered as a user-facing page.
8. Telegram environment variables:
   - `TELEGRAM_NOTIFICATIONS_ENABLED` (`true`/`false`) — master switch.
   - `TELEGRAM_BOT_TOKEN` — required for any Telegram send. Never exposed client-side.
   - `TELEGRAM_DEV_MONITOR_ENABLED` (`true`/`false`) — controls developer monitor copy.
   - `TELEGRAM_DEV_MONITOR_CHAT_ID` — chat id receiving monitor copies. Masked to `••<last4>` in the UI.
   - `TELEGRAM_MIN_PRIORITY` (default `high`) — only `high`/`critical` are auto-eligible.
   - `TELEGRAM_SEND_LOW_PRIORITY` (default `false`).
   - `NEXT_PUBLIC_APP_URL` — used to build absolute links in Telegram bodies. Falls back to `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_VERCEL_URL` (with `https://`), then `http://localhost:3000`.
9. Telegram eligibility (`isTelegramEligible`): always true for `priority='critical'|'high'`, `category='critical'`, or `source_type` in `{work_order.assigned, work_order.stock_blocked, offline_sync.conflict, spare_part.stockout, qr.label_needs_replacement, qr.revoked_scanned, system.test_notification, notification.rule_failed}`. Dismissed/reviewed rows are never sent regardless of priority.
10. Tests: `src/services/notifications/__tests__/notifications.test.ts` — 14 tests covering deep-link routing, dedupe key stability, Telegram eligibility, chat-id masking, and Telegram body/monitor formatting. Run via `npx tsx --test src/services/notifications/__tests__/notifications.test.ts`. Chatbot test suite still passes 147/147.
11. Security rules: bot token is server-only, chat ids are masked everywhere in UI, no service-role usage in the notification path, no patient data is sent over Telegram, Telegram never acts as authorization (links always open the app and re-authenticate), no client-side direct writes to `notifications` (server actions only).

## Semifinal UI foundation (2026-05-18)

1. This pass adds shared design-system primitives only. **No page rewrites.** Tier 1 pages (Login, DashboardLayout, Command Center, Notifications, AI Copilot, QR landing, Equipment detail, Maintenance/WO, Offline sync, Reports) are unchanged. Adoption is a separate later pass.
2. New tokens (`src/lib/ui/`):
   - `motion-presets.ts` — framer-motion `Variants` (`pageFade`, `slideUp`, `cardStagger`, `cardItem`, `drawerSlideLeft`/`Right`, `modalScale`, `tabCrossfade`, `subtleHover`, `attentionPulse`, `noMotion`), `transitions` (`fast`/`default`/`slow`/`spring`), `useMotionVariants` (reduced-motion swap to no-op variants).
   - `chart-theme.ts` — `useNivoTheme()` reads BMEDIS CSS variables, returns a Nivo `PartialTheme` from `@nivo/theming` plus the chart palette and a semantic color map. Listens to the existing `bmedis-theme-change` window event for retint.
   - `role-theme.ts` — `ROLE_ACCENTS` keyed by `RoleName`: workspace label + subtitle + accent triple + `allowDense`. `getRoleAccent(role)` with viewer fallback. Accents stay visible only in role chips / workspace headers; brand blue stays dominant.
   - `status-styles.ts` — `toneBadgeClass`, `toneRingClass`, `toneDotClass` keyed by `SemanticTone`. `statusTone(status)` maps common status keywords. Complements existing `action-styles.ts` (button styling).
3. New components (`src/components/ui/`): `AnimatedMetric` (react-spring number), `SpringGauge` (circular gauge with `autoTone`), `MotionCard` (framer-motion glass card), `SectionHeader`, `ResponsiveTableShell`, `LoadingState` (with Lottie + spinner fallback), `RoleWorkspaceShell`, `LottiePlayer` (dynamic-import + HEAD-check fallback, exports `LOTTIE_PATHS`). `EmptyState` extended with `lottie?: LottieKey` + `compact?: boolean`; existing callers unchanged.
4. New chart shells (`src/components/charts/nivo/`): `NivoChartShell` (title/footer/action/empty-state chrome with explicit `height`), `BmedisBarChart`, `BmedisLineChart` (curve type `LineCurveFactoryId` from `@nivo/core`; data shape `BmedisLineSeries`), `BmedisPieChart` (donut, `role="img"` only — Nivo Pie does not accept `ariaLabel`). All wrapper components are theme-aware via `useNivoTheme`.
5. Lottie assets are NOT yet provided. `LottiePlayer` HEAD-checks the asset path and renders the supplied fallback when missing or under `prefers-reduced-motion`. Expected filenames are documented in `public/lottie/README.md`. No external CDN fetches.
6. Reduced motion: lift `prefers-reduced-motion` detection into `useState` initialisers (lint rule `react-hooks/set-state-in-effect`). `useMotionVariants(variants)` returns `noMotion` when reduced motion is requested.
7. Verification: `npx tsc --noEmit` ✅, `npm run lint` ✅, `npm run test:chatbot` ✅ 147/147, `npm run build` ✅ 54/54 routes.
8. Out of scope this pass — do not assume any of these are done:
   - No edits to Topbar/Sidebar/DashboardLayout/AssistantPanel/NotificationBell/QR landing/Command Center.
   - No Chart.js → Nivo migration on existing pages.
   - No GSAP integration (reserved for login + command-center hero next pass).
   - No theme-provider migration. Custom `src/components/theme/ThemeProvider.tsx` stays canonical; `src/providers/ThemeProvider.tsx` is unused dead code (do not delete in this pass).
   - No mobile audit or role-decluttering of existing pages.
9. Adoption rules:
   - Inside a page: keep `PageHeader` at the top; mount `RoleWorkspaceShell` inside the page body for role-tailored sections; use `SectionHeader` above each block.
   - For headline KPIs: `AnimatedMetric` + `SpringGauge` (compliance/readiness/risk). Don't animate every cell of a table.
   - For charts: prefer Nivo wrappers via `NivoChartShell isEmpty={!data.length}` so empty states are consistent. Keep existing Chart.js charts in place until a page is explicitly migrated.
   - For motion: wrap card grids with `motion.div variants={cardStagger}` and use `MotionCard` (which carries `cardItem` + `subtleHover`). Drawer/modal use `drawerSlideRight` / `modalScale`. Never animate critical-action buttons.

## Semifinal UI Tier 1 page adoption (2026-05-18)

1. `DashboardLayout` mobile drawer uses `AnimatePresence` + `drawerSlideLeft` for the drawer panel and a fade for the scrim. Main content is wrapped in `AnimatePresence mode="wait"` keyed by `usePathname()` with `pageFade`. Do not introduce a separate route-change effect to close the drawer — the existing `onNavigate={closeMobileMenu}` callback on Sidebar nav items already handles it (lint rule `react-hooks/set-state-in-effect`).
2. `AssistantPanel` "thinking" indicator uses `LottiePlayer` with `LOTTIE_PATHS.aiThinking` and a `Loader2` animate-spin fallback. The surface is opaque via `--assistant-surface` — never reintroduce a transparent backdrop on the assistant panel.
3. `NotificationBell` critical ring uses motion `attentionPulse`; the drawer uses `AnimatePresence` + `slideUp`. The critical pulse is a loop on the ring element only — do not pulse the entire bell.
4. Login page (`src/app/(auth)/login/page.tsx`) wraps the form root in `slideUp` motion and wraps the error message in `AnimatePresence`. The login pulse layer is `src/components/auth/LoginPulseLayer.tsx` — the ONLY place GSAP is used in the app. It lazy-imports GSAP, mounts an ECG-shaped SVG polyline behind the existing `AuthDashboardBackdrop`, honours `prefers-reduced-motion`, and is silent on GSAP load failure. Do not import GSAP anywhere else.
5. Command Center summary strip (`SummaryActionCards`) wraps the grid in `cardStagger` + per-card `cardItem` + `subtleHover` and uses `<AnimatedMetric value={...} />` for the headline numbers. Critical action strip (`CriticalActionStrip`) uses the same stagger pattern. The rest of Command Center (TriageCenterTabs, DepartmentDashboard, StoreOperationsCommandCenter, ViewerExecutiveCommandCenter, WorkloadAssignment, RiskBandDrilldown) was deliberately left untouched in this pass.
6. Notifications page (`/notifications`) empty state uses the shared `EmptyState` with `lottie="notification"` (icon fallback when asset is missing). Other notification surfaces unchanged.
7. Offline sync (`SyncReviewCenterClient`) wraps the 6-card summary in `cardStagger` + `cardItem` and uses `<AnimatedMetric />` for each count.
8. Equipment detail (`/equipment/[id]`) Reliability HealthCard renders a centered `SpringGauge` (`autoTone`) for availability when `reliability.availability_ratio` is computable. Existing MetricLine/MetricExplain still render as textual/audit-evidence form below the gauge.
9. QR landing (`src/app/qr/a/[token]/QrAssetLandingPage.tsx`) is deliberately left as a server component without framer-motion. Adding motion would force a client conversion that risks the auth/scan flow. The page already has a mobile-first layout and per-action card motion via `QrRoleActions`.
10. Reports Chart.js components were NOT migrated to Nivo this pass. The Nivo foundation is ready for opt-in (`src/components/charts/nivo/`), but live charts remain Chart.js — swapping them risks the export/PDF flows. Adopt per-chart deliberately, not in a bulk pass.
11. No theme provider migration. The custom `src/components/theme/ThemeProvider.tsx` continues to be canonical.
12. No mobile audit performed. No browser validation performed. Manual browser checks documented in CLAUDE.md under "What still needs manual browser validation".

## Tier 1 deferred + Tier 2 polish (2026-05-18)

1. `src/components/ui/StatCard.tsx` is now `'use client'` and wraps numeric `value` in `<AnimatedMetric />` automatically. Every page using `StatCard` inherits the count-up; do not manually wrap StatCard numbers in motion or AnimatedMetric again.
2. Command Center subcomponents are now `'use client'` (DepartmentDashboard, StoreOperationsCommandCenter, ViewerExecutiveCommandCenter were previously server). They consume props from the server parent; no data fetching moved client-side.
3. Standard pattern across all card-grid KPI strips: parent `<motion.div variants={cardStagger} initial="initial" animate="animate" className="grid ...">`, each child wrapped in `<motion.div variants={cardItem}>` (or the child itself as `motion.button` for clickable filter cards). Use this same pattern for any future page; do not invent a new motion shape.
4. `TriageCenterTabs.tsx` and `RiskBandDrilldown.tsx` are intentionally left without motion — TriageCenterTabs is table-driven; RiskBandDrilldown is an interactive expand/collapse that would fight a stagger.
5. Tier 2 coverage: PM, Calibration, Spare Parts, Logistics, Procurement, Replacement page KPI strips are wrapped. Tab content / detail forms are not animated.
6. Topbar/Sidebar mount motion remains deferred. They re-render on every route change (pathname-driven active state) and a stagger would replay on every nav click.
7. Work Order detail, Maintenance request detail, Reports detail are deferred — detail forms are dense and motion is noise. They already inherit the route `pageFade` from `DashboardLayout`.
8. No Chart.js to Nivo migration in this pass — PDF/export depends on Chart.js refs.

## Final deferred sweep + Tier 3 polish (2026-05-18)

1. **Topbar + Sidebar mount motion is OK**. They mount once when DashboardLayout mounts and sit OUTSIDE the route `AnimatePresence`, so framer-motion `initial="initial" animate="animate"` only plays on first dashboard load — it does NOT replay on route navigation (pathname changes re-render the nav for active-state styling but do not remount the parent motion containers). My earlier "deferred — would replay on every nav click" was wrong.
2. Sidebar uses `motion.nav` with `cardStagger`; each section `<motion.div variants={cardItem}>`. Topbar uses `motion.header` with one-time slide-down. Do not key these by pathname.
3. QR landing (`QrAssetLandingPage.tsx`) is now `'use client'`. Auth/scan resolution still happens in the server `page.tsx` parent; the client child renders the resolved data and applies `pageFade`. No server-only imports were added to the client file.
4. Detail pages (WO/MR/Reports[type]) wrap their main content in `motion.div` with `slideUp`. This layers cleanly with the route `pageFade` from DashboardLayout — page fades in, then inner content slides up. Do not duplicate this on individual cards within the detail.
5. Developer Lab QrCoverageSection now animates both card strips (top coverage + scan evidence) with `cardStagger`/`cardItem`/`AnimatedMetric`. OfflineDiagnosticsPanel animates the 5-card sync summary strip. The server-rendered top 4-card strip in `developer-lab/page.tsx` was left static — not worth a server-to-client refactor for 4 tiles.
6. Settings staff/security 4-card strips animate with `cardStagger`/`cardItem`/`AnimatedMetric`. Other settings sections (reference data, role permission matrix, preferences) intentionally left as-is — they are configuration surfaces, not KPI dashboards.
7. Audit page left as server-rendered. Uses shared `StatCard` which already animates numbers via the foundation upgrade; route `pageFade` handles entrance. No client wrapper added.
8. Reports list (`/reports`): `ReportCard` wrapped in `motion.div className="contents"` so layout grid behaviour is preserved. All 4 occurrences of the report grid wrapped in `motion.div` with `cardStagger`.
9. Mobile audit (code-level): `DataTable` → `Table` already provides `overflow-x-auto` + `min-w-full`. Grid breakpoints consistently use `sm:`/`md:`/`lg:`/`xl:`. `AssistantLauncher` is a Topbar inline button (no floating overlay). Pixel-perfect mobile verification still requires a browser.
10. Role-decluttering with `RoleWorkspaceShell` reviewed and skipped — the role-specific component files (ViewerExecutiveCommandCenter, StoreOperationsCommandCenter, DepartmentDashboard, ViewerMaintenanceOverview, ViewerEquipmentOverview, etc.) already render their own role-tagged PageHeader and identifier badges. Wrapping them would duplicate the role identifier. RoleWorkspaceShell remains available for any future generic page.
11. Chart.js → Nivo bulk migration NOT performed and should not be performed in a single pass. Chart.js refs power the PDF/snapshot export pipeline. Per-chart opt-in is the safe path; the Nivo foundation is ready (`src/components/charts/nivo/`).

## Cleanup + bug pass (2026-05-18)

1. **Light-mode contrast remediation** is centralized in `src/app/globals.css`. The pattern `:root:not([data-theme='dark']) :where(.text-{color}-{100|200|300}) { color: rgb(<color>-700); }` covers rose/amber/emerald/violet/blue/cyan/sky/orange/yellow/slate/teal/indigo/fuchsia/pink. `slate-400` is also covered (it's a common low-contrast offender). `:where()` keeps specificity 0,0,0 so component overrides still win. Do not add new `text-{color}-200` or `-300` for light-mode-only surfaces; trust this override.
2. **Detail-row value tokens**: `equipment/[id]`, `maintenance/work-orders/[id]`, and `maintenance/requests/[id]` use `text-[var(--foreground)] font-medium` for detail values, not the previous `text-gray-900 dark:text-white`. Future detail pages should follow this pattern.
3. **Favicon**: `public/icons/bmedis-icon.svg` matches the `LogoMark` design (stacked rounded squares with brand→violet gradient). Do not re-introduce `src/app/favicon.ico` — the SVG is canonical via root layout `icons: { icon: '/icons/bmedis-icon.svg' }`.
4. **`StaggeredGrid` + `StaggeredItem`** (`src/components/ui/StaggeredGrid.tsx`) is the client-side wrapper to use when a server-rendered page wants stagger reveal without going client. Use it for any future server-rendered card strip; do not convert the page to client just to add motion.
5. **Dead-code deletions**: `src/providers/ThemeProvider.tsx` and `src/components/ui/RoleWorkspaceShell.tsx` were deleted. The canonical theme provider remains `src/components/theme/ThemeProvider.tsx`. Do not re-introduce a separate next-themes wrapper unless we're committing to migrate fully.
6. **Storybook stories** sit next to each component as `*.stories.tsx`. The 12 foundation stories are real, working examples — use them as reference when adopting these components elsewhere. Storybook is run via `npm run storybook`.
7. **Print CSS** in `globals.css`'s `@media print` block now neutralizes framer-motion inline styles (`opacity` + `transform`) so a mid-animation print never clips content, and hides Lottie players. Test new print surfaces if you add motion to a page that's likely to be printed.
8. **`useDrawerA11y`** (`src/hooks/useDrawerA11y.ts`) is the standard hook for accessible drawers: Escape to close, focus-trap Tab/Shift+Tab inside the panel, restore focus to the trigger on close, auto-focus first focusable element. Use it for any new modal/drawer. The hook is generic over `T extends HTMLElement` so `aside`/`section`/`div` all work as the panel element.
9. **AssistantPanel** message list is `AnimatePresence` + per-message `slideUp`; sending indicator animates in/out; quick-prompts use `cardStagger`. Do not over-animate inside `AssistantMessageCard` itself — the panel-level animation handles arrival.
10. **Redirect aliases** are defense-in-depth: middleware 301 + server-side `redirect()` fallback page. `normalizeSection(searchParams.get('tab'))` in settings is what routes `/settings?tab=staff-access` and `?tab=security-access` to the correct section. Don't remove either layer.
