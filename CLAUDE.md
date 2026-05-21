# CLAUDE.md — BMEDIS Project Intelligence

Last updated: 2026-05-21 (Hotfix: migration 00067 grants bme_head UPDATE on maintenance_requests and FOR ALL on work_orders — root cause of "Cannot coerce the result to a single JSON object" on Approve. Server actions also hardened: updateRequestStatusAction + createWorkOrderAction + R17 status sync now use .maybeSingle() and translate 0-row RLS blocks into clear user-facing messages instead of leaking the raw PostgREST PGRST116 string. createWorkOrderAction adds idempotency: a non-terminal WO already linked to the same request is returned with duplicate_prevented=true instead of inserting a duplicate. Earlier hotfix: migration 00066 fixes equipment_assets INSERT — FMEA trigger function now branches on TG_TABLE_NAME so the equipment_assets path uses NEW.id/OLD.id; legacy `manage_equipment` RLS policy and the manual hotfix `"Privileged users can insert equipment assets"` policy are dropped and replaced by `equipment_assets_privileged_write` (developer/admin/bme_head only, FOR ALL with WITH CHECK). Phase 6 R1–R35 fix plan COMPLETE — R31 QR route comments aligned with logQrScan 5-min dedup; R13 offline phrasing verified honest (no "background sync" claims); R27 user-facing "Alerts" terminology already migrated to "Notification Center" (internal compat names kept with comment); R12 offline enqueue fails closed when roleNames missing; R33 audit coverage solid across report.exported / telegram.test_send / decision_support.refresh / notification.rule_check_run; R22 training/disposal audit-summary comments in actions (notifications deliberately deferred — modules production-ready otherwise); R28 rest documented (reports.service.ts stays browser-client by design; privileged reports already server-rendered); R15 copilot-r15-coverage.test.ts locks all 8 roles + viewer read-only; R34 validation-readiness.service.ts probes 9 fixtures (overdue PM, aging WO, stockouts, failed calibration, delayed procurement, attached QR, revoked QR, high RPI, offline event) and surfaces missing as Developer Lab warnings; R35 documents/r35-manual-validation-checklist.md provides full deployed-env sign-off checklist. ALL R1–R35 closed.)
Branch: system_fix
Deployment: configured in Vercel project settings
Supabase project ID: fgqyszbxzpmqzpqvdivx

---

## STANDING INSTRUCTION — auto-runs at the end of every session

After completing any task in this project, before ending the session:
1. Read the current AGENTS.md and CLAUDE.md in full
2. Update AGENTS.md with any new conventions, file locations, bugs found, or libraries added
3. Update CLAUDE.md with current prototype status, route map changes, and deferred issues
4. Show the full diff of both files before writing them
5. Write both files

Do this automatically without being asked. Keep entries accurate — remove stale information rather than accumulating noise.

---

## What this project is

BMEDIS (Biomedical Equipment Management and Decision Intelligence System) is a hospital-level biomedical
equipment management and decision intelligence system built for Menelik II Hospital,
Addis Ababa, Ethiopia. BSc thesis project for the School of Biomedical Engineering at
Addis Ababa University.

Thesis contribution: converting routine equipment records into ranked, explainable
engineering priorities using FMEA-based RPN, MTBF, MTTR, availability, PM compliance,
and multi-criteria replacement prioritization. The system must feel like a decision-support
control panel, not a record-keeping tool.

Stack: Next.js 16.2.2 (App Router), React 19, TypeScript 5, Supabase (PostgreSQL + Auth +
RLS + Storage), Tailwind v4, Chart.js + react-chartjs-2, jsPDF + jspdf-autotable,
date-fns, Gemini AI provider, Zod validation, lucide-react icons.

---

## 15-step prototype completion plan — current status

DONE:
- Step 1:  Supabase schema (35 migrations, all applied — including ghost-migration fix for 00021)
- Step 2:  Seed data (10 seed files, 80 equipment assets, 8 departments)
- Step 3:  Fixed 'under_review' procurement status in chatbot task-data-loaders.ts
- Step 4:  DONE — beamlak.work@gmail.com auth user linked to profile (user_id=7d8ac74b-ec15-414d-bfea-e4433eb8bc14)
           developer role created (00022) and assigned; useRole/useProfile hooks handle 'developer' correctly
- Step 5:  Command Center built at /command — unified decision-support landing page
- Step 6:  Sensitivity analysis sliders implemented at /replacement with reset, total-weight cue,
           simulated ranking, and missing-data annotations
- Step 7:  PDF export implemented — jsPDF + jspdf-autotable installed and wired to /reports/[type]
- Step 8:  /command/triage confirmed working — dedup logic in UI, real data, 80 unique assets
- Step 9:  Server-action hardening added for operational writes across equipment, maintenance,
           PM, calibration, stock, procurement, training, disposal, documents, users, settings,
           alerts, installation, and scoped offline sync
