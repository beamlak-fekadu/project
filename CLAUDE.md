# CLAUDE.md — BMERMS Project Intelligence

Last updated: 2026-05-16 (Offline Capability — Phase 3 Completion: cached views + migration 00046)
Branch: Offline
Deployment: https://project-git-bmermsv3-beamlak-fekadus-projects.vercel.app
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

BMERMS (Biomedical Engineering Resource Management System) is a hospital-level medical
equipment asset management and decision-support system built for Menelik II Hospital,
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
  - `/calendar` is a fully internal BMERMS calendar, not Google Calendar integration. No Google OAuth, external sync, or external event creation is implemented.
  - Calendar events are normalized from BMERMS operational source tables: PM schedules, calibration records/requests, work orders, maintenance requests, training sessions/requests, installation requests/records, procurement requests, disposal requests/disposed assets, and dated specification requests where rows expose real dates.
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
  - Export CSV now includes 4 metadata header rows (Report, Institution, Snapshot Generated, Source) before data headers. Filename pattern: bmerms-[slug]-snapshot-YYYY-MM-DD-HH-mm.csv.
  - Export PDF (jsPDF — real PDF download) includes snapshot timestamp in header. Filename: bmerms-[slug]-snapshot-YYYY-MM-DD-HH-mm.pdf.
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
  - No DB migration added. Next migration must still be 00046.
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
  - No DB migration in Phase 3. Next migration must still be 00046.
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
    redesign, new migration. Next migration remains 00046.

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
  /alerts                     Command Center-style operational alert inbox with source actions and acknowledgement
  /chatbot                    BMERMS AI Copilot (all roles)
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
  /helpdesk                    → /requests
  /users                       → /settings?tab=staff-access
  /security                    → /settings?tab=security-access
  /command/health              → /developer-lab
  /decision-support-health     → /developer-lab

---

## Known deferred issues

0.  Final system-page architecture after 2026-05-10 polish:
    - Sidebar groups: Command, Equipment, Work, Inventory, People, Lifecycle, Support, Reports, Administration.
    - Helpdesk is removed from navigation; support flows now use Requests Hub, Alerts, Maintenance Requests, and BMERMS AI Chatbot.
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
    map to `@bmerms-demo.local` per role. `St. Peter's Specialized Hospital` no longer
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
4. A device must open BMERMS once online before offline loading can work. Desktop/mobile PWA installation is optional; caching depends on service-worker registration during that first online visit.
5. Queue storage is IndexedDB (`src/lib/offline/db.ts`, `src/lib/offline/queue.ts`). New serious offline actions must use IndexedDB, not localStorage. Offline IDs use Web Crypto (`crypto.randomUUID` / `crypto.getRandomValues`), never `Math.random`.
6. `src/types/offline.ts` defines action types and statuses. Online-only actions include procurement/disposal approval, QR token regeneration, user/settings/security changes, analytics refresh, final assignment/final closure, and replacement decisions.
7. `runOfflineCapableAction()` queues only when offline or after likely network failure. Validation/server errors must not be queued blindly.
8. `src/lib/offline/sync-engine.ts` processes actions sequentially by created_at. Phase 1 has no production workflow handlers; unsupported queued actions fail honestly with handler-not-implemented metadata and are not deleted or marked synced.
9. Existing `offline_sync_events` supports only pending/synced/failed and lacks top-level asset_id/role/error/conflict columns. Phase 1 stores extra evidence inside payload, maps conflicts to failed + payload.conflict_reason, and adds no migration.
10. Developer Lab shows Offline & Sync Diagnostics using real browser state. Unknown service-worker/cache status must render as Unknown, not healthy.
11. The offline phases are: 1) Foundation/App Shell/Sync Infrastructure, 2) Offline-Capable Role Workflows, 3) Conflict Handling/Cached Read Views/Sync Evidence.

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

NEVER modify 00001–00046. Next migration must be 00047.