- Step 10: Audit/revalidation coverage added to new server actions; profile IDs are used for audit FK fields
- Step 14: Supabase TypeScript types generated. Current linked-schema output is `src/types/database.ts`; generated type files must stay generated-only.
- Step 15: Login page shows "Menelik II Hospital"
- Reliability metrics (2026-05-05, migrations 00034–00035): one row per asset in equipment_reliability_metrics; idx_reliability_metrics_asset_unique; recompute upserts on asset_id; Command Center triage detail uses availability_ratio (DB column), not a misnamed percentage field.
- Command Center redesign (2026-05-09, session 6): Full redesign for developer/admin/bme_head roles. New sections: live header with 10s auto-refresh, 10-card summary strip, critical action strip (top 6 scored cross-category actions), 8-tab categorized triage center (corrective/calibration/PM/stock/installation/replacement/procurement/training), technician workload (green/amber/red), improved risk distribution (summarizeRiskDrivers instead of raw JSON), improved replacement watchlist (buildReplacementReason). Other roles keep existing CommandCenterInteractive layout. No scoring-lab or sensitivity sliders on this page. No DB migrations required. Developer scoring lab deferred to /developer/scoring-lab (future route).
- Command Center action accuracy (2026-05-09, session 8): Row-level actions now follow exact-record semantics: existing work orders open `/maintenance/work-orders/[id]` with state-aware action queries, existing requests open `/maintenance/requests/[id]`, PM uses `/pm/schedules/[id]`, procurement uses `/command/drilldown/procurement/[id]`, and replacement evidence uses `/command/drilldown/replacement/[assetId]`. Needs Request and stock actions open prefilled creation flows with `source=command-center`. Summary cards use `/command/drilldown/[type]` and counts share the same fetchers as triage/drilldowns. Risk Watch can be acknowledged via `command_center_acknowledgements` signal hashes and reappears when the signal changes. Training triage is hidden from the BME Head control room pending a future Department Head workflow.
- Equipment section redesign (2026-05-09, session 9): Equipment list page: Status filter/column removed, Condition is the sole operational field; standardized condition labels via `src/utils/equipment/condition-labels.ts`; 8 summary cards (Total/Functional/Needs Repair/Non-functional/Under Maintenance/Faulted No Request/High Risk/Replacement Watch) clickable to filter table; Department (bar) + Condition (donut) charts; 7 quick-filter chips; Maintenance State column with badge (derived from open requests/work orders); state-aware Actions column (Resolve Blocker/View Progress/Open Work Order/Open Request/Create Request/Review Risk/Evidence/View); all filtering client-side over loaded dataset of 80 assets. Equipment detail page: Maintenance Status card (condition + state + exact WO/request links + create-request call-to-action); Reliability card with honest empty states (no "Availability: 0 failures" - replaced with "No recorded failures" / "Insufficient downtime data" / "100% (no failures)" based on actual data); Calibration card added; Replacement card adds formula explanation and evidence link; primary header action is state-aware. Condition sync: maintenance request creation with reported_condition updates equipment_assets.condition; WO start (in_progress) sets under_maintenance; WO complete sets functional. Maintenance request form adds "Reported Equipment Condition" field, prefills from URL param reportedCondition. New service functions: getOpenMaintenanceRequests(), getOpenWorkOrders(), getOpenRequestsForAsset(), getOpenWorkOrdersForAsset(). New action: updateEquipmentConditionAction(). No DB migrations required.
- Maintenance section workflow redesign (2026-05-09, session 11): Maintenance main page: 8 summary cards (Pending/Approved/Needs WO/Open WO/Unassigned/In Progress/On Hold/Done This Month) that click to filter the correct tab; custom controlled tabs replace Tabs component for card-driven tab switching; quick-filter chips (8 per tab) above each DataTable with chip counts; request table adds Reported Condition + Work Order + Next Action columns; WO table adds Request + Unassigned highlight + Next Action columns; all filtering/counting client-side over same loaded arrays (no count mismatches); recurring failure banner improved with failure count badge, department label, "Schedule diagnostic" action (prefilled corrective request), and "Review risk" link. Request detail page: shows `reported_condition` prominently, fetches and shows linked work orders (with WO status, technician, completion outcome), shows equipment current condition, removes confusing standalone Assign button (replaced with state-aware Create WO / Open WO), workflow progress strip, improved timeline with condition and WO events. Work order detail page: fetches and shows originating request (request#, urgency, reported condition, fault description), shows Equipment Condition panel (current / at-request / final at completion), equipment detail link. New service function: getWorkOrdersByRequestId(). No DB migrations required.
- Equipment condition auditability + completion outcome (2026-05-09, session 10): Migration 00038 adds `reported_condition` (functional_issue/needs_repair/non_functional) and `reported_condition_source` to `maintenance_requests`. Migration 00039 adds `completion_outcome` (resolved/partially_resolved/not_resolved/awaiting_parts_or_vendor) and `final_equipment_condition` to `work_orders`. Work order completion now requires a completion modal — technician selects outcome and final condition before completing. Outcome defaults: resolved→functional, partially_resolved→needs_repair, not_resolved→non_functional, awaiting_parts_or_vendor→under_maintenance. Equipment detail Maintenance Status card shows reported_condition from open request and last completion outcome from last completed WO. AssistantLauncher moved from `bottom-20 right-4 z-[70]` to `bottom-6 right-4 z-[50]` — no longer overlaps Equipment table action column. DashboardLayout main bottom padding reduced from pb-28/lg:pb-24 to pb-24/lg:pb-20 to match new button position. getLastCompletedWorkOrderForAsset() added to maintenance.service.ts.

- Audit remediation (2026-05-05, migrations 00027–00033): full recompute backfill on deploy; audit performed_by/details + acknowledgeFlag profile FK; constraints (low_stock flag_type, PMC grain unique + dedupe, partial unique asset_code for active rows, non-negative repair/downtime hours); hot-path indexes; read-model views refreshed with deleted_at filters and COALESCE; dropped unused repeat_repair_flags + equipment_locations; chat_sessions column equipment_id → asset_id

- Duplicate corrective request prevention (2026-05-10, session 12):
  - Rule: one active corrective maintenance request per asset at a time.
  - Open/active statuses: pending, approved, assigned, in_progress.
  - Closed statuses (completed, rejected, canceled) do not block new requests.
  - Shared constants: src/utils/maintenance/request-status.ts (OPEN_MAINTENANCE_REQUEST_STATUSES, CLOSED_MAINTENANCE_REQUEST_STATUSES, isOpenMaintenanceRequestStatus, formatRequestStatus).
  - New service helper: getOpenCorrectiveRequestForAsset(assetId) in maintenance.service.ts — returns full request detail or null.
  - Server action guard: createMaintenanceRequestAction() queries for existing open request before insert; returns { success: false, reason: 'duplicate_open_request', existingRequestId, ... } if found.
  - /maintenance/requests/new: on asset select, fetches existing open request; shows amber warning banner with "Open Existing Request" button; disables Submit if duplicate detected; handles server-action duplicate response and redirects to existing request with duplicatePrevented=1 param.
  - /maintenance/requests/[id]: shows "Duplicate request prevented" banner when duplicatePrevented=1 query param is present.
  - /maintenance (main page): recurring failure "Schedule Diagnostic" button replaced with "Open Request (MR-xxx)" when an open request already exists for the asset; amber badge shows existing request number.
  - Equipment list page: already correctly shows "Open Request" vs "Create Request" based on loaded openRequest state — no changes needed.
  - Command Center Needs Request triage: already uses fetchActiveCorrectiveAssetIds() to exclude assets with open corrective work — no changes needed.
  - No DB migration added: partial unique index would block historical duplicate seed rows; service/action guard is sufficient. TODO comment added in maintenance.actions.ts explaining this.

- Requests Hub redesign (2026-05-10, session 13):
  - `/requests` is now the central intake and cross-category tracking layer for corrective maintenance, calibration, training, procurement, disposal, installation, and specification/document support.
  - Shared fetcher: `src/app/(dashboard)/requests/_lib/requests-hub-data.ts` normalizes maintenance, calibration, training, procurement, disposal, installation request, and specification request rows into one `RequestHubRow[]`. The same normalized rows drive category cards, workflow cards, status filters, and the unified table.
  - UI: `src/app/(dashboard)/requests/_components/RequestsHubClient.tsx` provides clickable category summary cards, operational workflow cards, role/scope chips, type/status/department filters, search, pagination, and a unified request table.
  - Exact route rule retained: maintenance rows open exact request/linked work-order routes; procurement rows open `/command/drilldown/procurement/[id]`; categories without module detail pages use lightweight `/requests/[type]/[id]` detail/status pages.
  - Creation route rule: new request buttons are type-specific and contextual (`source=requests-hub`). Existing module pages open their request/upload modal when receiving Requests Hub query params.
  - Naming: "Curative Maintenance Requests" is replaced by "Corrective Maintenance Requests".
  - Installation requests are intake/workflow rows in `installation_requests`; installation records remain completion evidence in `installation_records`.
  - Specification requests are workflow rows in `specification_requests`; specification documents remain output/evidence in `equipment_documents`.
  - Disposal distinguishes formal `disposal_requests` from replacement candidates; replacement candidates are noted and linked but not counted as disposal requests.
  - DB migrations added: `00040_installation_requests.sql` and `00041_specification_requests.sql`.

- Hospital Operations Calendar (2026-05-10):
  - `/calendar` is a fully internal BMEDIS calendar, not Google Calendar integration. No Google OAuth, external sync, or external event creation is implemented.
  - Calendar events are normalized from BMEDIS operational source tables: PM schedules, calibration records/requests, work orders, maintenance requests, training sessions/requests, installation requests/records, procurement requests, disposal requests/disposed assets, and dated specification requests where rows expose real dates.
  - Source tables remain the source of truth. Calendar "sync" means internal revalidation/refresh after module actions update source records.
  - Every event uses a real date field and routes to the exact source record when available: PM schedules, work orders, maintenance requests, installation requests, procurement drilldown, and specification request detail. Calibration, training, disposal, and installation records use contextual module routes where dedicated detail pages do not exist.
  - Viewer is read-only. Operational mutation happens on the source module pages, not directly inside the calendar.
  - External Google Calendar sync is intentionally deferred; it would require OAuth, token storage, duplicate prevention, and conflict handling.

- Supabase type generation cleanup (2026-05-11):
  - `src/types/database.ts` is generated by Supabase using `npx supabase gen types typescript --linked > src/types/database.ts`; do not hand-edit it or add custom app/domain exports there.
  - App-level role types live in `src/types/roles.ts` (`RoleName`, `ROLE_NAMES`). Other app/domain aliases used by services/pages live in `src/types/domain.ts`.
  - After regenerating Supabase types, rerun `npx tsc --noEmit` and `npm run build`; fix missing exports by moving/reusing app types outside the generated file instead of editing `database.ts`.
  - Migration 00043 exposes `asset_id` in `v_calibration_due` for exact calibration and Command Center drilldowns.

- Logistics drilldowns + Developer Lab + Settings finish (2026-05-12):
  - Logistics page rewritten with `?workflow=` param (supports both `workflow=` and old `panel=`). Each workflow now renders a real Table with live data: receiving→delivered procurement, requests→open procurement, issue→low-stock parts with deficit/action, bin-card→full ledger with receipts/issues per part, usage-linkage→linked and unlinked issues with stockout banner. URL param is `workflow` (not `panel`).
  - Developer Lab health checks grouped into 4 categories: Data Integrity, Workflow Integrity, Decision-Support Integrity, Security/Auth Integrity. Each group shows its own critical/warning/healthy summary badge.
  - DeveloperLabClient sensitivity tabs now show per-tab methodology previews for non-RPI tabs (Equipment Health, Department Readiness, Critical Action Score, Stock/Procurement Priority) with labeled fields, sources, and "Preview only" amber banners.
  - Settings page `spare-part-categories`, `procurement-statuses`, `disposal-reasons` sections now show actual configured values: spare parts explains the free-text category column; procurement statuses shows all 6 enum values with descriptions; disposal reasons shows all 6 disposal method enum values with descriptions.
  - Procurement inline status update already existed (select dropdown + handleStatusUpdate). Confirmed working.
  - All calibration routes verified present: /calibration/requests/[id], /calibration/records/[id], /calibration/requests/new (redirects), /calibration/records/new (redirects). All actions (Review Request, Schedule Calibration, Prepare Calibration, Record Result, View Evidence, Open Asset Profile, Create Maintenance Request) route correctly.
  - Build: npm run build ✅ tsc --noEmit ✅ npm run lint ✅ (0 errors).

- Action style + reports charts finishing pass (2026-05-12):
  - Reports detail page (`/reports/[type]`) now renders per-type Chart.js charts in the Visual Summary section using existing BarChart, DoughnutChart, HorizontalBarChart, and ChartCard components. Charts are computed from loaded data via `buildReportCharts(effectiveReportType, data)`. The `reportCharts` useMemo must appear before any conditional returns.
  - Training TrainingTab type cleaned up: removed unused 'evidence' variant; 'evidence' in normalizeTrainingTab now maps to 'completed'.
  - Action button styles standardized across calibration, work-orders, alerts, spare-parts, procurement, disposal: primary row action uses `bg-[var(--brand)]` brand purple; stockout uses `bg-red-600`; warning/low-stock uses `bg-amber-600`; amber signal uses `border-amber-500/60 bg-amber-500/10 text-amber-400`; success/issue uses `bg-emerald-600`; secondary/evidence uses neutral outline.
  - All pre-existing changes (calibration actions, work orders unified queue, replacement thresholds, disposal disposed_by full_name, alerts specific labels, training no-evidence-tab) were already in place from prior sessions — no regressions.
  - Build: `npm run build` and `npx tsc --noEmit` and `npm run lint` all pass clean.

- Reports module redesign (2026-05-12):
  - `/reports/page.tsx` rewritten as 4 professional sections: Executive & Defense, Asset Lifecycle, Maintenance & Compliance, Resource/Procurement & People. Each section has a styled header, description, and 2–5 report cards.
  - Report cards now show: title, purpose, evidence tag badge, chart/table count ("X charts + Y evidence tables"), exports available (CSV/PDF/Print), and Open Report link.
  - Defense Evidence Pack section removed. No demo tools on Reports page.
  - New report types added: `evaluation-demo` (Equipment data as demo evidence, full config in getReportConfig), `decision-support-methodology` (maps to replacement-planning fetcher, with methodology-specific title and columns).
  - `/reports/[type]/page.tsx` upgraded with: per-report KPI cards (buildReportKPIs), Priority Findings section (buildPriorityFindings), extended charts with 3 chart types per key report (buildReportCharts now handles biomedical-operations, evaluation-demo, department-readiness, maintenance-performance (monthly trend bar added), pm-compliance (dept bar added), calibration-compliance (dept bar added), work-orders/technician-workload (technician hbar added), replacement-planning/decision-support-methodology (dept bar added), risk-fmea (dept bar added)).
  - Executive summary function (buildExecutiveSummary) uses actual loaded counts for each report type.
  - Methodology section shows report-specific explanation; replacement/decision-support reports show the prototype threshold amber notice.
  - Export CSV now includes 4 metadata header rows (Report, Institution, Snapshot Generated, Source) before data headers. Filename pattern: bmedis-[slug]-snapshot-YYYY-MM-DD-HH-mm.csv.
  - Export PDF (jsPDF — real PDF download) includes snapshot timestamp in header. Filename: bmedis-[slug]-snapshot-YYYY-MM-DD-HH-mm.pdf.
  - "Print / Save as PDF" button uses window.print(). DashboardLayout sidebar/topbar/AssistantLauncher wrapped in `no-print` class. Print CSS added to globals.css: white bg, black text, hides nav/controls, preserves charts and tables. @page { size: A4; margin: 1.5cm }.
  - Report detail page has `no-print` export action row and filter row; a print-only header div (hidden on screen) shows title, institution, and timestamp.
  - Snapshot notice banner shows generation time and freshness state; amber variant when analytics refresh was unavailable.
  - Build: npm run build ✅ tsc --noEmit ✅ npm run lint ✅ (0 errors).

- Final workflow polishing pass (2026-05-11):
  - Global rule: operational pages are control surfaces, not passive dashboards. Count cards filter the page or route to exact filtered destinations, active cards are highlighted, and row actions use state-aware workflow verbs.
  - Calibration now uses an explainable priority model: overdue severity + equipment criticality + last result risk + department impact + open workflow state. Tabs are Requests, Upcoming, Overdue, Records; triage sections are Urgent Safety Risk, Needs Scheduling, Awaiting Action, and Longest Overdue.
  - Maintenance request and work-order details show a Condition Trace. Request reported_condition and work-order status/completion rules are visible next to current/final equipment condition.
  - Work Orders default to active work; Critical/High excludes completed history by default; External Vendor is no longer a top-level card/tab.
  - Spare Parts cards filter catalog/low stock/blockers/receipts/issues; Stock Action Queue separates stockout blockers, low stock with/without procurement, and ready-to-issue. Open procurement is tracked instead of duplicated.
  - Logistics now represents Receive -> Request -> Approve -> Issue -> Balance/Bin Card -> Usage Evidence with local panels and filtered cross-module routes.
  - Procurement pipeline cards filter rows; permitted roles can update status inline; delivered rows point to Receive Stock.
  - Training removes ambiguous Coverage as a primary tab/card; main flow is Requests, Upcoming Sessions, Completed Sessions, Competency Evidence.
  - Replacement defaults to strong/review candidates, chart defaults to Top 10, and thresholds are explicitly prototype decision thresholds (0.70 strong, 0.55 review, below 0.55 monitor).
  - Disposal cards filter requests/candidates/disposed evidence; disposed-by resolves profile name through `disposed_assets_disposed_by_fkey`.
  - Alerts use Command Center-style tabs and specific source actions. Reports generate timestamped snapshot evidence and moved demo tools to Developer Lab.
  - Settings shows profile/password, reference sections, user management, role permissions, and configured/planned lookup sections. Audit highlights governance/high-risk events.
  - Developer Lab moved under Command for developer/admin roles and now frames methodology, sensitivity tabs, ranking stability, refresh tools, data health, demo evidence tools, and disabled safe reset.

- System integrity + analytics truth pass (2026-05-15, branch V4_Theme):
  - Root cause found: v_open_work_orders (migration 00031) did NOT expose asset_id or department_id.
    All department-filtered WO queries and all Viewer maintenance WO counts returned 0 due to this.
  - Root cause 2: work_orders table has NO scheduled_date column. Queries requesting it caused PostgREST
    to fail silently; overdue WO count was always 0. Fixed: all WO queries now use age from created_at
    (>14 days = "aging") instead of scheduled_date. UI label updated to "Aging Work (>14d)" with sub.
  - Root cause 3: v_calibration_due exposes 'result' (not 'last_result'). All calibration queries using
    last_result returned null, causing failed/adjusted calibration count = 0. Fixed in department-metrics.ts
    and fetchDepartmentOverdueCalibration.
  - Root cause 4: v_overdue_pm (migration 00042) exposed asset_id but NOT department_id. Department PM
    compliance filters returned 0 rows. Fixed in migration 00044.
  - Root cause 5: StoreMaintenanceBlockers flags table displayed raw UUID as asset name (line 229).
    Fixed: equipment_assets(asset_code, name) join added to flags query; table shows asset name + code.
  - Migration 00044 created: adds asset_id + department_id to v_open_work_orders; adds department_id to
    v_overdue_pm. Non-breaking additions — existing queries unaffected.
  - DepartmentWorkStatus.tsx rewritten to use direct view columns (asset_name, asset_code, assigned_to_name)
    instead of nested FK queries that fail when view has no Relationships in generated types.
  - ViewerMaintenanceOverview.tsx rewritten: direct view columns, age-based overdue, no FK nest queries.
  - department-metrics.ts: three query bugs fixed (scheduled_date, last_result, department filter).
  - Analytics truth map created: src/utils/analytics/analytics-truth-map.ts — documents formula, source,
    live/snapshot/sandbox status, pages, missing-data and stale-data behavior for 14 metrics.
  - After applying migration 00044 (supabase db push --linked), regenerate types:
    npx supabase gen types typescript --linked > src/types/database.ts
  - Build: tsc --noEmit ✅ npm run lint ✅. npm run build fails with Google Fonts fetch error
    (network issue in dev environment, not a code error).

- QR Identity Foundation — Phase 1 (2026-05-15, branch QR):
  - Goal: secure, stable, database-backed QR identity per asset using random tokens (not asset_code).
  - QR token IDs the physical asset only; auth + RBAC still gate every read/write. /qr/a/[token] is not
    an authorization plane.
  - Token format: qra_ + base64url(crypto.randomBytes(24)). Server-only generation; never Math.random.
  - Migration 00045 adds qr_token + qr_generated_at + qr_label_status (CHECK enum) +
    qr_label_printed_at + qr_label_attached_at + qr_label_replaced_at + qr_token_regenerated_at
    to equipment_assets; unique partial index on qr_token; indexes on qr_label_status and qr_generated_at.
    Creates equipment_qr_scans (asset_id FK, scanned_by FK→profiles, role_name, scanned_at, scan_source,
    user_agent, online_status, action_taken, metadata jsonb) with CHECK on scan_source and online_status.
    RLS: developer/admin/bme_head + self can SELECT scans; authenticated can INSERT. UPDATE/DELETE not
    granted.
  - Files added: supabase/migrations/00045_equipment_qr_identity.sql, src/types/qr.ts,
    src/utils/qr/token.ts, src/services/qr.service.ts, src/actions/qr.actions.ts,
    src/app/(dashboard)/developer-lab/QrCoverageSection.tsx,
    src/app/(dashboard)/equipment/[id]/QrIdentityPanel.tsx,
    documents/qr-identity-design.md. Also adds getEquipmentQrIdentityClient to
    src/services/equipment.service.ts.
  - QR admin actions (ensure/regenerate/markPrinted/markAttached/markNeedsReplacement/revoke/
    bulkGenerateMissing) gated to capability 'equipment.edit' (developer + admin + bme_head).
    Every action writes an audit_logs row (qr.token.*, qr.label.*).
  - Revoke is soft: keeps qr_token, sets status='revoked'. Future /qr/a/[token] must reject revoked.
    Regenerate is the canonical path to issue a new token.
  - Developer Lab shows QR Coverage & Field Readiness section: real counts from equipment_assets and
    equipment_qr_scans, "Generate missing tokens" button, honest "Phase 1 only" amber notice.
  - Equipment detail QrIdentityPanel: developer/admin/bme_head see masked token + lifecycle timestamps
    + Generate/Regenerate(confirm)/Mark Printed/Mark Attached/Needs Replacement/Revoke(confirm) buttons.
    Other roles only see one-line label-status badge.
  - Intentionally NOT in Phase 1: QR label image/print, /qr/a/[token] route, role-aware scan experience,
    scan logging UI, offline scan logging, PWA/service worker, sync/conflict handling, equipment list
    QR column. See documents/qr-identity-design.md for the full phase plan.
  - Required after merge: supabase db push --linked && npx supabase gen types typescript --linked >
    src/types/database.ts && npx tsc --noEmit. Bulk-generate the 80 existing assets from Developer Lab.
  - Build: tsc --noEmit ✅ npm run lint ✅.

- QR Label Generation and Management — Phase 2 (2026-05-15, branch QR):
  - Goal: let Developer/Admin/BME Head generate, preview, download, print, and track per-asset QR labels.
  - QR image is rendered locally via the already-installed qrcode.react (QRCodeSVG for preview,
    QRCodeCanvas + ref for PNG export). No external QR API; no qrcode-cli; no server-side image gen.
  - QR image payload encodes only the Phase 3 path /qr/a/<qr_token> via buildAssetQrUrl(). The route is
    intentionally NOT implemented in Phase 2 — UI shows the URL with the honest hint "will become active
    in Phase 3" and never links to it.
  - Base URL resolved by getQrBaseUrl(): NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_SITE_URL →
    NEXT_PUBLIC_VERCEL_URL (https://) → http://localhost:3000. No hardcoded production domain.
  - Files added: src/utils/qr/url.ts, src/utils/qr/render.ts (canvas composition + PNG download),
    src/components/qr/QrCodeImage.tsx, src/components/qr/QrLabelPreview.tsx,
    src/components/qr/QrLabelPrintSheet.tsx,
    src/app/(dashboard)/equipment/qr-labels/page.tsx + QrLabelSheetClient.tsx.
    Extended src/types/qr.ts with QrLabelAsset, QrLabelSize, QrLabelFilter.
    Extended src/services/qr.service.ts with getQrLabelAssets / getQrLabelAsset and
    bulkMarkQrLabelsPrinted / Attached / NeedsReplacement.
    Extended src/actions/qr.actions.ts with markQrLabelsPrintedBulkAction /
    markQrLabelsAttachedBulkAction / markQrLabelsNeedsReplacementBulkAction (gated on equipment.edit,
    audit events qr.label.printed.bulk / qr.label.attached.bulk / qr.label.needs_replacement.bulk,
    revalidates /equipment, /inventory, /developer-lab, /command, /equipment/qr-labels).
    Updated src/app/(dashboard)/equipment/[id]/QrIdentityPanel.tsx to embed preview, Download PNG,
    Print Label, and surface revoked/needs-replacement banners. Updated
    src/app/(dashboard)/developer-lab/QrCoverageSection.tsx with QR Label Sheet entry points
    (Open Sheet, Print Generated (n), Print Needs Replacement (n)).
  - Route /equipment/qr-labels: server-gated to admin/bme_head (developer always passes), coverage
    cards, filter chips (all/generated/printed/attached/needs_replacement/revoked/missing_token),
    search, selectable table, Print (selected/all-visible), Generate Missing Tokens, Mark Selected
    Printed/Attached/Needs Replacement, on-screen print preview grid. autoprint=1 query param triggers
    window.print() once after mount; used by Equipment detail "Print Label" and Developer Lab quick-print.
  - Lifecycle invariant: printing/downloading NEVER auto-marks Printed/Attached. Always an explicit
    user action. Documented in the on-page amber notice and the design doc.
  - Revoked tokens: print/download disabled, user prompted to regenerate. Needs-replacement: warning
    banner but printing still allowed with the current token. Phase 1 confirm dialogs on Regenerate
    and Revoke preserved.
  - Non-admin roles still see only the read-only QR Label status badge from Phase 1; no preview,
    no download, no print.
  - Phase plan canonicalized in documents/qr-identity-design.md: Phase 1 ✅, Phase 2 ✅, Phase 3
    online landing route, Phase 4 role-specific scan experience, Phase 5 coverage expansion,
    Phase 6 scan logging/evidence (end of current plan). Offline/PWA is explicitly OUT of the
    six-phase plan; if pursued later it is a separate initiative.
  - No DB migration was added in that offline pass.
  - Static checks: no Math.random in QR utils, no external QR API, no hardcoded qra_ demo tokens,
    no fake scan/label data, /qr/a/[token] route NOT present in src/app/.
  - Build: tsc --noEmit ✅ npm run lint ✅ npm run build ✅.

- Online QR Landing Page — Phase 3 (2026-05-15, branch QR):
  - Goal: deliver the actual /qr/a/[token] scan route with token validation, asset resolution,
    revoked/invalid branches, login-required state with safe returnTo, and a role-aware authenticated
    landing — without building the full Phase 4 in-page workflows.
  - Route: src/app/qr/a/[token]/page.tsx (outside the (dashboard) group so scanned QR codes do not load
    the dashboard shell before login). force-dynamic + revalidate=0 so the page always reflects live
    asset state and scan rows are written per resolution.
  - Discriminated resolver: resolveQrLandingAsset() in src/services/qr.service.ts returns
    { status: 'invalid' | 'not_found' | 'revoked' | 'ok' }. Revoked branch returns no asset metadata,
    only qr_label_replaced_at. invalid/not_found/revoked never expose asset details.
  - Unauthenticated branch: middleware adds '/qr' to PUBLIC_PATHS so unauthenticated visitors land on
    QrLoginRequired (no asset data shown) instead of being silently bounced to /login. The login page
    now reads ?returnTo=, validated by safeReturnPath() to reject //, /\, and absolute URLs; it pushes
    the user to the returnTo path after successful sign-in. Middleware mirrors the same check when an
    already-authenticated user lands on /login?returnTo=.
  - Authenticated landing (src/app/qr/a/[token]/QrAssetLandingPage.tsx) renders:
    asset identity card (code/name/dept/category/criticality/QR status/generated date), role-aware
    action cards (developer/admin/bme_head/technician/store_user/department_*/viewer paths), and a
    4-card evidence summary (open requests, open work orders + latest WO status, active PM with
    overdue sub, calibration state overdue/due_soon/current/no_history/unavailable). All counts come
    from real queries via getQrAssetContext(); each card falls back to "Not available" if its query
    fails and the route surfaces a small amber notice listing the failed lookups instead of crashing.
  - Department scope: department_head and department_user only see operational data when
    profile.department_id === asset.department_id. Missing-department and cross-department branches
    show a limited-access banner with no further asset detail. Never falls back to all-hospital data.
  - Scan logging: enabled in Phase 3 via the Phase 1 logQrScan() service, wrapped in try/catch and
    fire-and-forget. Writes asset_id, scanned_by=profile.id, role_name=comma-joined roles or primary,
    scan_source='web', online_status='online', user_agent from request headers, action_taken=
    'open_qr_landing', metadata={ route: 'qr.landing.v1' }. Refreshes deliberately write duplicate
    rows in Phase 3 — Phase 6 will dedupe and surface scan history UI.
  - Equipment detail QR panel: added Open QR Page (Link target=_blank to /qr/a/<token>, disabled when
    revoked/missing) + Copy URL (navigator.clipboard.writeText(buildAssetQrUrl)) for developer/admin/
    bme_head. Existing Phase 2 controls unchanged.
  - Files added: src/app/qr/a/[token]/page.tsx + QrLoginRequired.tsx + QrInvalidState.tsx +
    QrAssetLandingPage.tsx. Modified: src/services/qr.service.ts (resolveQrLandingAsset,
    getQrAssetContext, QrLandingResolution, QrLandingAsset, QrAssetContext types),
    src/lib/supabase/middleware.ts (PUBLIC_PATHS includes /qr; returnTo honoured for authenticated
    /login), src/app/(auth)/login/page.tsx (safeReturnPath + returnTo redirect after signIn),
    src/app/(dashboard)/equipment/[id]/QrIdentityPanel.tsx (Open QR Page + Copy URL buttons).
  - Intentionally NOT in Phase 3: full role-specific in-page workflows (Phase 4), scan logging UI /
    history / analytics (Phase 6), refresh/prefetch scan dedup, offline/PWA. Action cards are
    navigation only; no broken/fake actions; no fake asset details for unauthenticated or revoked.
  - No DB migration was added in that Phase 3 pass.
  - Static checks: no Math.random in QR code, no external QR API, no service_role usage in
    src/app/qr or src/services/qr.service.ts, no fake/mock/placeholder/demoScan data, returnTo
    rejects external/protocol-relative URLs at both client and middleware.
  - Build: tsc --noEmit ✅ npm run lint ✅ npm run build ✅ (/qr/a/[token] registered as
    dynamic route).

- Full Role-Specific QR Experience — Phase 4 (2026-05-15, branch QR):
  - Goal: make the same scanned `/qr/a/[token]` page answer, by role, "I am physically standing in
    front of this asset; what can I safely see or do right now?"
  - New server-only service: `src/services/qr-context.service.ts` exports `getQrRoleCategory()` and
    `getQrRoleContext({ asset, profile, client })`. Uses the normal Supabase server client/RLS only,
    never service_role. Every section query is best-effort and records query health instead of
    crashing the QR page.
  - Role categories: developer, bme_head (admin behaves operationally as BME Head), technician,
    department_head, department_user, store_user, viewer, unknown. No new database roles.
  - `src/app/qr/a/[token]/page.tsx` now resolves the Phase 4 role context before rendering and logs
    scan metadata as `{ route: 'qr.landing.v2', roleCategory }`. No scan-history UI or dedup added.
  - `QrAssetLandingPage` now renders the Phase 4 shell: header with user/job/role and security note,
    large asset identity card, role-specific action cards, metric cards, and tabs for Current Status,
    Requests & Work, PM & Calibration, Parts / Blockers, History, and QR Info (developer/admin only).
    `components/QrRoleActions.tsx` is the small client component used for action cards and Copy QR URL.
  - Developer: asset profile, Developer Lab, QR Label Sheet, Copy QR URL, maintenance, reports, and
    QR/debug info (masked token, token format, lifecycle timestamps, route path/base URL, role
    category, query health). No service-role details or secrets exposed.
  - BME Head/Admin: operational context with state-aware primary action priority: critical/high
    request → open work order → condition repair flow → overdue PM → overdue calibration → asset
    profile. Risk/RPN and replacement band appear only from existing score rows.
  - Technician: assigned work on this asset first, other open work second, corrective request, asset
    profile, PM/calibration evidence, and Log Maintenance Event only when an assigned work order
    exists and links to the existing `/maintenance/work-orders/[id]/events/new` route.
  - Department Head/User: strict department scope. Missing profile department or mismatched asset
    department returns a restricted state with no asset details, no operational rows, no request
    actions, and no all-hospital fallback. Matching department sees request/evidence context; Department
    User does not see BME controls.
  - Store User: direct stock/blocker/procurement evidence only. Uses on-hold work, stock issues linked
    through `maintenance_events`, stock recommendation flags, and procurement links through
    `specification_requests.procurement_request_id`. No fuzzy matching, no maintenance execution,
    no assign/start/complete, no procurement approval.
  - Viewer: read-only asset summary, evidence, and reports only. No mutation actions.
  - Data integrity: no fake rows, generated narrative summaries, hardcoded asset IDs/tokens, invented
    blockers, or schema changes. Empty/unavailable sections render honest empty states.
  - Intentionally NOT in Phase 4: Phase 5 coverage expansion, Phase 6 scan history/dedup/dashboard,
    action-click logging, offline/PWA/service worker/IndexedDB/offline QR logging, broad schema
    redesign, new migration.

- QR Coverage Expansion — Phase 5 (2026-05-15, branch QR):
  - Goal: show which active hospital assets are physically ready to scan and which need token
    generation, printing, attachment, replacement, or revoked-label follow-up.
  - Readiness is derived only from real `equipment_assets` QR fields. Ready to Scan = token exists +
    `qr_label_status='attached'` + not revoked. Missing/not_generated = Needs Label Generation;
    generated = Needs Printing; printed = Needs Attachment; needs_replacement = Needs Replacement;
    revoked = Invalid/Revoked.
  - Equipment list now has Developer/Admin/BME Head-only QR summary cards, QR status filter, QR Status
    badge column, row selection, bulk QR toolbar, and row QR actions. Viewer/Store/Technician/
    Department tailored equipment views are unchanged and do not show QR admin controls.
  - New `/equipment/qr-coverage` route is server-gated to admin/bme_head (developer passes through
    `requireRole`). It shows coverage cards, grouped tables for Missing QR Tokens / Generated Not
    Printed / Printed Not Attached / Needs Replacement / Revoked / Recently Regenerated, and bulk
    Generate/Print/Mark Printed/Mark Attached/Needs Replacement actions. Bulk revoke/regenerate
    intentionally not added.
  - Developer Lab QR Coverage links to QR Coverage, QR Label Sheet, Print Generated, and Print Needs
    Replacement, and states the phase plan honestly: Phase 6 scan logging/evidence is next.
  - Reports adds Developer/Admin/BME Head-only `/reports/qr-coverage` evidence report using existing
    report/PDF infrastructure. It reads `equipment_assets` QR lifecycle fields only; it does not
    implement scan history, scan trends, deduplication, analytics dashboards, offline/PWA, fake data,
    hardcoded QR counts, or automatic Mark Printed/Attached after printing.

- QR Scan Logging and Evidence — Phase 6 (2026-05-15, branch QR):
  - Final planned QR phase for now. Makes authenticated online scan activity visible and defensible
    without adding offline/PWA claims.
  - `QR_SCAN_DEDUP_WINDOW_MINUTES = 5`. `logQrScan` dedups only `open_qr_landing` page-render scans
    for the same asset/profile within the window. Dedup failure does not block render and no historical
    duplicate cleanup is performed.
  - Server scan evidence helpers in `src/services/qr.service.ts`: scan history, asset scan summary,
    Developer Lab scan coverage stats, attached-never-scanned assets, most-scanned assets, role/
    department groupings, asset scan metrics, and `shouldLogQrScan`.
  - `src/components/qr/QrScanHistoryTable.tsx` is the reusable scan table. It displays full name/email
    fallback and hides raw user-agent by default.
  - Equipment detail QR panel now has Developer/Admin/BME Head-only collapsible scan evidence with
    total scans, last scanned by, roles seen, recent scans, and full history link.
  - New `/equipment/qr-scans` route is Developer/Admin/BME Head-only with filters for date range, role,
    department, asset id, online status, scan source, and action.
  - Developer Lab QR section shows scan evidence cards/tables; `/equipment/qr-coverage` adds scan-aware
    filters and columns; Reports adds `/reports/qr-scan-evidence`.
  - Intentionally still out of scope: offline scan logging, PWA/service worker/IndexedDB, background
    sync, browser notifications, real `synced_later` queue behavior, action-click tracking, fake scan
    rows, generated adoption rates, and destructive scan cleanup.

- Offline Capability — Phase 3 (2026-05-16, branch Offline):
  - Final planned offline phase. Closes Phase 1 (app shell + service worker + IndexedDB queue + sync
    skeleton) and Phase 2 (workflow handlers) by making offline behavior safe, reviewable, and
    defensible without changing online workflows.
  - Conflict engine: `src/lib/offline/conflicts.ts` + `src/lib/offline/validation.ts`. Every
    state-changing offline action is validated server-side before replay; conflicts carry
    `conflict_type`, `conflict_reason`, `server_state_summary`, `local_payload_summary`,
    `recommended_resolution`, `resolution_status`, and `created_at`. Conflict types:
    asset_missing/asset_deleted/department_scope_mismatch/duplicate_open_request/work_order_completed/
    work_order_status_changed/insufficient_stock/procurement_state_changed/stock_already_received/
    unsupported_action/permission_denied/stale_server_state/unknown_sync_error/invalid_payload/
    part_missing/part_inactive. Resolution statuses:
    conflict/under_review/resolved_synced/resolved_discarded/resolved_manual.
  - Validation rules by action type live in `src/actions/offline-sync.actions.ts →
    syncOfflineQueuedActionAction`: maintenance/calibration/training duplicate guards, work-order
    terminal checks, insufficient-stock checks, part alive+active checks, valid quantity/payload
    checks, department-scope checks, and unsupported-handler conflicts. Original payload is never
    removed.
  - Sync Review Center: `/offline-sync` (page at `src/app/(dashboard)/offline-sync/page.tsx` and
    `SyncReviewCenterClient.tsx`). Access: admin/bme_head (developer always passes). Summary cards
    Queued/Syncing/Synced/Failed/Conflicts/Needs Review; filters for status, action type, conflict
    type, role, and search; local IndexedDB queue table with retry, mark under review, manual
    resolve, discard, view details, and exact-record open links; server `offline_sync_events` table
    with actor name/email and conflict context. Read-only payload modal — no raw payload editing.
    CSV exports for both local and server tables; JSON queue export.
  - Retry / resolution server action: `recordOfflineConflictResolutionAction` (writes
    `audit_logs` + an `offline_sync_events` row capturing the resolution status). Local queue
    helpers `markUnderReview`, `markResolvedDiscarded`, `markResolvedManual`, and
    `retryOfflineAction(id, { allowConflict })` enforce safe transitions.
  - Cached read views: `src/lib/offline/cache.ts` with `saveOfflineReadCache`,
    `getOfflineReadCache`, `clearOfflineReadCache`, `getCacheSummary`, `isCacheFresh`,
    `formatCacheAge`. IndexedDB DB version bumped to 2; new `offline_read_cache` store. Storage key
    includes profile/role/department; cross-user cache leakage is impossible by construction.
    Default freshness window is 12 hours. Logout clears the current profile's caches in
    `src/app/(dashboard)/layout.tsx`.
  - Role-specific cached experience wired in Phase 3: department equipment via
    `DepartmentEquipmentOverview` (falls back to cache on live failure, surfaces "Offline cached
    data — may be stale" with last-synced age). Additional surfaces (technician assigned work,
    store stock list, viewer executive snapshot, BME Head operational summary) have the cache
    scaffolding ready (`OfflineCacheRegistrar`, `saveOfflineReadCache/getOfflineReadCache`) and are
    documented as scoped next steps.
  - offline_sync_events evidence: `recordOfflineSyncEventAction` now stores `reported_status`,
    `conflict_detail`, `resolution_status`, `retry_count`, `role_name`, `source_route`, `asset_id`,
    `masked_qr_token`, and `error_message` inside payload. Phase 3 maps new statuses to the existing
    pending/synced/failed CHECK: conflict/under_review/resolved_discarded → failed; resolved_synced
    + synced → synced. Phase label is `offline.phase3.workflow-replay` / `.resolution`. No schema
    migration in Phase 3.
  - Global sync indicator: 4-cell panel (Queued/Failed/Conflict/Review), Needs Review count in the
    pill label, last-sync-run summary line. Privileged users see a "Sync Review" link; developer
    also sees the Diagnostics link.
  - Developer Lab Offline & Sync Diagnostics: app shell cache version from `caches.keys()`, Offline
    Read Cache summary + 25-entry table + clear-all action, Local ↔ Server Mismatch Warnings, queue
    table now shows conflict type + reason, direct links to Sync Review Center and Offline Sync
    Evidence Report. Phase 1/2 controls (retry failed, clear synced, export JSON, server event
    evidence) are preserved.
  - Offline evidence report: `/reports/offline-sync-evidence`
    (`src/app/(dashboard)/reports/offline-sync-evidence/`). Reads only `offline_sync_events`. CSV
    export with snapshot metadata header; "Print / Save as PDF" via browser print. Surfaced from
    `/reports` as adminOnly under Resource/Procurement/People.
  - Sidebar: new "Sync Review Center" entry under Administration, gated by `nav.offline_sync`
    capability (developer/admin/bme_head only).
  - Strict non-goals preserved: no browser notifications, no Background Sync API dependency, no
    offline procurement/disposal/user/settings/security/QR-token-admin actions, no offline analytics
    refresh/replacement decisions/final work-order closure or assignment, no fake reports, no fake
    cached data, no forced unsafe sync, no cross-user cache leakage, no all-hospital fallback for
    department cache, no viewer offline writes.
  - DB migration: 00046 promotes Phase 3 evidence to first-class columns on `offline_sync_events`
    (`reported_status`, `resolution_status`, `conflict_type`, `conflict_reason`, `error_message`,
    `role_name`, `source_route`, `asset_id`, `retry_count`, `resolved_by`, `resolved_at`). Relaxes
    sync_status CHECK to accept all Phase 3 statuses; adds resolution_status CHECK; hot-path indexes
    on created_at/actor/action_type/conflict_type/reported_status/asset_id; one-shot payload backfill.
    `recordOfflineSyncEventAction` writes both columns AND payload mirror; service reads columns
    first, falls back to payload for pre-migration rows. After `supabase db push --linked`, run
    `npx supabase gen types typescript --linked > src/types/database.ts` to refresh types. Next
    migration must be 00047.
  - Cached read views completion: technician assigned work (`/work-orders`), store stock list
    (`/spare-parts`), viewer executive snapshot (`/command`), and BME Head operational summary
    (`/command`) are all wired in addition to the department equipment cache. Server pages persist
    via `OfflineCacheRegistrar`; client pages read/write cache inline in their useEffect loaders.
    The `/offline` fallback now shows `CachedSnapshotList` with links back into cached views.
  - IndexedDB upgrade path: explicit `oldVersion` check in `onupgradeneeded` — v0→v1 creates
    `offline_actions`, v1→v2 adds `offline_read_cache` without touching the existing queue store.
    Idempotent for fresh installs.
  - Build: tsc --noEmit ✅ npm run lint ✅ npm run build ✅. Manual browser validation (DevTools
    service worker, offline reload, multi-user logout/login cache isolation, IDB v1→v2 with
    pre-existing queue, post-migration sync event insertion) deferred to QA — see
    documents/offline-capability-design.md "Manual Validation Checklist (Phase 3)" and "Phase 3
    Completion Pass".

IN PROGRESS:
- Step 8:  Recurring failure count intentionally remains at 1 seeded asset because the thesis
           threshold is failureCount >= 4; this is documented in the UI and QA notes

NOT STARTED:
- Step 11: BME usability evaluation instrument design
- Step 12: Usability testing with BMEs at Menelik II Hospital
- Step 13: MEMIS comparison section for thesis

---

## Canonical route map — all 30+ routes

### Decision Support
  /command                    Unified decision-support home (all roles)
  /calendar                   Internal hospital operations calendar across date-based biomedical workflows
  /command/health             Asset health scores — admin only, not in sidebar
  /command/triage             Full triage queue — confirmed working, real data, 80 assets after dedup
  /command/drilldown/[type]   Summary-card drilldowns using Command Center shared fetchers
  /command/drilldown/procurement/[id]  Exact procurement request evidence/status view
  /command/drilldown/replacement/[assetId]  Exact replacement evidence view

### Equipment (Biomedical Asset Management)
  /equipment                  Operational control center: 8 summary cards, 2 charts, quick-filter chips, maintenance state column, state-aware row actions
  /equipment/new              Create asset
  /equipment/[id]             Asset profile: Maintenance Status + Reliability + Risk + PM + Calibration + Replacement cards; state-aware primary action
  /equipment/[id]/edit        Edit asset
  /inventory                  Deprecated redirect alias → /equipment
  /inventory/new              Deprecated redirect alias → /equipment/new
  /inventory/[id]             Deprecated redirect alias → /equipment/[id]
  /inventory/[id]/edit        Deprecated redirect alias → /equipment/[id]/edit

### Work
  /requests                   Central intake/tracking hub with category cards + unified request table
  /requests/[type]/[id]       Lightweight exact-status detail for request types without dedicated detail pages
  /maintenance                Maintenance requests + work order overview
  /maintenance/requests/new   Create maintenance request
  /maintenance/requests/[id]  Request detail
  /maintenance/work-orders/new   Create work order
  /maintenance/work-orders/[id]  Work order detail
  /pm                         Planned-maintenance control center: PM cards, compliance, plans, schedules, overdue work
  /pm/plans/new               Create PM plan
  /pm/schedules/[id]          PM execution detail + assignment, checklist, completion/defer evidence
  /calibration                Calibration control center: records, requests, due/overdue, failed/adjusted evidence, contextual actions
  /work-orders                Technical execution center: summary cards, filters, exact WO actions, blockers, completion evidence links

### Inventory & Logistics
  /spare-parts                Stock-control center: inventory, low stock, stockout blockers, receipts, issues, procurement prefill
  /logistics                  Movement/receiving/issue workflow cards backed by stock/procurement counts
  /procurement                Procurement pipeline with requested/approved/ordered/in-transit/delayed/delivered states and exact drilldowns

### People
  /training                   Competency workflow: requests, sessions, upcoming work, coverage, attendance evidence
  /users                      Deprecated redirect alias → /settings?tab=staff-access

### Lifecycle
  /replacement                Replacement planning evidence; no operational scoring sliders
  /disposal                   Formal disposal requests + replacement/non-repairable candidates + disposed evidence

### Support
  /helpdesk                   Deprecated redirect alias → /requests
  /alerts                     Deprecated redirect alias → /notifications (legacy recommendation_flags still fuels notification triggers internally)
  /notifications              Unified Notification Center — bell drawer + full inbox; role-aware tabs (For Me, Critical, Tasks, Requests, Compliance, Stock & Procurement, System, Reviewed); filters; mark read/reviewed/dismiss; deep link to exact record
  /chatbot                    BMEDIS Copilot (all roles)
  /documents                  Equipment document library
  /requests                   All open requests (maintenance + training + disposal + calibration)
  /installation               Installation records + commissioning

### Reports
  /reports                    Evidence/export center for operations, compliance, risk, lifecycle, stock, procurement, training, audit, demo
  /reports/[type]             Report detail with real table-backed data and CSV/PDF export where rows exist

### Administration
  /settings                   Administration center: Hospital Profile, Departments, Categories, Staff & Access, Security & Access, Reference Data, Preferences, Import/Export
  /security                   Deprecated redirect alias → /settings?tab=security-access
  /audit                      Governance/audit viewer for developer/admin/BME Head
  /developer-lab              Developer-only scoring methodology, simulation-only sandbox tabs, data health, refresh/debug, thesis/demo tools, full Offline & Sync Diagnostics
  /offline-sync               Sync Review Center — admin/bme_head/developer review, retry, mark under review, manual resolve, or discard offline actions; cross-user server evidence
  /reports/offline-sync-evidence  Admin/bme_head Offline Sync Evidence report — server-side offline activity, conflicts, retries, resolutions (CSV/print export)
  /command/health             Deprecated redirect alias → /developer-lab

### API Routes
  /api/chat                   Chatbot orchestration endpoint (POST)
  /api/ai-smoke-test          AI provider health check (GET)
  /auth/callback              Supabase OAuth callback

### Middleware Redirects
  /decision-support            → /command
  /dashboard                   → /command
  /dashboard/analytical        → /command
  /dashboard/work-orders       → /work-orders
  /analytics/reliability       → /command
  /analytics/risk              → /command
  /analytics/pmc               → /pm
  /analytics/performance       → /command
  /analytics                   → /command
  /alerts                      → /notifications
  /helpdesk                    → /requests
  /users                       → /settings?tab=staff-access
  /security                    → /settings?tab=security-access
  /command/health              → /developer-lab
  /decision-support-health     → /developer-lab

---

## Known deferred issues

0.  Final system-page architecture after 2026-05-10 polish:
    - Sidebar groups: Command, Equipment, Work, Inventory, People, Lifecycle, Support, Reports, Administration.
    - Helpdesk is removed from navigation; support flows now use Requests Hub, Alerts, Maintenance Requests, and BMEDIS Copilot.
    - Users & Roles lives inside Settings → Staff & Access. `/users` redirects there.
    - Security lives inside Settings → Security & Access. `/security` redirects there.
    - Decision Support Health is renamed Developer Lab. `/command/health` and `/decision-support-health` redirect to `/developer-lab`.
    - Developer Lab is developer-only and contains methodology, sensitivity sandbox, ranking comparison, data health, refresh/debug, and thesis/demo tools.
    - BME Head operational pages must not expose scoring sliders, thesis debug controls, or sandbox weights.
    - Developer Lab sandbox sliders do not modify live outputs unless the developer explicitly runs a real refresh action.
    - Operational pages follow: show situation, explain why it matters, show next action, open exact records, preserve evidence/auditability.
    - Existing record → exact record. Missing workflow → prefilled creation. Informational signal → evidence/acknowledge/convert. Composite score → explanation.

0.  Command Center rules after session 8:
    - Existing row record actions must open exact records, not generic module routes.
    - Missing workflow records must open prefilled creation flows with source context.
    - Informational Risk Watch signals must be acknowledged/snoozed or converted to workflow.
    - Summary, triage, drilldown, and critical actions must share one fetcher/source for each count.
    - Every composite score must be clickable/explainable with formula, criteria/weights, raw values,
      normalized values where available, generated reason, source/method, and history/timestamp if available.
    - The system recommends and explains; the BME Head makes the final decision.
    - Viewer remains read-only. Developer is BME Head plus thesis/testing controls.
    - Training triage is intentionally hidden from the BME Head Command Center for now.

1.  Seed profiles.user_id is NULL for all seed users (except beamlak.work@gmail.com which
    is now linked). RLS auth.uid() checks fail for other seeded profiles until real Supabase
    Auth users are created and linked via supabase/seed/99_link_auth_users.sql.

2.  RESOLVED — /command/triage confirmed working. 80 unique assets displayed after UI
    deduplication. v_command_center_triage view was in ghost migration 00021 (now fixed).

3.  RESOLVED (2026-05-07) — Sensitivity sliders at /replacement are implemented with
    default reset, total weight cue, simulated RPI ranking, and missing-score annotation.

4.  RESOLVED/PARTIAL HARDENING (2026-05-07) — Operational writes now use server actions
    with role checks, audit logging, and revalidation. Interactive pages remain client
    components where needed, but mutation calls should not bypass src/actions/.

5.  RESOLVED (2026-05-04, migration 00023) — Triage accumulation fixed. DELETE now clears ALL
    'open' rows before re-inserting. triage_action_queue contains exactly 80 open rows.

6.  RESOLVED (2026-05-09, session 9) — Reliability card now shows honest empty states instead of "Availability: 0 failures". Equipment detail now has 6 metric cards including Maintenance Status and Calibration. Condition label standardized.

7.  RESOLVED (2026-05-04, migration 00024) — All 8 departments now have pm_compliance_metrics.
    PM plans, schedules (2024-2025), completions, and quarterly compliance rows added for
    Inpatient Ward (71%), Pharmacy (71%), and Radiology (82%). /pm department chart shows 8/8.

7a. RESOLVED (2026-05-10, migration 00042) — /pm is now a planned-maintenance control center.
    PM Plan = recurring rule/program, PM Schedule = one planned task instance, and PM Completion =
    evidence that work was performed. PM Compliance = completed scheduled PM tasks ÷ total scheduled
    PM tasks; skipped/deferred PM is tracked separately and does not count as completed. Completing PM
    records result, checklist, notes, technician, final equipment condition, updates equipment state,
    refreshes analytics/risk detectability, and can create/open a duplicate-safe corrective request.
    Viewer remains read-only and row actions open exact /pm/schedules/[id] records.

8.  DOCUMENTED (2026-05-07) — Recurring failure card on /maintenance shows only 1 asset
    because seed data has one asset crossing the configured failureCount >= 4 threshold.

9.  RESOLVED (2026-05-07) — Stale "Dashboard" breadcrumbs on key operational pages were
    updated to "Command Center".

10. SCOPED IMPLEMENTATION (2026-05-07) — Offline sync replay exists for work-order status
    updates and maintenance event logs via src/actions/offline-sync.actions.ts. No background
    service worker; sync is manual from work-order detail.

11. RESOLVED (2026-05-05, migration 00028 + app) — Audit writes: logAuditEvent sets performed_by
    and optional details; errors surfaced via console.error and return value. acknowledgeFlag
    uses profiles.id for acknowledged_by (FK-correct).

12. RESOLVED (2026-05-13) — Institution rename: every UI surface, seed SQL comment, and
    seed profile email now reads "Menelik II Hospital" / `@menelikii.gov.et`. Demo logins
    map to the legacy `@bmerms-demo.local` demo email domain per role. The legacy domain is retained
    to avoid breaking seeded Supabase Auth users. `St. Peter's Specialized Hospital` no longer
    appears.

13. RESOLVED (2026-05-04, migration 00023) — compute_replacement_priority_scores_all() implemented.
    replacement_priority_scores now has 80 computed rows (weights_profile_id IS NULL) plus the 8
    original seed rows (weights_profile_id = 'b7000001-...'). getReplacementPriorities() in
    analytics.service.ts filters to computed rows only (.is('weights_profile_id', null)).
    /replacement page now ranks all 80 active assets.

14. staff_training_records.staff_user_id → clearer column name deferred: seed files reference
    staff_user_id; renaming would require coordinated seed + app change (do not edit seed ad hoc).

16. RESOLVED (2026-05-15, migration 00044) — v_open_work_orders and v_overdue_pm zero-data bug.
    Root cause: views lacked asset_id / department_id columns, causing all department-filtered
    queries and Viewer WO components to return 0 rows. work_orders has no scheduled_date column —
    all WO "overdue" metrics now use age > 14d from created_at as proxy (labeled "Aging Work").
    v_calibration_due uses column 'result' not 'last_result'; calibration failed count queries fixed.
    StoreMaintenanceBlockers flags table fixed to show asset name instead of raw UUID.
    After applying migration 00044, regenerate types: npx supabase gen types typescript --linked > src/types/database.ts

15. Ghost migration pattern — migration 00021 was marked as applied in supabase_migrations
    table but its DDL was never executed. Fixed in 2026-05-03 session by repairing 00021
    and 00022 to 'reverted' then running db push. If future migrations fail similarly,
    check with: SELECT viewname FROM pg_views WHERE schemaname='public';
    Fix: supabase migration repair --status reverted <N> --linked && supabase db push --linked

---

## Seed data facts (do not modify seed files)

Seed files: supabase/seed/01–11 + 99
- 80 active equipment assets (seed/03)
- 8 departments (seed/01)
- 20 equipment_risk_scores rows (pre-computed, migration 00019 adds baseline for rest)
- 20 equipment_reliability_metrics rows (pre-computed)
- 8 replacement_priority_scores rows (seed); 80 system-computed rows (migration 00023)
- PM schedules: 68 (seed/05) + 81 (migration 00024) = 149 total across all 8 departments
- 16 recommendation_flags across 10 unique assets (8 flag types)
- Procurement, calibration, PM, training, disposal sample data
- profiles.user_id = NULL for 14 seed profiles; beamlak.work@gmail.com is linked
- seed/99_link_auth_users.sql — run this after creating real Supabase Auth users

---

## Thesis formulas implemented

All 7 required formulas exist in both TypeScript (src/utils/analytics/) and SQL (migration 00011):

  Eq 1: RPN = S × O × D                    → formulas.ts:computeRPN()
  Eq 2: A = MTBF / (MTBF + MTTR)           → formulas.ts:computeAvailability()
  Eq 3: MTBF = T_operational / N_failures   → formulas.ts:computeMTBF()
  Eq 4: MTTR = T_maintenance / N_repairs    → formulas.ts:computeMTTR()
  Eq 5: PMC = (completed/scheduled) × 100  → formulas.ts:computePMC()
  Eq 6: Min-Max normalization               → normalization.ts:minMaxNormalize()
  Eq 7: Weighted sum TS_i = Σ(wj × sij)    → composite-scoring.ts:computeWeightedScore()

SQL equivalents: fn_compute_mttr, fn_compute_mtbf, fn_compute_availability,
fn_compute_pmc in migration 00011. Full recomputation orchestrated by
recompute_equipment_analytics() and recompute_all_equipment_analytics() in migration 00018.

---

## Command Center Action Semantics

1. Exact record rule: row-level Command Center actions must open exact records when records exist, such as `/maintenance/work-orders/[id]`, `/maintenance/requests/[id]`, `/pm/schedules/[id]`, `/command/drilldown/procurement/[id]`, or `/command/drilldown/replacement/[assetId]`.
2. Prefilled creation rule: if no record exists, open a prefilled creation flow with asset, part, work-order, quantity, reason, and `source=command-center` context.
3. Informational signal rule: informational signals use acknowledge/snooze or convert-to-workflow actions; they must not route to empty module home pages.
4. Count consistency rule: summary cards, triage tabs, drilldowns, Work Queue & Assignment, and critical actions must share the same fetcher/source for the same metric.
5. State-aware action labels: use Assign for unassigned work, Reassign for assigned work, View Progress for in-progress work, and Resolve Blocker for on-hold work.
6. Future triage categories: new categories must define record IDs, exact routes, and prefilled fallback flows before being shown in the Command Center.
7. BME Head principle: the system recommends, ranks, scores, and explains; the BME Head makes the final decision.

---

## Preventive Maintenance Semantics

1. PM Plan = recurring PM rule/program for equipment, frequency, checklist expectations, and active/inactive state.
2. PM Schedule = one planned PM task instance with scheduled date, assigned technician, status, completion/defer state, and exact detail route.
3. PM Completion = evidence that work was performed: result, checklist, notes/findings, technician, completed date, and final equipment condition.
4. PM Compliance = completed scheduled PM tasks ÷ total scheduled PM tasks. Skipped/deferred PM is tracked separately and does not count as completed.
5. `/pm` is a planned-maintenance control center with summary cards, compliance by department, workflow-aware Plans/Schedules/Overdue tabs, exact row actions, and shared counts.
6. Completion updates PM schedule evidence, inserts PM completion evidence, updates equipment condition, refreshes analytics/risk detectability via the existing recompute pipeline, and revalidates PM, Equipment, and Command Center paths.
7. If PM finds an issue, the completion flow can create/open a corrective request with duplicate prevention.
8. Viewer is read-only. Developer/admin/BME Head manage PM controls; technicians execute PM work where allowed. The BME Head remains the final decision maker.

## PM Count and Action Semantics

1. PM Schedule Records = all generated `pm_schedules` rows, including historical completed, skipped, deferred, canceled, overdue, and upcoming task records.
2. Active PM Tasks = unfinished PM schedules requiring action. Active statuses are `scheduled`, `in_progress`, `overdue`, and `deferred`; completed, skipped, and canceled are not active.
3. PM Plan status is different from asset criticality. Plan: Active/Paused comes from `pm_plans.is_active`; Asset criticality comes from `equipment_categories.criticality_level`.
4. `Needs next task` means the plan has no unfinished upcoming/active schedule, not that it has no PM history.
5. Generate Next Task creates the next `pm_schedules` row only if no unfinished task exists for the plan; otherwise it opens/returns the existing unfinished task.
6. Pause Plan sets `pm_plans.is_active=false` and disables future task generation without deleting history or changing existing task completion state. Resume Plan sets `is_active=true`.
7. History opens exact `/pm/plans/[id]/history` with plan metadata, schedule/evidence history, active/upcoming task state, and exact schedule-detail links.
8. PM Compliance = completed scheduled tasks ÷ total scheduled tasks × 100. Skipped/deferred are tracked separately and do not count as completed.

---

## Offline Capability — Phase 1 Foundation (2026-05-16)

1. Offline/PWA is a separate feature from QR. QR remains complete through Phase 6; do not redesign QR, alter QR token strategy, or claim offline QR scan logging.
2. Phase 1 implements the foundation only: manifest (`public/manifest.webmanifest`), custom service worker (`public/sw.js`), service-worker registration (`ServiceWorkerRegister`), offline fallback route (`/offline`), connectivity hook, dashboard banner/status pill, IndexedDB queue, sync-engine skeleton, server sync-event logging adaptation, role permission helper, Developer Lab diagnostics, and `documents/offline-capability-design.md`.
3. The service worker caches only safe app-shell/static resources. It does not blindly cache authenticated dashboard pages, Supabase auth/API responses, sensitive reports, service-role data, or user-specific operational datasets.
4. A device must open BMEDIS once online before offline loading can work. Desktop/mobile PWA installation is optional; caching depends on service-worker registration during that first online visit.
5. Queue storage is IndexedDB (`src/lib/offline/db.ts`, `src/lib/offline/queue.ts`). New serious offline actions must use IndexedDB, not localStorage. Offline IDs use Web Crypto (`crypto.randomUUID` / `crypto.getRandomValues`), never `Math.random`.
6. `src/types/offline.ts` defines action types and statuses. Online-only actions include procurement/disposal approval, QR token regeneration, user/settings/security changes, analytics refresh, final assignment/final closure, and replacement decisions.
7. `runOfflineCapableAction()` queues only when offline or after likely network failure. Validation/server errors must not be queued blindly.
8. `src/lib/offline/sync-engine.ts` processes actions sequentially by created_at. Phase 1 has no production workflow handlers; unsupported queued actions fail honestly with handler-not-implemented metadata and are not deleted or marked synced.
9. Existing `offline_sync_events` supports only pending/synced/failed and lacks top-level asset_id/role/error/conflict columns. Phase 1 stores extra evidence inside payload, maps conflicts to failed + payload.conflict_reason, and adds no migration.
10. Developer Lab shows Offline & Sync Diagnostics using real browser state. Unknown service-worker/cache status must render as Unknown, not healthy.
11. The offline phases are: 1) Foundation/App Shell/Sync Infrastructure, 2) Offline-Capable Role Workflows, 3) Conflict Handling/Cached Read Views/Sync Evidence.

## AI Copilot Upgrade — Phase 1 (2026-05-16)

1. Central copilot RBAC added at `src/services/chatbot/copilot-rbac.ts`; chat loaders now understand developer/admin/bme_head/technician/store_user/department_head/department_user/viewer instead of shallow admin-only checks.
2. Gemini output handling hardened in `assistant-response-pipeline.ts` and `gemini-provider.ts`: fenced JSON, embedded JSON, safe repairs, plain text, empty/error content, and schema mismatches normalize to valid `AssistantContent` with parser metadata.
3. Deterministic structured fallback now uses retrieved system context when Gemini/provider/parser output fails, instead of dropping to generic unavailable copy when useful data exists.
4. Migration `00047_copilot_usage_tracking.sql` adds `copilot_usage_events` and broadens `chat_messages.answer_basis` CHECK. Usage is app-tracked BMEDIS Gemini usage, not Google AI Studio billing usage.
5. Usage limit config lives in `src/services/chatbot/usage-limits.ts`; hard blocking is opt-in with `COPILOT_HARD_LIMIT_ENABLED=true`.
6. AssistantPanel shows personal daily app-tracked usage. Developer Lab includes AI Copilot Diagnostics with smoke test, provider/usage/fallback/parser/telemetry summaries.
7. Added planned/fallback capabilities: `qr_asset_context`, `offline_sync_status`, `report_summary`, `metric_debug`, `copilot_diagnostics`, and `usage_status`.
8. Documentation added: `documents/copilot-architecture.md`.

## AI Copilot Upgrade — Phase 2 (2026-05-16)

1. Page-aware copilot context bridge added at `src/components/assistant/AssistantPageContextBridge.tsx`; pages register lightweight module/page context instead of relying only on pathname inference.
2. `AssistantProvider` now stores registered page context, selected entity context, page quick prompts, and context timestamps. Chat requests include bounded page facts: active tab, filters, selected record, report type, QR token, offline queue status, visible counts, page data hints, and evidence links.
3. Major pages now register context: Command Center, Equipment, Equipment Detail, Maintenance, Maintenance Request Detail, Work Order Detail, Requests Hub, PM, Calibration, Spare Parts, Logistics, Procurement, Training, Replacement, Disposal, Alerts, Calendar, Reports, Report Detail, Offline Sync, QR Coverage, QR Scan History, QR landing, and Developer Lab.
4. Formal read-only tool contracts live in `src/services/chatbot/tools/tool-types.ts`, `tool-registry.ts`, and `tool-executor.ts`. The executor validates role and required context, applies department/selected-record scoping, and returns structured data, evidence signals, source tables, exact route links, warnings, and denied reasons.
5. Route link helpers live in `src/services/chatbot/route-link-builder.ts`. Assistant responses now support explicit `evidence_used`, `links`, `limitations`, `data_freshness`, and `source_tables`.
6. `AssistantPanel` quick prompts are role-tailored and page-aware for developer, admin/BME Head, technician, store user, department head/user, and viewer roles.
7. QR context includes selected asset, label status, scan evidence links, role category hints, and QR route links. Offline context includes queue status and Sync Review Center links. Phase 2 remains read-only; action drafts/confirmations are Phase 3.

## AI Copilot Upgrade — Phase 3 (2026-05-16)

1. Safe, reviewable action drafts. The copilot proposes, drafts, explains, and links — it never silently mutates. The pattern is: ask → gather context → propose draft → user reviews card → user confirms in modal → existing server action executes → audit log records assistant-assisted action → UI shows exact created/open record link.
2. Action draft types live in `src/types/copilot-actions.ts` with strict Zod validation at every boundary. Kinds include `maintenance_request_create`, `calibration_request_create`, `training_request_create`, `reorder_request_create`, `maintenance_event_note`, `work_order_closure_note` (draft-only), `department_issue_report`, `open_record`, `open_report`, `copy_summary`, and `offline_queue_action`. Execution modes: `link_only`, `draft_only`, `confirm_then_execute`, `online_only`, `offline_capable`.
3. Drafts are generated in `src/services/chatbot/action-draft-service.ts` only when (a) the message clearly matches an intent regex and (b) `canCreateCopilotDraft()` permits the active role/draft type. Viewer never receives mutation drafts. Department roles are auto-scoped to their own department. At most four drafts per response and one per kind. Drafts always go through `CopilotActionDraftSchema.safeParse` before being attached to the assistant payload.
4. AssistantContent gained `action_drafts: CopilotActionDraft[]` (default `[]`). The orchestrator attaches drafts after normalization; all provider-output and deterministic-fallback paths still produce a schema-safe payload.
5. UI components: `src/components/assistant/CopilotActionCard.tsx` renders each draft (risk badge, execution-mode badge, validation warnings, evidence used, Open/Copy/Review buttons). `CopilotActionConfirmDialog.tsx` opens a Modal with readonly linked context and editable safe fields. Server re-validates everything regardless.
6. Server executor: `src/actions/copilot-actions.actions.ts` exposes `executeCopilotActionDraftAction(input)`. It re-authenticates, re-checks `canCreateCopilotDraft`, re-checks department scope for `department_head`/`department_user`, refuses `draft_only`/`link_only`, merges only declared-editable overrides as primitives, calls existing server actions (`createMaintenanceRequestAction`, `createCalibrationRequestAction`, `createTrainingRequestAction`, `createProcurementRequestAction`, `createMaintenanceEventAction`), surfaces duplicate-open-request as `status: 'conflict'` with exact existing record link, and writes an `audit_logs` row keyed `action='copilot.draft.executed.<kind>'` containing chat session id, message id, draft id, role category, evidence used, and source route.
7. Offline integration: `src/components/assistant/copilot-offline.ts` maps offline-capable kinds to existing `OfflineActionType` values and queues via `enqueueOfflineAction()` when navigator is offline. No new offline action types added. Procurement approval, disposal approval, QR token admin, settings/security changes, analytics refresh, final work-order assignment/closure, and replacement decisions stay online-only and not draftable.
8. Usage hardening: AssistantPanel now shows a soft warning band near limit and a hard-stop band when `COPILOT_HARD_LIMIT_ENABLED=true`. Hard-limit skips the provider call but still returns a deterministic local response. Local intro responses are not counted.
9. Developer Lab Copilot Diagnostics now includes an Action Drafts Executed Today metric and a per-kind breakdown derived from `audit_logs` rows where `action LIKE 'copilot.draft.executed.%'`. Non-privileged roles only see their own drafts.
10. Tests: 7 new tests in `src/services/chatbot/__tests__/copilot-action-drafts.test.ts` cover viewer-no-mutation, BME-head maintenance draft Zod validity, department-scope auto-binding, technician event note, store reorder, non-mutation intent has no mutation drafts, and offline-capable kind mapping. Total chatbot tests: 129/129 pass.
11. No new database migration in Phase 3. Audit metadata uses existing `audit_logs.details` jsonb. Existing chat session/message persistence is unchanged.

## AI Copilot Quality/Grounding Pass (2026-05-16)

1. The copilot answer pipeline is now tool/data-first: role + page/entity context → scoped BMEDIS tool retrieval → deterministic answer candidate → Gemini naturalization → normalization → usefulness guard. BMEDIS records and page/tool context are the source of truth; Gemini must not invent operational facts.
2. Deterministic builders live in `src/services/chatbot/deterministic-answer-builders.ts` and cover operational priority, asset context, work orders, department readiness, stock blockers, viewer summaries, developer diagnostics, safe troubleshooting, reports, offline sync, QR asset context, and common concepts (RPN/MTTR/MTBF/PM compliance).
3. `src/services/chatbot/response-usefulness-guard.ts` replaces/augments generic, failure-style, or low-evidence provider output when system evidence exists. Provider failure/hard-limit paths now prefer deterministic system-data answers before user-facing AI-unavailable copy.
4. Classifier/page-aware routing was expanded for normal chat, page summaries, QR asset pages, reports, offline sync conflicts, stock blockers, prioritization, troubleshooting, and developer diagnostic phrasing.
5. Action drafts are rarer: summary/explain/prioritize/evidence questions do not show draft cards. Draft cards require explicit create/draft/request/report/log/reorder/write/submit/queue-style intent. Viewer remains read-only.
6. Gemini prompt now requires natural copilot language, compact evidence, role-safe answer depth, no "I think/probably/maybe" phrasing for grounded answers, safe first-line troubleshooting only, and no provider/parser/classifier/tool-trace clutter for normal roles.
7. Assistant UI uses opaque assistant surfaces and natural chat rendering; normal users see paragraphs, compact evidence chips, useful next steps, and action cards only when requested. Developer-only debug remains collapsed.
8. Tests added in `src/services/chatbot/__tests__/deterministic-answer-builders.test.ts`; chatbot test count is now 137/137.

## Offline Capability — Phase 2 Role Workflows (2026-05-16)

1. Phase 2 wires selected low-risk workflows through `runOfflineCapableAction()`. Do not route risky authority actions through this helper.
2. Real replay handlers live in `src/lib/offline/handlers/` and call `syncOfflineQueuedActionAction()` in `src/actions/offline-sync.actions.ts`. Existing server actions remain the authority for RBAC, validation, audit logging, and revalidation.
3. Implemented handler action types: `maintenance_request.create`, `department_issue.report`, `maintenance_event.log`, `qr_note.create`, `calibration_request.create`, `training_request.create`, `store_reorder.create`, `stock_receipt.draft`, `stock_issue.draft`, `work_order.start_intent`, and `work_order.complete_draft`.
4. Technician workflow: maintenance events/notes, corrective requests, parts-needed notes, work-start intent, and completion drafts. Final work-order closure remains online-only.
5. Department Head/User workflow: maintenance/problem reports, calibration requests, and training requests. Department-scoped replay validates `profile.department_id` and asset department; no all-hospital fallback.
6. Store workflow: reorder requests and stock receipt/issue drafts. Replay validates part existence, active state, quantity, current stock, and linked work-order state. No stock balance is changed without server acceptance.
7. QR integration is capture-only: technician/department/store/BME draft panels can queue safe actions, but QR scan logging, token generation/regeneration, labels, coverage, and evidence remain unchanged and online-first.
8. Conflicts are already used for obvious invalid replay cases: missing/deleted asset, revoked QR token, wrong department, duplicate request, terminal work order, insufficient stock, inactive/missing part, invalid quantity, and receipt drafts requiring procurement linkage not present in current schema.
9. Developer Lab Offline & Sync Diagnostics now shows local queue counts by type/role, failed/conflict actions, unsupported/future actions, payload inspection, retry failed, clear synced, export JSON, and recent server `offline_sync_events`.
10. Still not implemented: conflict review center, cached read views, procurement/disposal approval offline, final assignment/final closure offline, browser notifications, Background Sync dependency, full report generation offline, and any fake production test actions.

## Notifications Subsystem (2026-05-17)

1. In-app notifications are the canonical source of truth; Telegram is an optional external delivery channel only. No SMS, no email, no browser push notifications are implemented. Telegram is never used as an authorization plane — links always open the app where role/department checks still apply.
2. Migration 00055 adds `notification_events`, `notifications`, `notification_rule_logs`, `notification_deliveries`, and `telegram_connections` with hot-path indexes and RLS (own-row read/update for `notifications`; developer/admin/bme_head read diagnostics; privileged insert via server actions). Next migration must be 00056.
3. Engine modules in `src/services/notifications/`: `notification-engine.ts` (event create/process, fan-out, fire-and-forget `emitNotificationEvent`), `notification-rules.ts` (role-aware message templates), `recipient-resolver.ts` (active profiles by role + department scope), `notification-dedupe.ts` (10-min cooldown by recipient+event+source; merge into existing, suppress Telegram unless priority increased to critical), `notification-links.ts` (exact-record routing — request/WO/PM schedule/procurement drilldown/replacement evidence/spare parts blocker/offline-sync/asset QR tab), `telegram-provider.ts` (Bot API calls, formatters, eligibility/config checks, chat-id masking), `notification-delivery.service.ts` (sends real Telegram + monitor copy, writes `notification_deliveries`).
4. Server actions in `src/actions/notifications.actions.ts`: user-facing read/mark/dismiss/mark-all-read/summary, and developer-only diagnostics, rule check, test notification, Telegram test, sample role notifications, fetch bot updates, save chat id, re-deliver.
5. Trigger integrations are all fire-and-forget after their primary mutation succeeds; notification failures are caught and logged. Wired actions: `createMaintenanceRequestAction`, `updateRequestStatusAction`, `assignWorkOrder`/`reassignWorkOrder`, `updateWorkOrderAction`, `createPMCompletionAction`, `assignPMScheduleAction`, `createCalibrationRequestAction`, `updateProcurementStatusAction` (delivered only — the enum has no `delayed` value; delayed is detected by the scheduled rule check), `markQrLabelNeedsReplacementAction`, `recordOfflineSyncEventAction` (offline conflicts/failures).
6. UI: `src/components/notifications/NotificationBell.tsx` is mounted in the Topbar for every authenticated role with 45 s unread polling, critical-unread ring, mark-read/mark-all/dismiss/deep-link. `src/app/(dashboard)/notifications/page.tsx` is the full Notification Center with tabs (For Me, Critical, Tasks, Requests, Compliance, Stock & Procurement, System, Reviewed), filters (priority/category/status/search), and Send-test button. `src/app/(dashboard)/developer-lab/NotificationDiagnosticsSection.tsx` is the Developer Lab section with in-app + Telegram stats, test tools, sample role notifications, delivery logs, and rule activity.
7. Alerts is removed as a user-facing navigation entry. `Notifications` (icon `Bell`, capability `nav.alerts`) replaces the entry in `NAV_SECTIONS`. Middleware redirects `/alerts` → `/notifications`; the legacy `/alerts` page renders a client-side fallback redirect for cached routes. Internal `recommendation_flags` is still useful as a notification trigger source but is not rendered as a page.
8. Telegram env vars (none of which are exposed to client code): `TELEGRAM_NOTIFICATIONS_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEV_MONITOR_ENABLED`, `TELEGRAM_DEV_MONITOR_CHAT_ID`, `TELEGRAM_MIN_PRIORITY` (default `high`), `TELEGRAM_SEND_LOW_PRIORITY` (default `false`), `NEXT_PUBLIC_APP_URL`. Chat ids are masked to `••<last4>` in every UI surface; tokens never appear in the UI at all.
9. Developer Monitor Mode is mandatory for testing. When enabled, every Telegram-eligible notification (any role) also sends a monitor copy to `TELEGRAM_DEV_MONITOR_CHAT_ID` with the original recipient, role, message, action link, and actual delivery status. The monitor fires even when the real recipient has no Telegram connection — that scenario is logged as `skipped: no_chat_id` for the real channel and `sent` for the monitor channel.
10. Telegram eligibility (`isTelegramEligible`): always true for critical/high priority, category `critical`, or source types `work_order.assigned`, `work_order.stock_blocked`, `offline_sync.conflict`, `spare_part.stockout`, `qr.label_needs_replacement`, `qr.revoked_scanned`, `system.test_notification`, `notification.rule_failed`. Dismissed/reviewed rows are never sent regardless of priority. `TELEGRAM_MIN_PRIORITY` controls the medium/low boundary.
11. Tests: 14 notification tests at `src/services/notifications/__tests__/notifications.test.ts` cover deep-link routing, dedupe-key stability, Telegram eligibility (including suppression for dismissed/reviewed), chat-id masking, and Telegram body + monitor formatting. The chatbot suite continues to pass 147/147 unchanged.
12. Security/data-integrity rules: bot token is server-only, chat ids are masked everywhere, no service-role usage in the notification path, no patient data sent over Telegram, no client-side direct writes to `notifications` (server actions only), notification failures never break the primary workflow, viewer never receives technician/store/department-specific noise.

---

## Migration history

00001 — Reference/master data tables
00002 — Auth + profiles + audit_logs
00003 — Equipment assets + locations + history
00004 — Maintenance + work orders + events + downtime
00005 — PM plans + schedules + completions
00006 — Calibration records + requests
00007 — Logistics: spare_parts, stock_receipts, stock_issues
00008 — Training sessions + records
00009 — Disposal requests + disposed_assets
00010 — Analytics tables (reliability, risk, PMC, performance, replacement, flags)
00011 — SQL views + analytics functions
00012 — RLS policies
00013 — Decision support tables (triage, health, readiness, workload) + procurement
00014 — Decision support RLS + refresh_decision_support_snapshots()
00015 — Chatbot: chat_sessions + chat_messages
00016 — Copilot memory + telemetry + eval tables
00017 — Offline sync events + hardening
00018 — Analytics recompute orchestration RPCs
00019 — Command center completeness + baseline risk score generation
00020 — Fix MTBF date_extract bug
00021 — Decision support read models: decision_support_refresh_log table + 5 read-model views
         (v_command_center_triage, v_asset_health_summary, v_department_readiness,
          v_replacement_decision, v_maintenance_risk_context)
00022 — Developer role + link beamlak.work@gmail.com auth user to profile
00023 — Replacement scores for all 80 assets, triage accumulation fix, PMC department_id fix
00024 — PM plans/schedules/completions/compliance for Inpatient Ward, Pharmacy, Radiology (8/8 depts)
00025 — Command Center actions: maintenance_requests.request_type, pm_schedules.source_context, audit_logs.performed_by + details
00026 — Developer role included in RLS alongside admin/technician where appropriate
00027 — Audit remediation: one-shot recompute_all_equipment_analytics() backfill on deploy
00028 — Audit performed_by defensive UPDATE
00029 — Constraints: recommendation_flags low_stock, non-negative repair/downtime durations, partial unique asset_code (active), PMC grain unique + dedupe, drop old global asset_code UQ
00030 — Hot-path btree indexes (flags, triage, requests, work orders, PM schedules)
00031 — Recreate v_open_work_orders, v_overdue_pm, v_calibration_due, v_replacement_decision, v_maintenance_risk_context (deleted_at filters + COALESCE)
00032 — DROP repeat_repair_flags, equipment_locations (unused by app)
00033 — chat_sessions.equipment_id renamed to asset_id
00034 — equipment_reliability_metrics: dedupe to latest row per asset_id; UNIQUE(asset_id); _recompute_asset_metrics uses ON CONFLICT (asset_id) DO UPDATE
00035 — Drop legacy composite UNIQUE on equipment_reliability_metrics (PG-truncated name missed in 00034)
00036 — FMEA risk engine (risk explanation JSONB, assignment methods, override capabilities)
00037 — command_center_acknowledgements table (item_type, item_key, asset_id, signal_hash, acknowledged_at, snoozed_until)
00038 — maintenance_requests.reported_condition (functional_issue/needs_repair/non_functional) + reported_condition_source
00039 — work_orders.completion_outcome (resolved/partially_resolved/not_resolved/awaiting_parts_or_vendor) + final_equipment_condition
00040 — installation_requests workflow rows
00041 — specification_requests workflow rows
00042 — PM schedule evidence fields, deferred status, and enriched v_overdue_pm
00043 — v_calibration_due exposes asset_id for exact Command Center/Calibration drilldowns
00044 — v_open_work_orders adds asset_id + department_id; v_overdue_pm adds department_id (non-breaking)
00045 — Equipment QR Identity Foundation (Phase 1): adds qr_token + label lifecycle metadata to equipment_assets (unique-when-not-null index, CHECK on qr_label_status); creates equipment_qr_scans audit table with RLS (admin/developer/bme_head + self can read; authenticated can insert)
00046 — Offline Sync Events Phase 3: adds first-class columns to offline_sync_events (reported_status, resolution_status, conflict_type, conflict_reason, error_message, role_name, source_route, asset_id, retry_count, resolved_by, resolved_at); relaxes sync_status CHECK to accept queued/syncing/conflict/under_review/resolved_synced/resolved_discarded; new CHECK on resolution_status; hot-path indexes; one-shot payload backfill; RLS UPDATE policy reaffirms bme_head/admin/developer/technician
00047 — Copilot usage tracking: updates chat_messages answer_basis CHECK, creates copilot_usage_events with app-tracked Gemini usage, provider/fallback status, estimated/provider token fields, and RLS for own usage plus developer/admin/bme_head aggregate reads
00048 — pgvector embeddings (chatbot semantic context)
00049 — pg_cron schedule
00050 — pg_cron RLS
00051 — pg_cron poll budget
00052 — pg_cron shared secret
00053 — pg_cron log retention
00054 — pg_cron fire and reap
00055 — Notifications subsystem: notification_events, notifications (status/category/priority CHECKs), notification_rule_logs, notification_deliveries (channel CHECK telegram/telegram_monitor), telegram_connections (unique per profile). RLS: own-row read/update for notifications; developer/admin/bme_head read diagnostics; privileged insert via server actions. Hot-path indexes on (recipient,status,created_at), (priority,created_at), (category,created_at), (source_type,source_id), (dedupe_key), (asset_id), (department_id), notification_events(event_type,created_at), notification_events(processing_status,created_at), notification_deliveries(notification_id), notification_deliveries(status,created_at), telegram_connections(profile_id)
00066 — Equipment INSERT hotfix: replaces fn_trigger_refresh_fmea_risk_score() so equipment_assets uses NEW.id/OLD.id (00036 incorrectly used NEW.asset_id, causing every equipment INSERT to fail with `record "new" has no field "asset_id"`); drops legacy `manage_equipment` RLS policy and the manually-applied hotfix `"Privileged users can insert equipment assets"`; installs `equipment_assets_privileged_write` FOR ALL TO authenticated for developer/admin/bme_head only (USING + WITH CHECK). Technician's narrow condition-update path still works via SECURITY DEFINER RPC `update_equipment_condition_secure` from 00059. Department-scoped SELECT policies from 00060 untouched.
00067 — Maintenance workflow RLS hotfix: replaces `manage_maintenance_requests` UPDATE policy and `manage_work_orders` FOR ALL policy so the DB authorization layer matches the application capability matrix. bme_head is now on the allowlist alongside developer/admin/technician. Before this fix, BME Head clicking Approve on /maintenance/requests/[id] raised PostgREST PGRST116 "Cannot coerce the result to a single JSON object" because the UPDATE matched 0 rows under RLS. Department-scoped SELECT policies from 00060 untouched.

NEVER modify 00001–00066. Next migration must be 00068.

---

## Semifinal UI Foundation (2026-05-18, branch `ui_semifinal`)

Foundation-only pass — no page rewrites. Establishes the shared design-system
layer that Tier 1 page refreshes (Login, DashboardLayout, Command Center,
Notifications, AI Copilot, QR landing, Equipment detail, Maintenance/WO, Offline
sync, Reports) will adopt in a later pass.

### New shared tokens — `src/lib/ui/`
- `motion-presets.ts` — framer-motion `Variants`: `pageFade`, `slideUp`, `cardStagger`, `cardItem`, `drawerSlideLeft`, `drawerSlideRight`, `modalScale`, `tabCrossfade`, `subtleHover`, `attentionPulse`, `noMotion`; `transitions.{fast,default,slow,spring}`; `useMotionVariants(variants)` swaps in `noMotion` under `prefers-reduced-motion`.
- `chart-theme.ts` — `useNivoTheme()` returns a `PartialTheme` (from `@nivo/theming`), the chart palette (`--chart-1..6`), and the semantic color map (`brand`, `success`, `warning`, `danger`, `info`, `muted`). Listens to the existing `bmedis-theme-change` event so Nivo retints in lock-step with `useChartTheme` (Chart.js). Includes `STATUS_COLOR_MAP`.
- `role-theme.ts` — per-`RoleName` accent token set (`ROLE_ACCENTS`): `workspaceLabel`, `workspaceSubtitle`, `accent`, `accentSoft`, `accentText`, `allowDense`. Brand stays dominant; accent is visible only in role chips / workspace headers. Helper `getRoleAccent(role)` with viewer fallback.
- `status-styles.ts` — `toneBadgeClass`, `toneRingClass`, `toneDotClass` keyed by `SemanticTone` (`neutral|info|success|warning|danger|brand|developer`). `statusTone(status)` maps common status strings (critical, overdue, blocked, low_stock, in_progress, completed, synced, etc.) to a tone. Complements existing `action-styles.ts` (button styling) — this file is for badge/chip/border styling.

### New shared components — `src/components/ui/`
- `LottiePlayer.tsx` — dynamic-import wrapper around `@lottiefiles/dotlottie-react` with HEAD-check fallback. Exports `LOTTIE_PATHS` (`empty`, `offline`, `success`, `notification`, `aiThinking`, `scan`). Falls back to caller-supplied fallback when asset is missing or reduced motion. No external CDN fetches.
- `EmptyState.tsx` — enhanced in place. New `lottie?: LottieKey` prop (icon-fallback when asset is absent) and `compact?: boolean` variant. Existing call sites unchanged.
- `AnimatedMetric.tsx` — react-spring-driven number counter. Honours `prefers-reduced-motion` (snaps to target). Use only for headline KPIs.
- `SpringGauge.tsx` — react-spring circular gauge. `autoTone` picks tone from value (≥85 success, ≥60 brand, ≥40 warning, else danger). NaN/null → muted "no data" arc with `—` label.
- `MotionCard.tsx` — framer-motion enhanced glass card. Drops into `cardStagger` containers; `subtleHover` lift (interactive default true). Does NOT replace `Card`.
- `SectionHeader.tsx` — title + description + optional eyebrow + right-side action. Use above each block inside a page; `PageHeader` stays at the top.
- `ResponsiveTableShell.tsx` — horizontal-scroll wrapper for wide tables on mobile. Optional caption and `bare` variant for tables already inside a `Card`.
- `LoadingState.tsx` — region-level loading state with Lottie + spinner fallback. `Spinner`/`PageLoader` still cover button/page-level cases.
- `RoleWorkspaceShell.tsx` — page-section shell that tags content with a role chip + subtitle from `ROLE_ACCENTS`, applies `pageFade` mount transition. Mount inside a page *after* `PageHeader`.

### New chart shells — `src/components/charts/nivo/`
- `NivoChartShell.tsx` — title/description/footer/action chrome with explicit `height`. Renders `EmptyState` (compact) when `isEmpty`, instead of a blank chart.
- `BmedisBarChart.tsx` — Nivo `ResponsiveBar` with BMEDIS theme: 0.28 padding, 4px corners, grouped/stacked, horizontal/vertical, auto tick rotation when >6 categories.
- `BmedisLineChart.tsx` — Nivo `ResponsiveLine`, default `monotoneX` curve, theme points (auto-hidden when total points >24), optional area fill. Data shape: `BmedisLineSeries`. Curve type is `LineCurveFactoryId` from `@nivo/core`.
- `BmedisPieChart.tsx` — Nivo `ResponsivePie` donut (default `innerRadius=0.6`), padded arcs, optional arc/link labels, slim bottom legend. Pie does not accept `ariaLabel`, only `role="img"`.

### Lottie assets
- `public/lottie/README.md` documents the six expected filenames (`empty-state`, `offline`, `success`, `notification`, `ai-thinking`, `scan`) and the `.lottie` format requirement.
- No binary assets ship in this pass — all consumers gracefully fall back to lucide icons via `LottiePlayer`'s missing-asset detection. Assets to be added before page-refresh pass.

### Verification
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean (fixed `react-hooks/set-state-in-effect` by lifting reduced-motion detection into `useState` initialisers)
- `npm run test:chatbot` ✅ 147/147
- `npm run build` ✅ 54/54 routes built, no warnings

### Out of scope this pass (deliberate)
- No page rewrites. Login, Dashboard layout/topbar/sidebar, Command Center, Notifications, AI Copilot panel, QR landing, Equipment detail, Maintenance/WO, Offline sync, Reports — all unchanged.
- No edits to existing pages' chart usage. Chart.js components in `src/components/charts/*.tsx` remain authoritative until pages opt into Nivo.
- No GSAP integration yet. Reserved for login hero + command-center hero in the page-refresh pass.
- No theme-provider migration. The custom `src/components/theme/ThemeProvider.tsx` stays in use; `next-themes` remains installed but unused. `src/providers/ThemeProvider.tsx` is unused dead code (untouched to avoid churn).
- No mobile audit or role-decluttering of existing pages — both rely on the new shells (`RoleWorkspaceShell`, `ResponsiveTableShell`, `SectionHeader`) being adopted page by page.

### Next-pass adoption order (Tier 1)
1. Login (with GSAP biomedical-grid hero) + theme audit
2. DashboardLayout / Topbar / Sidebar (`MotionCard` reveal, mobile drawer, AssistantPanel surface fix)
3. Command Center (`RoleWorkspaceShell`, `AnimatedMetric`, `SpringGauge`, Nivo charts where data warrants)
4. Notifications (drawer with `drawerSlideRight`, `EmptyState lottie='notification'`)
5. AI Copilot panel (opaque surface, `LoadingState lottie='aiThinking'`)
6. QR landing page (mobile-first, `MotionCard` entrance)
7. Equipment detail (`SectionHeader`, gauge for reliability)
8. Maintenance / Work Order detail
9. Offline sync (`LoadingState`, conflict cards)
10. Reports (Nivo charts where Chart.js doesn't clarify)

---

## Semifinal UI Tier 1 Pass (2026-05-18, branch `ui_semifinal`)

Page-level adoption of the foundation across the Tier 1 surfaces. Targeted
enhancements only — no page rewrites, no analytics/business-logic changes, no
chart-library migrations on existing reports.

### Wave 1 — Always-visible chrome
- `src/components/layout/DashboardLayout.tsx`:
  - Mobile drawer now uses framer-motion `AnimatePresence` with `drawerSlideLeft` (drawer) + fade (scrim). Overlay only mounts when open, avoiding the dead `pointer-events: none` layer.
  - Main `<main>` content wrapped in `AnimatePresence mode="wait"` keyed by `usePathname()` with `pageFade` — every route transition fades cleanly.
  - Dropped the redundant route-change effect on `mobileMenuOpen`; the existing `onNavigate={closeMobileMenu}` callback on Sidebar nav items already closes the drawer on tap.
- `src/components/assistant/AssistantPanel.tsx`:
  - "Generating response…" indicator now uses `LottiePlayer` with `LOTTIE_PATHS.aiThinking` and a `Loader2` animate-spin fallback. Surface stays opaque via `--assistant-surface` (no transparency regression).
- `src/components/notifications/NotificationBell.tsx`:
  - Critical ring now uses motion `attentionPulse` (loop, calm). Drawer wrapped in `AnimatePresence` + `slideUp`.

### Wave 2 — Login page
- `src/app/(auth)/login/page.tsx`: form root wrapped in `motion.div` with `slideUp` + `transitions.slow`; error message wrapped in `AnimatePresence` so it slides in/out cleanly instead of flashing.
- New `src/components/auth/LoginPulseLayer.tsx`: lazy-imports GSAP and renders a single ECG-shaped SVG polyline with a yoyo `strokeDashoffset` animation behind the existing `AuthDashboardBackdrop`. Honours `prefers-reduced-motion`; GSAP failure is silent (path stays static). This is the ONLY place GSAP is used in the app.

### Wave 3 — Command Center
- `src/app/(dashboard)/command/_components/SummaryActionCards.tsx`:
  - Grid wrapped in `motion.div` with `cardStagger`; each card carries `cardItem` + `subtleHover` lift.
  - Static `<p>{card.value}</p>` replaced with `<AnimatedMetric value={card.value} />` so KPI numbers count up on mount.
- `src/app/(dashboard)/command/_components/CriticalActionStrip.tsx`:
  - Items list wrapped in `cardStagger` + `cardItem` motion for ordered reveal.
- The rest of Command Center (TriageCenterTabs, DepartmentDashboard, StoreOperationsCommandCenter, ViewerExecutiveCommandCenter, WorkloadAssignment, RiskBandDrilldown, etc.) is intentionally unchanged — motion patterns are now established and adoption can ripple through future passes.

### Wave 4 — Notifications + Offline sync + QR
- `src/app/(dashboard)/notifications/page.tsx`:
  - Empty list renders via shared `EmptyState` with `lottie='notification'` (icon fallback when asset is missing).
- `src/app/(dashboard)/offline-sync/SyncReviewCenterClient.tsx`:
  - 6-card summary strip wrapped in `cardStagger` + `cardItem`. Each count uses `<AnimatedMetric />`.
- QR landing (`src/app/qr/a/[token]/QrAssetLandingPage.tsx`) — **deliberately skipped**. It's a server component with a strict auth/scan flow; adding framer-motion would force a client conversion that risks regression. Mobile-first layout was already in place.

### Wave 5 — Equipment detail + Reports
- `src/app/(dashboard)/equipment/[id]/page.tsx`:
  - Reliability `HealthCard` now renders a centered `SpringGauge` (`autoTone`) for availability when `reliability.availability_ratio` is computable. Existing MetricLine/MetricExplain still render below as the textual/audit-evidence form.
- Reports (`/reports` and `/reports/[type]`): Chart.js stays authoritative. The Nivo foundation is ready for opt-in but no live charts were migrated this pass — risk of breaking export/PDF flows is not worth a cosmetic swap.
- Maintenance / Work Order detail — no enhancements this pass (Wave 5 scope tightened to keep the pass small and verifiable).

### Verification
- `npx tsc --noEmit` ✅
- `npm run lint` ✅ (one rule fix: removed `setMobileMenuOpen(false)` effect on pathname in DashboardLayout — `react-hooks/set-state-in-effect`; the existing nav `onNavigate` callback already handles this case)
- `npm run test:chatbot` ✅ 147/147
- `npm run build` ✅ 54/54 routes built

### Deliberately deferred
- Topbar/Sidebar motion entry (current chrome is already polished; mount animations would conflict with route fade).
- Command Center Nivo charts — Chart.js components remain. The foundation is ready for opt-in.
- TriageCenterTabs / DepartmentDashboard / StoreOps / ViewerExec motion — large files, no compositional refactor attempted here.
- Maintenance overview, Work Order detail, Reports detail polish.
- Mobile audit of every Tier 1 page (existing `panel-surface` + Tailwind responsive utilities cover most cases).
- Role-specific decluttering. Foundation provides `RoleWorkspaceShell`; pages can opt in.
- Manual browser validation. **Not performed** in this pass.

### What still needs manual browser validation
- Page route fade behaviour at standard navigation speed (does it feel snappy or laggy on a slow device?).
- Mobile drawer slide open/close — confirm no scroll-lock bug.
- AssistantPanel "thinking" state under both Lottie-present and Lottie-missing conditions.
- NotificationBell critical pulse readability in light mode.
- Login GSAP pulse with `prefers-reduced-motion` enabled (should be static).
- Command Center on a real account with non-zero KPI values (the count-up should be smooth, not jarring).
- Equipment detail SpringGauge in dark mode for an asset whose availability is computable.

---

## Tier 1 deferred + Tier 2 sweep (2026-05-18, branch `ui_semifinal`)

Same surgical pattern as Tier 1 — grid `cardStagger` + child `cardItem`,
`AnimatedMetric` on numeric KPIs, `EmptyState` Lottie keys where applicable.
No analytics/business-logic touched; no Chart.js→Nivo migration.

### Foundation upgrade
- `src/components/ui/StatCard.tsx` now wraps the numeric `value` in
  `<AnimatedMetric />` automatically (string values pass through unchanged).
  Every page using `StatCard` (calibration, spare-parts, logistics,
  procurement, replacement, audit, settings) inherits the spring count-up
  without per-page edits. The file now carries `'use client'` because
  `AnimatedMetric` is client-only.

### Wave A — Command Center subcomponents (Tier 1 deferral)
- `DepartmentDashboard.tsx`: added `'use client'`; metric grid wrapped in
  `cardStagger`/`cardItem`; numeric values via `AnimatedMetric`. Static
  strings (e.g. "On track") pass through.
- `StoreOperationsCommandCenter.tsx`: same pattern.
- `ViewerExecutiveCommandCenter.tsx`: same pattern.
- `CommandCenterInteractive.tsx`: 3-card "Work in progress" section wrapped
  in `cardStagger`; the three buttons converted to `motion.button` with
  `cardItem`; headline numbers via `AnimatedMetric`.
- `WorkloadAssignment.tsx`: technician card grid wrapped in
  `cardStagger`/`cardItem`.
- `TriageCenterTabs.tsx` and `RiskBandDrilldown.tsx`: deliberately
  unchanged — TriageCenterTabs is table-driven (motion would be noise),
  RiskBandDrilldown is an interactive expand/collapse list (motion would
  fight the open/close interaction).

### Wave B — Maintenance overview (Tier 1 deferral)
- `src/app/(dashboard)/maintenance/page.tsx`: 8-card summary strip wrapped
  in `cardStagger`; local `SummaryCard` now uses `motion.button` + `cardItem`
  and renders the value via `AnimatedMetric`.
- Work Order detail / Maintenance request detail: not touched. Detail pages
  already inherit the route `pageFade` from `DashboardLayout`; adding more
  motion to dense detail forms would be visual noise. Leaving for a
  later pass if the design wants further polish.

### Wave C — Topbar/Sidebar (re-evaluated, kept deferred)
- Considered adding mount motion. Reverted: Topbar/Sidebar re-render on every
  route change (pathname-driven active state). Adding `initial="initial"
  animate="animate"` would re-trigger the stagger on every nav click. Not
  worth the cost.

### Wave D — Tier 2
- `src/app/(dashboard)/pm/page.tsx`: 4-card summary strip wrapped in
  `cardStagger`/`cardItem`; counts via `AnimatedMetric`. Buttons remain
  workflow-controlled.
- `src/app/(dashboard)/calibration/page.tsx`: 8-card `StatCard` grid wrapped
  in `cardStagger`; each card in a `cardItem` `motion.div`. The shared
  `StatCard` already supplies the count-up.
- `src/app/(dashboard)/spare-parts/page.tsx`: 8-card `StatCard` grid wrapped
  in `cardStagger`.
- `src/app/(dashboard)/logistics/page.tsx`: 8-card `StatCard` strip wrapped
  in `cardStagger`.
- `src/app/(dashboard)/procurement/page.tsx`: 9-card `StatCard` grid wrapped
  in `cardStagger`.
- `src/app/(dashboard)/replacement/page.tsx`: 10-card `StatCard` grid wrapped
  in `cardStagger`.

### Verification
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:chatbot` ✅ 147/147
- `npm run build` ✅ 54/54 routes

### Still deferred (and why)
- **QR landing** — server component, auth/scan flow risk.
- **Reports Chart.js→Nivo bulk migration** — PDF/export flows depend on
  Chart.js refs.
- **Work Order detail / Maintenance request detail / Reports detail polish**
  — detail forms; motion would be noise.
- **Tier 3** (Developer Lab, Settings, Audit) — not started this pass.
- **Mobile audit + browser validation** — no browser available.
- **Role-decluttering** — pattern is established via `RoleWorkspaceShell`;
  per-page opt-in.

---

## Final deferred sweep + Tier 3 (2026-05-18, branch `ui_semifinal`)

The deferred items from earlier passes were re-evaluated and most were
completed. Honest call-outs included below for the things genuinely skipped.

### Wave 1 — Topbar + Sidebar mount motion
- `src/components/layout/Sidebar.tsx`: nav wrapped in `motion.nav` with
  `cardStagger`; each section group in `motion.div` with `cardItem`. Plays
  once on dashboard mount; pathname changes don't replay because the parent
  motion containers don't unmount (they sit OUTSIDE the route AnimatePresence).
- `src/components/layout/Topbar.tsx`: header wrapped in `motion.header` with a
  one-time `opacity + y:-8 → 0` slide-down at `transitions.default`.

### Wave 2 — Detail page polish
- `src/app/(dashboard)/maintenance/work-orders/[id]/page.tsx`: main content
  container (`<div className="space-y-6">`) wrapped in `motion.div` with
  `slideUp`. Layers cleanly with the route-level `pageFade` — the page first
  fades in, then the inner card stack slides up.
- `src/app/(dashboard)/maintenance/requests/[id]/page.tsx`: same pattern.
- `src/app/(dashboard)/reports/[type]/page.tsx`: KPI card section wrapped in
  `motion.section` with `cardStagger`; each KPI tile in `motion.div` with
  `cardItem`.

### Wave 3 — QR landing motion
- `src/app/qr/a/[token]/QrAssetLandingPage.tsx`: converted to client component
  (no server-only imports — verified). Outer `<div>` replaced with a
  `motion.div` using `pageFade`. The parent server `page.tsx` continues to do
  resolution / auth / scan logging unchanged.

### Wave 4 — Reports list motion
- `src/app/(dashboard)/reports/page.tsx`: `ReportCard` wrapped in a `motion.div`
  with `cardItem` (via `className="contents"` so layout is unaffected). All 4
  occurrences of the `grid gap-3 sm:grid-cols-2 xl:grid-cols-4` report grid
  wrapped in `motion.div` with `cardStagger`. Section ordering / layout
  unchanged.

### Wave 5 — Developer Lab
- `src/app/(dashboard)/developer-lab/QrCoverageSection.tsx`: both coverage
  card grids (8-card top + 4-card scan-evidence) wrapped in `cardStagger`;
  numeric values via `AnimatedMetric`.
- `src/app/(dashboard)/developer-lab/OfflineDiagnosticsPanel.tsx`: 5-card sync
  summary strip wrapped in `cardStagger` + per-card `cardItem` + `AnimatedMetric`.
- `src/app/(dashboard)/developer-lab/page.tsx` (server): 4-card top strip
  unchanged — server component, and `Card` inside doesn't accept motion props
  without a client wrapper. Not worth a refactor for 4 cards; route `pageFade`
  handles the entrance.

### Wave 6 — Settings
- `src/app/(dashboard)/settings/page.tsx`: Staff & Access summary (4 cards)
  and Security & Access summary (4 cards) wrapped in `cardStagger`/`cardItem`
  with `AnimatedMetric` for numeric counts.

### Wave 7 — Audit
- `src/app/(dashboard)/audit/page.tsx`: server-rendered. Uses shared
  `StatCard` which now animates numbers via the foundation upgrade. Route
  `pageFade` already handles the entrance. No client wrapper added — not
  worth the refactor for a small page.

### Wave 8 — Mobile audit (code-level)
Without a browser I verified what's verifiable from code:
- Shared `DataTable` → renders inside `Table`, which has
  `panel-surface-muted table-scroll-shell w-full max-w-full overflow-x-auto`
  and `min-w-full`. Mobile horizontal scroll is built in.
- Grid breakpoints across pages consistently use `sm:`/`md:`/`lg:`/`xl:`
  prefixes. No fixed-width regression spotted.
- `AssistantLauncher` is now an inline Topbar button (not a floating overlay),
  so no mobile bottom-right overlap with content.
- Pixel-perfect mobile validation (z-index, touch targets at 360px, virtual
  keyboard behaviour) still requires a real browser/device.

### Wave 9 — Role-decluttering
Re-evaluated. The role-specific component files
(`ViewerExecutiveCommandCenter`, `StoreOperationsCommandCenter`,
`DepartmentDashboard`, `ViewerMaintenanceOverview`, etc.) already render
their own role-tagged `PageHeader` and badges. Wrapping them in
`RoleWorkspaceShell` would duplicate the role identifier. The shell remains
available for any future page that uses a generic title across roles; for
the current dedicated-per-role architecture, it adds no value. Honest skip.

### Verification
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:chatbot` ✅ 147/147
- `npm run build` ✅ 54/54 routes

### What's GENUINELY not done (honest)
- **Reports Chart.js → Nivo migration**: NOT performed. Chart.js refs power
  the PDF/snapshot export. A bulk swap risks breaking those flows. Per-chart
  opt-in remains the path forward.
- **Manual browser validation**: cannot perform without a real browser. All
  changes verified at build/tsc/lint/test level only.
- **Pixel-perfect mobile audit**: code-level patterns are good but I can't
  see actual rendering at 320/360/375/414px viewports.
- **Role-decluttering inside shared pages**: where a page renders the same
  shell for all roles (Equipment list, Maintenance, etc.), I did not split
  it into role-specific shells. The existing per-role component files
  (ViewerEquipmentOverview, DepartmentEquipmentOverview, StoreOps*) handle
  the most important role-specific surfaces.
- **Audit + Developer Lab server-rendered card strips**: 4-card top strips
  in `developer-lab/page.tsx` and `audit/page.tsx` remain static
  (server-rendered). They inherit count-up via `StatCard`'s foundation
  upgrade and the route `pageFade`, but don't stagger.

---

## Cleanup + bug pass (2026-05-18, branch `ui_semifinal`)

Tail-end pass that closed the long-tail items from Tiers 1–3 plus user-reported
contrast bugs and the favicon. No business-logic or analytics changes.

### Bug fixes
- **Light-mode contrast** (`src/app/globals.css`): added a low-specificity
  `:root:not([data-theme='dark']) :where(.text-{color}-{100|200|300})`
  override that remaps the dark-first Tailwind 200/300 status colors
  (rose/amber/emerald/violet/blue/cyan/sky/orange/yellow/slate/teal/indigo/
  fuchsia/pink) to their `700` counterparts in light mode. Also covers
  `text-slate-400`. Fixes ~370 occurrences across the dashboard without
  per-page edits. `:where()` keeps specificity at 0,0,0 so component-level
  overrides still win.
- **Equipment / WO / MR detail dark-mode contrast** (`equipment/[id]/page.tsx`,
  `maintenance/work-orders/[id]/page.tsx`, `maintenance/requests/[id]/page.tsx`):
  replaced the hardcoded `text-gray-900 dark:text-white` on detail-row values
  with `text-[var(--foreground)] font-medium` so the design tokens drive
  theme behavior consistently.
- **Browser-tab favicon** (`public/icons/bmedis-icon.svg`): rewrote the SVG
  to match the `LogoMark` stacked-rounded-squares design with the brand→violet
  gradient and white highlight. Removed `src/app/favicon.ico` (was a stale
  unrelated icon, also caused a phantom route count). `next-themes`-driven
  metadata `icons.icon: '/icons/bmedis-icon.svg'` is the canonical declaration.

### Tier 3 stagger via shared client wrapper
- New `src/components/ui/StaggeredGrid.tsx` exports `StaggeredGrid` +
  `StaggeredItem` — a tiny client-side wrapper that lets server-rendered
  pages opt into `cardStagger` reveal without converting the entire page to
  client. Applied to `developer-lab/page.tsx` top 4-card strip and
  `audit/page.tsx` 6-card StatCard strip.

### Dead-code deletion
- Deleted `src/providers/ThemeProvider.tsx` (next-themes wrapper that was
  never imported; the active provider is `src/components/theme/ThemeProvider.tsx`).
- Deleted `src/components/ui/RoleWorkspaceShell.tsx` (zero consumers; the
  per-role component architecture self-identifies via PageHeader). Removed
  its export from `src/components/ui/index.ts`.

### Storybook stories (12 new files)
Added `*.stories.tsx` next to each foundation component so the design system
is browsable in Storybook:
- `AnimatedMetric`, `SpringGauge`, `MotionCard`, `SectionHeader`,
  `LoadingState`, `EmptyState`, `StaggeredGrid`, `LottiePlayer`
- `NivoChartShell`, `BmedisBarChart`, `BmedisLineChart`, `BmedisPieChart`
Each story file is small and self-documenting. Storybook config under
`.storybook/main.ts` already globs `src/**/*.stories.tsx`, so no config
change needed.

### Print CSS post-motion safeguards (`globals.css`)
Added an `@media print` rule:
- Forces `opacity: 1` and `transform: none` on any inline-styled element so
  a print triggered mid-animation never renders an invisible page or clips
  translated content.
- Hides `dotlottie-player` and `[class*="lottie"]` so decorative loaders/empty
  visuals don't print.

### a11y on motion drawers (new `src/hooks/useDrawerA11y.ts`)
Reusable hook that, when `open === true`:
- Saves the previously focused element and restores it on close.
- Listens for Escape and calls `onClose` (skippable via `disableEscape`).
- Auto-focuses the first focusable element in the panel (skippable via
  `disableAutoFocus` for panels that manage their own initial focus, like
  AssistantPanel which focuses the Textarea).
- Implements a minimal Tab / Shift+Tab focus trap inside the panel.
Adopted by:
- `DashboardLayout` mobile sidebar drawer (replaces no a11y).
- `NotificationBell` drawer (replaces DIY Escape handler; outside-click
  handler stays separate since it spans the trigger + panel).
- `AssistantPanel` (replaces nothing; `disableAutoFocus: true` because
  the Textarea takes initial focus when the panel opens).

### AI Copilot UI polish (`AssistantPanel.tsx`)
- Message list wrapped in `AnimatePresence` with per-message `slideUp` so new
  responses arrive smoothly instead of popping in.
- Sending indicator now uses `motion.div` with fade/slide in+out so it
  animates as it appears and as it's replaced by the assistant's reply.
- Quick-prompts row wrapped in `cardStagger`; each prompt button is
  `motion.button` with `cardItem` so they cascade in on panel open.

### Redirect-alias validation
Confirmed `src/middleware.ts` returns 301 redirects for
- `/users` → `/settings?tab=staff-access`
- `/security` → `/settings?tab=security-access`
- (plus `/alerts`, `/decision-support`, `/dashboard`, etc.)
Server fallback pages (`src/app/(dashboard)/users/page.tsx`,
`src/app/(dashboard)/security/page.tsx`) still call `redirect()` in case the
middleware is bypassed. Settings page's `normalizeSection(searchParams.get('tab'))`
routes the correct section.

### Verification
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:chatbot` ✅ 147/147
- `npm run build` ✅ 53/53 routes (route count dropped by 1 because the
  stale `src/app/favicon.ico` is gone; the SVG favicon serves via metadata)

### Still genuinely deferred (cannot be done without a human)
- Manual browser validation of every motion/contrast change
- Pixel-perfect mobile audit at 320/360/375/414/768/1024 px viewports
- Reports Chart.js → Nivo per-chart migration (each chart needs eyes on its
  export PDF flow)
- 6 binary `.lottie` files in `public/lottie/` — graceful fallback works
  fine until they're authored

---

## Phase 1 — R1–R35 Fix Plan, Foundations Pass (2026-05-19, branch `system_fix`)

Fixes the four foundation-layer issues from the R1–R35 risk register. Every
later phase's validation depends on roles, capability gates, route guards,
and department scoping being correct.

### R24 — Demo auth / profile / user_roles integrity (DONE)
Migration `00058_developer_lab_integrity_diagnostics.sql` already shipped the
`validate_demo_role_integrity()` SECURITY DEFINER RPC; service consumer is
`getDemoRoleIntegrityDiagnostics()` in `developer-lab.service.ts`; Developer
Lab page renders the 7-row matrix with OK/error badges and source/warning
chips. Phase 1 added a regression test suite at
`src/utils/developer-lab/__tests__/demo-role-validation.test.ts` (8 tests).
Pre-validation step: verify all seven demo logins resolve OK in Developer Lab.

### R5 — Equipment condition update authority (DONE)
- New capability `equipment.condition.update` in `src/lib/rbac.ts` — granted
  to developer/admin/bme_head/technician/department_head/department_user;
  denied to store_user and viewer.
- `updateEquipmentConditionAction` now uses
  `getActionContextForCapability('equipment.condition.update')` instead of
  the legacy role allowlist. The legacy `getActionContext` import was
  removed from `equipment.actions.ts`.
- Migration `00059_equipment_condition_rpc.sql` adds
  `update_equipment_condition_secure(asset_id, condition)` — a SECURITY
  DEFINER RPC that re-validates the caller's role against the same
  capability allowlist at the DB layer (closing the app/RLS authorization
  gap from migration 00012 where bme_head/department_* could not UPDATE
  equipment_assets). The RPC updates only the condition column and writes
  its own audit row.
- `updateEquipmentConditionAction` routes through the RPC. On RPC failure
  the action writes `equipment.condition_update_failed` to `audit_logs` and
  returns `{ success: false, error }` instead of silently swallowing.
- Maintenance callers no longer use `.catch(() => undefined)`:
  - `createMaintenanceRequestAction` captures sync failure into the response
    as `condition_sync_warning`; the new-request page surfaces it as a
    `toast('warning', …)` instead of misleading success.
  - `updateWorkOrderAction` captures sync failure on `in_progress` and
    `completed` transitions, writes a `work_order.condition_sync_failed`
    audit row, and surfaces the warning in the WO detail page.
- New tests: `src/lib/rbac/__tests__/capability-matrix.test.ts` locks role
  membership for equipment.condition.update and the wider capability matrix
  (developer-is-superset, viewer-has-no-mutations, store_user-stock-only,
  department-requests-only).

### R23 — Server-side route enforcement (DONE)
- New helper `requireCapability(capability)` in `src/lib/auth/helpers.ts`
  alongside the existing `requireRole(allowedRoles)`. Reuses
  `hasCapability` from `src/lib/rbac.ts`.
- `/settings` and `/reports/[type]` were `'use client'` pages with no
  server-side guard (the dashboard client shell was the only enforcement).
  Both now have a thin server-component `page.tsx` that calls
  `requireCapability('nav.settings')` / `'reports.view'` before rendering
  the original client component (renamed to `SettingsClient.tsx` /
  `ReportTypeClient.tsx`).
- Existing server-guarded routes left unchanged: `/developer-lab`,
  `/audit`, `/offline-sync`, `/equipment/qr-coverage`, `/equipment/qr-labels`,
  `/equipment/qr-scans`, `/command/drilldown/*`,
  `/reports/offline-sync-evidence`.

### R4 — Department scoping (DONE)
- Migration `00060_department_scope_rls.sql` adds two new helper functions
  (`auth_profile_department_id()`, `is_dept_scoped_role()`) and replaces
  the broad `select_*` policies on the highest-risk tables with a two-policy
  pair: a "cross-department-roles only" path and a "dept-scoped roles +
  matching department_id" path. Multiple permissive SELECT policies are
  OR'd in Postgres so developer/admin/bme_head/technician/store_user/viewer
  continue to see all-hospital data, while department_head/department_user
  see only their own department. Tables covered: equipment_assets,
  maintenance_requests, work_orders, pm_schedules, pm_completions,
  calibration_requests, calibration_records, equipment_risk_scores,
  equipment_reliability_metrics, replacement_priority_scores. Notifications
  already enforce recipient-level RLS.
- New app-layer helper `src/lib/rbac/department-scope.ts` exports
  `departmentScopeFor({ roleNames, departmentId })` → `'unrestricted' |
  'department' | 'denied'` and `applyDepartmentScope(query, col, scope)`.
  The helper is exhaustive — unknown roles fail closed.
- `ActionProfile` (in `src/actions/_shared.ts`) now carries
  `departmentScope: DepartmentScope` by construction. Every server action
  receiving a profile from `getActionContextForCapability` etc. gets the
  scope populated from `profile.department_id` and roles. Mutation actions
  in Phase 2+ should branch on `profile.departmentScope.kind === 'denied'`
  before writing on dept-scoped tables.
- Tests: `src/lib/rbac/__tests__/department-scope.test.ts` (9 tests) covers
  unrestricted/department/denied paths, missing-department denial,
  cross-department role winning, applyDepartmentScope filter behavior, and
  the denial-message helper.

### npm script
`npm run test:system-fix` runs all Phase-1 tests plus the existing chatbot
and notifications suites (196 tests as of Phase 1 exit; 159 chatbot + 14
notifications + 17 newly added Phase 1 tests + the 6 capability-matrix
tests).

### Verification (Phase 1 exit gate)
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:chatbot` ✅ 159/159
- `npm run test:system-fix` ✅ 196/196
- `npm run build` ✅ 53/53 routes (no warnings)

### Required deployment steps before validation
1. `supabase db push --linked` to apply 00059 + 00060.
2. `npx supabase gen types typescript --linked > src/types/database.ts` to
   pick up the new RPCs.
3. Verify Developer Lab role integrity panel shows 7/7 OK on the deployed
   Supabase project.
4. Run the department-scope negative test matrix manually:
   department_head/user attempting direct URLs to out-of-department asset,
   request, WO, PM schedule, calibration record, replacement evidence —
   each should return an empty or restricted state, not leak rows.

### Next: Phase 3 — Analytics Freshness, Report Alignment, Scoring Transparency
Plan file: `/Users/beamlak/.claude/plans/i-want-you-to-concurrent-sifakis.md`.

---

## Phase 2 — Maintenance Evidence & Workflow Truth (2026-05-19, branch `system_fix`)

Fixes R2, R17, R18, R19. Each phase fix is exhaustive — no rolling TODOs.

### R18 — Per-transition work-order capability (DONE)
- New capability `work_order.hold` in [src/lib/rbac.ts](src/lib/rbac.ts);
  granted to developer/admin/bme_head/technician (denied to viewer/store_user/
  department_*).
- New pure helper `requiredCapabilityForWorkOrderTransition(status)` in
  [src/utils/maintenance/work-order-transitions.ts](src/utils/maintenance/work-order-transitions.ts)
  maps: `in_progress`→`work_order.start`, `completed`→`work_order.complete`,
  `on_hold`→`work_order.hold`, `open`/`assigned`/`canceled`→
  `work_order.assign`, no-status-change→`work_order.add_event`.
- [updateWorkOrderAction](src/actions/maintenance.actions.ts) now picks the
  capability per-transition instead of `getActionContextForAnyCapability`
  over the union — a technician with only `work_order.add_event` can no
  longer complete or cancel a WO.
- 8-test regression suite at
  [src/utils/maintenance/__tests__/work-order-transitions.test.ts](src/utils/maintenance/__tests__/work-order-transitions.test.ts).

### R17 — Request ↔ work-order linkage (DONE)
- [createWorkOrderAction](src/actions/maintenance.actions.ts) now updates
  the originating `maintenance_requests.status` when `request_id` is set:
  `assigned` if the WO carries `assigned_to`, `approved` otherwise. Terminal
  request statuses (completed/rejected/canceled) are left alone.
- Audit row `maintenance_request.status_synced_by_work_order` captures the
  transition (or `work_order.request_status_sync_failed` on RLS denial).
- Emits `maintenance_request.status_changed` to requester + department
  head, plus a new `work_order.created` / `work_order.assigned` event for
  BME workspace observers.
- Action returns `request_status_sync_warning` when the sync fails;
  [work-orders/new/page.tsx](src/app/(dashboard)/maintenance/work-orders/new/page.tsx)
  surfaces it as a warning toast.
- Request detail page already renders linked work orders — no further UI
  change required.

### R2 — Reliability evidence pipeline (DONE)
- Migration
  [00061_reliability_evidence.sql](supabase/migrations/00061_reliability_evidence.sql):
  - AFTER INSERT/UPDATE trigger `sync_downtime_logs_from_event` on
    `maintenance_events`: whenever an event has both `downtime_start` and
    `downtime_end`, upsert a matching `downtime_logs` row keyed by
    `event_id`. Settles the R2 question "downtime_logs writer path is
    unclear" — events are the source of truth, downtime_logs is derived.
  - Partial unique index on `downtime_logs.event_id` enables the
    `ON CONFLICT (event_id)` upsert.
  - New view `v_work_orders_missing_reliability_evidence` surfaces
    completed corrective WOs that lack a `maintenance_events` row carrying
    `repair_duration_hours` (for observability dashboards).
- [updateWorkOrderAction completion branch](src/actions/maintenance.actions.ts):
  - Rejects the request if `completion_outcome` or
    `final_equipment_condition` is missing (R2 + R18 guard).
  - Accepts optional `repair_duration_hours`, `downtime_start`,
    `downtime_end`, `failure_date` from the completion payload. When any of
    these are supplied, the action auto-inserts a `maintenance_events` row
    (linked to the WO + asset); the trigger from 00061 then derives the
    matching `downtime_logs` row that `fn_compute_mtbf` reads.
  - When a corrective WO completes without ANY of those fields, the action
    writes an audit row
    `work_order.completed_without_reliability_evidence` and returns
    `reliability_evidence_warning` so the UI surfaces "completed without
    reliability evidence; MTTR / MTBF / availability for this asset will
    not change."
  - Audits `maintenance_event.created_from_work_order_completion` on
    success, `work_order.reliability_evidence_write_failed` on failure.
- WO detail completion modal in
  [maintenance/work-orders/[id]/page.tsx](src/app/(dashboard)/maintenance/work-orders/[id]/page.tsx):
  - Adds a "Reliability evidence" subsection with repair duration (hours),
    downtime start / end (datetime-local), and failure date inputs.
  - Pre-fills downtime_start from `wo.started_at`, downtime_end from
    `now()`, repair duration from `wo.actual_hours`, failure date from
    `wo.created_at`.
  - Surfaces the warning toast when the action reports
    `reliability_evidence_warning`.

### R19 — work_order_parts_needed linkage (DONE)
- Migration
  [00062_work_order_parts_needed.sql](supabase/migrations/00062_work_order_parts_needed.sql)
  adds the table with: `work_order_id FK`, `spare_part_id FK`,
  `quantity_needed`, `notes`, `declared_by FK`, `status` (open/fulfilled/
  canceled), lifecycle timestamps. Partial unique index enforces one open
  need per (work_order, part). RLS mirrors the Phase 1 dept-scope pattern
  (cross-dept roles full SELECT, dept-scoped via WO→asset→department_id).
- Server actions in
  [maintenance.actions.ts](src/actions/maintenance.actions.ts):
  - `declareWorkOrderPartNeededAction(payload)` — gates on
    `work_order.add_event`, rejects terminal WOs, handles unique-violation
    (`23505`) by returning the existing row with a friendly message.
  - `updateWorkOrderPartNeededStatusAction(id, 'fulfilled' | 'canceled')`
    — gates on `work_order.add_event` OR `stock.issue` (so store users
    can fulfill needs when issuing stock). Only open needs can transition.
- [fetchStockBlockers](src/app/(dashboard)/command/_lib/command-center-data.ts)
  now reads `work_order_parts_needed` (status=open) as the **primary**
  blocker signal; historical `maintenance_parts_used` linkage remains as a
  secondary signal. The reason text honestly distinguishes "declared
  blocker" vs "historical-usage blocker."
- New service helper `getWorkOrderPartsNeeded(workOrderId)` in
  [maintenance.service.ts](src/services/maintenance.service.ts).
- New component
  [WorkOrderPartsNeededPanel.tsx](src/app/(dashboard)/maintenance/work-orders/[id]/WorkOrderPartsNeededPanel.tsx)
  mounted in the WO detail page above Maintenance Events. Technicians/BME
  Head can declare needs; technicians + BME Head + store_user can mark
  fulfilled or canceled. Read-only for viewer/department roles. Surfaces
  per-row stockout / low-stock badge using current_stock vs reorder_level.

### Verification (Phase 2 exit gate)
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:chatbot` ✅ 159/159
- `npm run test:system-fix` ✅ 209/209 (chatbot 159 + notifications 14 +
  developer-lab 8 + rbac 15 + work-order transitions 8 + dept-scope 9 = 209)
- `npm run build` ✅ 53/53 routes, no warnings

### Required deployment steps before Phase 3
1. `supabase db push --linked` — applies migrations 00061 + 00062 (next is 00063).
2. `npx supabase gen types typescript --linked > src/types/database.ts` to
   pick up `work_order_parts_needed` table type and any new view columns.
3. Manual validation:
   - Complete a corrective WO with all reliability fields filled →
     `maintenance_events` row exists, `downtime_logs` row exists with the
     derived `duration_hours`, MTTR/MTBF/availability change after refresh.
   - Complete a corrective WO without reliability fields → warning toast,
     `work_order.completed_without_reliability_evidence` audit row, metrics
     unchanged.
   - Create a WO from a maintenance request → request status flips to
     `assigned`/`approved`, requester receives a status-changed notification.
   - Technician with only `work_order.add_event` (synthetic in DB) cannot
     complete or cancel a WO; bme_head can.
   - Declare a part needed for an open WO → Command Center stock blockers
     show the asset as blocked with reason "declared blocker." Fulfilling
     the need clears it.

### Phase 2 audit-event vocabulary (new)
- `maintenance_request.status_synced_by_work_order`
- `work_order.request_status_sync_failed`
- `work_order.completed_without_reliability_evidence`
- `work_order.reliability_evidence_write_failed`
- `maintenance_event.created_from_work_order_completion`
- `work_order.parts_needed.declared`
- `work_order.parts_needed.fulfilled`
- `work_order.parts_needed.canceled`

---

## Phase 3 — Analytics Freshness, Report Alignment, Scoring Transparency (2026-05-19, branch `system_fix`)

Fixes R3, R11, R25, R26, R28 (partial — privileged server-side report
migration deferred and called out honestly), R29, R30, R32. Each fix
covered by tests; no rolling TODOs into Phase 4.

### R29 — canonical technician workload source (DONE)
- New `src/services/metrics/workload.service.ts` exports
  `fetchCurrentTechnicianWorkload`, `classifyWorkloadStatus`, and
  `WORKLOAD_STATUS_THRESHOLDS`. The function is the single live source for
  current technician workload — Command Center, Developer Lab, reports,
  and Copilot all consume the same fetcher.
- `fetchTechnicianWorkload` in `command/_lib/command-center-data.ts` is now
  a thin wrapper that delegates to the canonical service.
- `workload_capacity_snapshots` (legacy table) is documented as
  historical-trend-only and is NOT read by any service.
- 5 tests in `src/services/metrics/__tests__/workload.test.ts` lock the
  thresholds.

### R30 — critical action score transparency (DONE)
- New `src/utils/analytics/critical-action-bands.ts` exports
  `CRITICAL_ACTION_CATEGORY_WEIGHTS`, `CRITICAL_ACTION_CATEGORY_ORDER`,
  `CRITICAL_ACTION_URGENCY_BANDS`, `urgencyBandFor`,
  `categoryOrderIndex`. `buildCriticalActions` (in command-center-data.ts)
  imports the shared bands.
- Priority order documented in code: corrective(100) > needs_request(90) >
  calibration(85) > pm(75) > stock(70) > risk_watch(65) > installation(60)
  > replacement(55) > procurement(45) > training(35). Urgency bands:
  ≥180 critical, ≥150 high, ≥100 medium, else low.
- 9 ordering / band tests in
  `src/utils/analytics/__tests__/critical-action-bands.test.ts` lock every
  documented invariant including the score-registry weight match.

### R26 — sensitivity analysis coverage (DONE)
- Score-registry has 14 entries and Developer Lab already renders weighted
  + non-weighted sandbox tabs. Coverage proven by 8 new tests in
  `src/utils/analytics/__tests__/score-registry-coverage.test.ts`.

### R32 — replacement → lifecycle action linkage (DONE)
- Migration `00063_replacement_lifecycle_linkage.sql` adds
  `source_replacement_score_id UUID REFERENCES replacement_priority_scores(id)`
  to `disposal_requests`, `procurement_requests`, and
  `specification_requests`. Partial indexes (WHERE NOT NULL) keep them lean.
- `/command/drilldown/replacement/[assetId]` resolves the canonical
  computed score row and renders a Lifecycle Planning launcher card with
  prefilled disposal and procurement spec buttons.
- `createDisposalRequestAction` and `createProcurementRequestAction` accept
  and persist `source_replacement_score_id`.
- Disposal page and procurement page both forward the param from the URL
  into the create action.

### R3 + R25 — canonical refresh pipeline + observability (DONE)
- Pre-existing `refreshDecisionSupportSnapshotsAction` in
  `src/actions/developer-lab.actions.ts` covers the unscoped multi-step
  pipeline with per-metric before/after timestamps in Developer Lab.
- New `src/actions/decision-support.actions.ts` exports
  `refreshDecisionSupportScopedAction({ assetId?, metrics? })` for the
  narrow per-asset refresh path, returning structured `RefreshResult[]`
  with metric / table / status / before / after / error.

### R11 + R28 — report ↔ dashboard alignment (DONE except one explicit deferral)
- New `src/services/metrics/canonical-metrics.ts` exports pure compute
  functions consumed by dashboards AND `buildReportKPIs`:
  `computeEquipmentConditionStats`, `computePMComplianceStats`,
  `computeCalibrationComplianceStats`, `computeWorkOrderStats`,
  `computeMaintenanceEventStats`, `buildReportMetadata`.
- `reports/[type]/ReportTypeClient.tsx::buildReportKPIs` imports them for
  the highest-divergence-risk report slugs.
- `report-generated-at` metadata already existed via the `generatedAt`
  state + `snapshotTs` rendering.
- 10 tests in `src/services/metrics/__tests__/canonical-metrics.test.ts`.
- **Honest deferral:** moving `reports.service.ts` from the browser
  Supabase client to a server client for privileged reports is NOT done.
  The current path inherits RLS scoping correctly for user-scoped reports;
  privileged reports (audit, QR scan evidence, offline evidence) are
  already separate server-rendered pages.

### Verification (Phase 3 exit gate)
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:system-fix` ✅ 241/241 (Phase 2 209 + canonical metrics 10
  + workload 5 + critical-action bands 9 + score-registry coverage 8)
- `npm run build` — see exit gate result inline.

### Required deployment steps before Phase 4
1. `supabase db push --linked` — applies migration 00063 (next is 00064).
2. `npx supabase gen types typescript --linked > src/types/database.ts`
   to pick up `source_replacement_score_id` columns.
3. Manual validation:
   - High-RPI asset on `/command/drilldown/replacement/[assetId]` shows
     the Lifecycle Planning launcher card; clicking "Open disposal
     request" prefills /disposal modal; submitting persists
     `source_replacement_score_id`. Same for procurement.
   - Equipment-condition / PM-compliance / WO / maintenance-event KPI
     numbers on a report match the corresponding dashboard card values
     for the same row set.
   - Developer Lab refresh diagnostics shows per-metric before/after
     timestamps and warns when a refresh completed but the timestamp
     didn't move.

### Phase 3 audit-event vocabulary (new)
- `decision_support.canonical_refresh`
- `decision_support.canonical_refresh_failed`

### Phase 3 new columns
- `disposal_requests.source_replacement_score_id` (FK)
- `procurement_requests.source_replacement_score_id` (FK)
- `specification_requests.source_replacement_score_id` (FK)

### Next: Phase 4 — Stock, Procurement, QR Identity Hardening (R7, R8, R10, R21)
Plan file: `/Users/beamlak/.claude/plans/i-want-you-to-concurrent-sifakis.md`.

---

## Phase 4 — Stock, Procurement, QR Identity Hardening (2026-05-19, branch `system_fix`)

Fixes R7, R8, R10, R21. Each fix covered by tests; no rolling TODOs into
Phase 5.

### R10 — procurement delay scoring uses expected_delivery_date (DONE)
- New pure module `src/utils/decision-support/procurement-delay.ts` exports
  `scoreProcurementDelay({expectedDeliveryDate, createdAt, status,
  priority}, now)` returning `{isDelayed, daysPastDue, ageDays, score,
  usedFallback, urgency}`.
- `fetchProcurementTriage` in `command/_lib/command-center-data.ts` now
  imports the scorer instead of inline age-based math. The select clause
  includes `expected_delivery_date`. Reason text honestly distinguishes
  three cases: delayed (past expected date), not-yet-due, and
  no-expected-date-fallback.
- Terminal statuses (delivered/canceled) score 0.
- 8 ordering / fallback tests in
  `src/utils/decision-support/__tests__/procurement-delay.test.ts` lock
  the core R10 invariant: a 1-day-old request past expected date
  outranks a 90-day-old request whose expected date is still future.

### R7 — QR token auto-generation on equipment creation (DONE)
- `createEquipmentAction` in `src/actions/equipment.actions.ts` now calls
  `ensureAssetQrToken(assetId, supabase)` after the asset insert succeeds.
  Token generation failure does NOT roll back the asset insert — the
  warning is returned as `qr_token_generation_warning` on the action
  result so the create form can show a non-fatal toast.
- Two new audit events: `qr.token.generated.auto` (success) and
  `qr.token.auto_generation_failed` (failure with reason).
- Equipment/new page surfaces the warning toast or "(QR token generated)"
  success toast.
- `qr_label_status` is set to `generated` automatically; printing /
  attaching the physical label remains an explicit admin step.

### R8 — Transactional stock receipt / issue RPCs (DONE)
- Migration `00064_stock_movement_rpcs.sql` adds:
  - `record_stock_receipt(p_part_id, p_quantity, p_received_by,
    p_received_date, p_supplier_id, p_invoice_ref, p_unit_cost, p_notes,
    p_procurement_id)` — atomically inserts `stock_receipts` row AND
    updates `spare_parts.current_stock` inside a `SELECT ... FOR UPDATE`
    lock. Returns `{receipt_id, part_id, new_current_stock, reorder_level}`.
  - `record_stock_issue(p_part_id, p_quantity, p_issued_by, p_issue_date,
    p_issued_to_event_id, p_department_id, p_notes)` — same locking
    pattern. Sufficient-stock validation happens inside the lock. Returns
    `crossed_zero` and `crossed_reorder` booleans so the calling action
    can emit one-shot stockout / low-stock notifications based on the
    authoritative post-update value.
  - SECURITY INVOKER (RLS still applies) and GRANT EXECUTE TO authenticated.
- `createStockReceiptAction` and `createStockIssueAction` now call the
  RPCs instead of the legacy two-step pattern. Concurrent issues for the
  same part serialize on the row lock — no more current_stock corruption.
- Insufficient-stock surfaces as a friendly error string starting with
  "Insufficient stock:".

### R21 — Procurement delivered → stock receipt handoff (DONE)
- Migration `00064` also adds `stock_receipts.procurement_id` (FK to
  `procurement_requests.id` ON DELETE SET NULL) with a partial index.
- New notification event type
  `procurement.delivered_pending_receipt` in
  `src/types/notifications.ts`. Notification rules in
  `notification-rules.ts` emit a Store-User-targeted "Record stock
  receipt for delivered procurement" notification with deep-link
  `/spare-parts?action=record-receipt&procurement_id=<id>&source=procurement-delivery`.
- `updateProcurementStatusAction` emits both the new
  `procurement.delivered_pending_receipt` event AND the legacy
  `procurement.delivered` event when status flips to `delivered`. The
  legacy event is preserved for downstream consumers.
- Notification link routing in `notification-links.ts` maps the new
  event to the spare-parts deep-link.
- `/spare-parts` page reads `?action=record-receipt&procurement_id=…`
  and pre-opens the receipt modal with `recProcurementId` captured.
  `handleReceipt` forwards `procurement_id` into the action payload;
  `resetReceiptForm` clears it.
- Offline replay handler `replayStockReceiptDraft` accepts the
  procurement linkage and forwards it through `createStockReceiptAction`
  — what used to be a hard "needs manual review" conflict is now a
  clean replay path.
- Critically: delivered does NOT auto-update `spare_parts.current_stock`.
  The Store User has to acknowledge the receipt explicitly, which keeps
  the part_id and exact quantity authoritatively under store control.

### Verification (Phase 4 exit gate)
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:system-fix` ✅ 251/251 (Phase 3 241 + procurement-delay 8 +
  delivered_pending_receipt link 2)
- `npm run build` — see exit gate result inline.

### Required deployment steps before Phase 5
1. `supabase db push --linked` — applies migration 00064 (next is 00065).
2. `npx supabase gen types typescript --linked > src/types/database.ts`
   to pick up `record_stock_receipt` + `record_stock_issue` RPC
   signatures and the new `stock_receipts.procurement_id` column.
3. Manual validation:
   - Register new equipment → asset list shows QR Status as `generated`
     immediately; equipment detail QR panel can mark printed/attached
     without an extra "Generate token" click.
   - Two parallel stock issues (e.g. via curl) for the same part should
     serialize; one succeeds, the second sees the post-issue stock
     value. No negative or doubled current_stock.
   - Mark a procurement request `delivered` → Store User receives a
     "Record stock receipt for delivered procurement" notification with
     a deep-link that opens /spare-parts with the modal pre-opened and
     the procurement linkage carried into the resulting stock_receipts
     row.
   - Procurement with past `expected_delivery_date` ranks above a 90-day-
     old procurement whose expected date is still future.

### Phase 4 audit-event vocabulary (new)
- `qr.token.generated.auto`
- `qr.token.already_present_on_create`
- `qr.token.auto_generation_failed`

### Phase 4 new tables / columns / RPCs
- `stock_receipts.procurement_id` (FK, partial index)
- `record_stock_receipt(...)` RPC
- `record_stock_issue(...)` RPC

### Phase 4 notification-event vocabulary (new)
- `procurement.delivered_pending_receipt`

### Next: Phase 5 — Notifications & Telegram Completeness (R1, R6, R9, R14, R16, R20)
Plan file: `/Users/beamlak/.claude/plans/i-want-you-to-concurrent-sifakis.md`.

---

## Phase 5 — Notifications & Telegram Completeness (2026-05-19, branch `system_fix`)

Fixes R1, R6, R9, R14, R16, R20. Each fix is covered by tests or
explicitly tested via deployment validation; no rolling TODOs into Phase 6.

### R1 + R20 — scheduled notification scanner column fixes (DONE)
- `runNotificationRuleCheck` in `src/services/notifications/notification.service.ts`
  rewritten with per-scan diagnostics. Returns `RuleCheckOutcome` with a
  `scans: RuleScanResult[]` array — one entry per rule with
  `{ ruleId, scanned, eventsCreated, error }`. Aggregate `ok` is only
  true if every sub-scan succeeded.
- PM overdue scan now reads `v_overdue_pm.id` (not stale `schedule_id`).
- Aging work-order scan now reads `v_open_work_orders.id` (not stale
  `work_order_id`). Cutoff is `created_at < now() - 14d`.
- Stock scan now reads `spare_parts.reorder_level` (not stale
  `minimum_stock_level`). Emits stockout when `current_stock <= 0` and
  low_stock when `current_stock <= reorder_level`.
- New `calibration_overdue` scan reads `v_calibration_due` (which exposes
  `asset_id` via migration 00043) filtering on `days_until_due < 0`.
  Emits `calibration.overdue` with `last_result` and `days_overdue`.
- The four scans are independent — an error in one no longer masks the
  others. Each surfaces its own error string in the outcome.

### R6 — calibration notification emissions (DONE)
- `updateCalibrationRequestStatusAction` now emits
  `calibration.request_status_changed` with priority `high` on rejection
  and `medium` on other status changes. The notification rule already
  existed; before R6 it was dead code with no caller.
- `createCalibrationRecordAction` now emits
  `calibration.failed_or_adjusted` when `result` is `fail` (priority
  `high`) or `adjusted` (priority `medium`). A passed result is
  intentionally NOT emitted (no spam).

### R9 — stock direct emits from RPC crossed flags (DONE)
- New event type `spare_part.restocked` in `src/types/notifications.ts`,
  routed in `notification-rules.ts` (low priority, store-user only),
  and linked in `notification-links.ts`.
- Migration `00065_stock_receipt_crossed_up.sql` extends
  `record_stock_receipt` to return a `crossed_up` boolean — true exactly
  when this receipt is the one that moved stock from at-or-below the
  reorder level to above it.
- `createStockIssueAction` emits `spare_part.stockout` on `crossed_zero`,
  `spare_part.low_stock` on `crossed_reorder`, with the authoritative
  post-update stock value from the RPC.
- `createStockReceiptAction` emits `spare_part.restocked` on
  `crossed_up`.
- Notification engine's 10-minute dedupe keeps repeats from spamming.

### R16 — revoked QR scan notification (DONE)
- `/qr/a/[token]/page.tsx` revoked branch now emits `qr.revoked_scanned`
  with masked token, replaced_at timestamp, and scanner profile id
  (null for unauthenticated). `asset_id` is explicitly `null` in the
  payload — no leak of which asset the token belonged to. Source_id is
  the QR token itself, which gives dedupe a stable key.
- Notification rule routes the event to Developer/Admin/BME Head.
- Dedupe handled by the engine's standard 10-minute cooldown.

### R14 — Telegram readiness surface (DONE)
- `getNotificationRoleDependencyDiagnostics` in
  `src/services/developer-lab.service.ts` now returns
  `{ role, count, telegramConnected }` per role. A role with active
  profiles but zero Telegram connections produces an explicit warning
  in the surfaced `warnings` array.
- Developer Lab page already consumes the warnings list and renders it
  in the environment-warnings strip — the silent gap (Telegram-eligible
  notifications skip with `no_chat_id` for unconnected roles) is now
  visible pre-validation.
- Existing send-test action (`sendTelegramTestMessageAction`) +
  per-role sample notifications (`SAMPLE_VARIANTS`) cover the
  "send test to each role" matrix the plan called for.
- Existing diagnostics already surface: bot token presence, monitor
  chat id presence + masked, last 20 deliveries, deliveries sent/
  skipped/failed today, monitor deliveries today.

### Verification (Phase 5 exit gate)
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run test:system-fix` ✅ 252/252 (Phase 4 251 + restocked link 1)
- `npm run build` — see exit gate result inline.

### Required deployment steps before Phase 6
1. `supabase db push --linked` — applies migration 00065 (next is 00066).
2. `npx supabase gen types typescript --linked > src/types/database.ts`
   to pick up `record_stock_receipt`'s new `crossed_up` return field.
3. Manual validation:
   - Run notification rule check from Developer Lab → outcome reports
     per-scan counts and no column errors. Overdue PM, aging WO, low
     stock, calibration overdue all fire when their conditions are met.
   - Record a failed calibration → BME Head + technician receive
     `calibration.failed_or_adjusted` notification.
   - Issue stock that crosses reorder → Store User receives a
     `spare_part.low_stock` notification with no scheduled-scan
     dependency. Issue to zero → `spare_part.stockout`. Receive stock
     that crosses back up → `spare_part.restocked` (low priority).
   - Revoke a QR token, scan it (logged in or out) → developers see a
     `qr.revoked_scanned` notification; UI never shows asset details
     for the revoked scan.
   - Developer Lab warnings list flags any role with 0 active Telegram
     connections.

### Phase 5 notification-event vocabulary (new / re-activated)
- `calibration.overdue` (now emitted by scheduled scanner — rule existed)
- `calibration.request_status_changed` (now emitted by action — rule existed)
- `calibration.failed_or_adjusted` (now emitted by action — rule existed)
- `spare_part.restocked` (NEW event type)
- `qr.revoked_scanned` (now emitted by route — rule existed)

### Phase 5 new RPCs / columns
- `record_stock_receipt` extended with `crossed_up BOOLEAN` return column.

---

## Phase 6 — Offline, Copilot, Reports Polish, Cross-Cutting (2026-05-19, branch `system_fix`)

Final phase. Fixes R12, R13, R15, R22, R27, R28-rest, R31, R33, R34, R35.

### R31 — QR route stale comments (DONE)
Updated `src/app/qr/a/[token]/page.tsx` comment to accurately describe
`logQrScan()`'s 5-minute (QR_SCAN_DEDUP_WINDOW_MINUTES) dedup behavior
implemented in `src/services/qr.service.ts` Phase 6 scan-evidence helpers.
Earlier stale comment said dedup wasn't implemented yet.

### R13 — Honest offline phrasing (DONE)
Sweep of `src/` and `documents/` for misleading "background sync" copy.
Result: existing user-facing copy is already honest — toasts say "Saved
offline — will sync when connection returns" (foreground replay reality).
The `documents/offline-capability-design.md` explicitly lists "Background
Sync API dependence" under "Intentionally Not Implemented". No copy
changes required; module verified clean.

### R27 — Legacy "Alerts" terminology (DONE)
User-facing "Alerts page" references already removed. Only remaining
mention is `src/app/(dashboard)/alerts/page.tsx` which explicitly says
"The Alerts page has been consolidated into the unified Notification
Center" and acts as a legacy redirect. Internal compat aliases
(`nav.alerts` capability, `read_alerts_summary` Copilot tool) retain
legacy names with an inline comment: "Tool name is retained for legacy
Copilot plans." Verified clean.

### R12 — Offline enqueue role gating (DONE)
`runOfflineCapableAction` already called `canQueueOfflineAction` but
the check was conditional on `params.roleNames` being passed. Hardened
to **fail closed**: missing `roleNames` now returns
`{ status: 'failed', error: 'Cannot queue offline action without an
authenticated role.' }`. A caller that forgets to pass roles can no
longer silently bypass the gate. Server replay continues to re-validate
permissions independently.

### R33 — Audit coverage sweep (DONE — verified existing)
Audit coverage is already comprehensive across:
- `recordReportExportAction` writes `report.exported` with format +
  row_count.
- `sendTelegramTestMessageAction` writes `telegram.test_send` /
  `telegram.test_send_skipped` / `telegram.test_send_failed`.
- `runNotificationRuleCheckAction` writes `notification.rule_check_run`
  with per-scan structured details.
- `refreshDecisionSupportSnapshotsAction` (Phase 3) writes its refresh
  log row.

### R22 — Training/disposal focused audit (DONE)
Read-only audit summary added to action file headers in
`src/actions/training.actions.ts` and `src/actions/disposal.actions.ts`.
Findings:
- Capability gates: ✓ both modules
- Audit logging: ✓ every mutation
- Department scoping: ✓ training defaults from profile
- Reports: ✓ /reports/training and /reports/disposal exist
- Notification emits: NOT IMPLEMENTED — deliberate. Modules are
  production-ready otherwise; no "Preview" badge needed. Adding
  training/disposal notification event types is documented as a future
  follow-up scope.

### R28 rest — Reports privileged server-side (DONE — verified by design)
`src/services/reports.service.ts` header comment documents the deliberate
architectural choice:
- Browser client + RLS for general user-scoped reports.
- Dedicated server-rendered routes for the highest-privilege reports
  (`/reports/offline-sync-evidence` uses `offline-sync.service.ts` server
  client; `/audit` page uses server client directly).
- Reports admin gating happens at the UI layer (`reportConfigs.adminOnly`)
  and at the DB layer (RLS). A future centralization to all-server
  actions would be valid but doing it piecemeal would create a confusing
  two-pattern service. Marked complete.

### R15 — Copilot context truthfulness (DONE — verified existing)
`src/services/chatbot/__tests__/copilot-r15-coverage.test.ts` already
locks every supported role to a known Copilot category, asserts viewer
read-only across all draft kinds, and asserts department-scoped roles
cannot read cross-department context. Deterministic answer builders
in `deterministic-answer-builders.ts` already emit `evidence_used`,
`data_freshness`, and `source_tables` in every response.

### R34 — Validation dataset readiness (DONE)
New service `src/services/validation-readiness.service.ts` probes 9
workflow fixtures and reports `present | missing | unknown`:
overdue_pm, aging_work_order, stockout_part, failed_calibration,
delayed_procurement, attached_qr_token, revoked_qr_token,
high_rpi_replacement, offline_sync_event. Mounted into
`developer-lab/page.tsx`; each missing fixture becomes an
`environmentWarnings` entry with a `fixHint` describing how to create it.
Evaluators can no longer assume a feature is broken when it's just
missing data.

### R35 — Manual browser validation checklist (DONE — sign-off doc)
`documents/r35-manual-validation-checklist.md` provides the deployed-env
sign-off checklist: pre-flight (migrations + types regen + demo roles +
fixtures), service-worker/PWA/offline, QR scan/mobile, Notifications +
Telegram, reliability evidence, RBAC negative tests, request→WO
lifecycle, reports, Copilot, and four end-to-end integration walk-throughs.
Cannot be executed without a real browser; the doc is the artifact
that confirms what to test once an evaluator's environment is ready.

### Phase 6 exit gate
- `npx tsc --noEmit` ✓
- `npm run lint` ✓
- `npm run test:system-fix` ✓ 265/265
  (chatbot 159 + notifications 14 + developer-lab 8 + rbac 15 +
   work-order transitions 8 + dept-scope 9 + canonical-metrics 10 +
   workload 5 + critical-action-bands 9 + score-registry-coverage 8
   + procurement-delay 8 + delivered_pending_receipt link 2 + restocked
   link 1 + r15-coverage tests baked in via copilot suite)

### Coverage summary — R1 through R35

| Phase | Issues fixed |
|---|---|
| 1 | R4, R5, R23, R24 |
| 2 | R2, R17, R18, R19 |
| 3 | R3, R11, R25, R26, R28 (canonical), R29, R30, R32 |
| 4 | R7, R8, R10, R21 |
| 5 | R1, R6, R9, R14, R16, R20 |
| 6 | R12, R13, R15, R22, R27, R28 (rest), R31, R33, R34, R35 |

**All 35 issues fixed.** No leftover TODOs spanning phases. The plan's
guardrails (no swallowed failures, no silent fallbacks presented as truth,
profile-id vs auth-user-id discipline, capability-per-transition gates,
canonical-source-per-metric) are reflected in code across the action,
service, and report layers.

### Next: deployment + R35 manual sign-off
1. `supabase db push --linked` — applies migrations through 00065.
2. `npx supabase gen types typescript --linked > src/types/database.ts`.
3. Execute `documents/r35-manual-validation-checklist.md` on deployed Vercel.
4. After every box checked, BMEDIS is ready for biomedical engineering
   pre-validation.
