# BMERMS Demo Workflow QA

Last updated: 2026-05-11

Scope: app hardening and demo readiness with seed data. Real Yekatit-12 production data migration is intentionally excluded.

## Core Demo Workflow

| Step | Action | Expected result | Status |
|---:|---|---|---|
| 1 | Log in as the linked developer/admin demo user | Dashboard shell loads and role-gated navigation appears | Not manually run in this pass |
| 2 | Open `/command` | Command Center cards, triage, readiness, risk, replacement, exact row actions, and shared-count drilldowns render from operational sources | Build verified |
| 3 | Open `/equipment` | Equipment list renders active seeded assets | Build verified |
| 4 | Create or select a seeded asset | Equipment mutation uses `createEquipmentAction` / server auth | Code verified |
| 5 | Create a maintenance request | Request is written by `createMaintenanceRequestAction`, audited, and relevant paths are revalidated | Code verified |
| 6 | Create or assign a work order | Work order is written by `createWorkOrderAction` / `updateWorkOrderAction` | Code verified |
| 7 | Move work order through status lifecycle | Status changes are server-authorized and audited | Code verified |
| 8 | Add a maintenance event | Event is written by `createMaintenanceEventAction` and triggers asset analytics recompute | Code verified |
| 9 | Complete work order | Completion triggers `recomputeAssetAnalytics` | Code verified |
| 10 | Refresh analytics/Command Center | Existing command refresh action recomputes all analytics | Existing behavior retained |
| 11 | Confirm flags/triage update | Triage and alerts paths revalidate after acknowledgments and recompute | Code verified |
| 12 | Acknowledge alert or triage | Alert acknowledge uses `acknowledgeAlertFlagAction`; triage uses existing server action | Code verified |
| 13 | Acknowledge Risk Watch signal | Risk Watch acknowledgement stores item key + signal hash so unchanged reviewed signals hide and changed signals reappear | Code verified |
| 13 | Export report PDF/CSV | Empty datasets now return "No rows to export" instead of downloading blank exports | Code verified |
| 14 | Open audit log | Operational server actions write profile-id audit rows | Code verified |
| 15 | Demo with seed data if real data is unavailable | Seed behavior is acceptable; recurring failure currently has one seeded asset above threshold | Documented |

## Module QA Matrix

| Module | Route | Primary role | Read | Write | Empty/error behavior | Audit/revalidation | Demo status |
|---|---|---|---|---|---|---|---|
| Command Center | `/command` | all roles | Shared typed fetchers | Refresh/ack/exact record links/prefilled flows | Empty cards | Revalidates command routes | Build verified |
| Hospital Calendar | `/calendar` | all roles | Normalized internal event fetcher | Opens exact/contextual source records | Empty period/filter state and source warnings | Source actions revalidate calendar | Code verified |
| Triage queue | `/command/triage` | ops roles | Client read view | Existing command actions | Empty table | Revalidates command/health | Build verified |
| Equipment | `/equipment` | admin/technician | Client service reads | Server actions | Existing UI | Equipment/report/command revalidation | Code verified |
| Maintenance requests | `/maintenance`, `/maintenance/requests/*` | admin/technician/department_user | Client service reads | Server actions | Existing UI | Maintenance/report/command revalidation | Code verified |
| Requests Hub | `/requests`, `/requests/[type]/[id]` | all operational/request roles + viewer | Shared normalized server fetcher | Type-specific links into module actions | Empty categories show 0/not configured | N/A | Code verified |
| Work orders | `/work-orders`, `/maintenance/work-orders/*` | admin/technician | Client service reads | Server actions | Active execution default, active Critical/High filter, condition trace, exact WO actions | Maintenance/report/command revalidation | Typecheck verified |
| Preventive maintenance | `/pm`, `/pm/*` | admin/technician | Client service reads | Evidence-based server actions | Control-center cards/tabs with empty states | PM/equipment/command/risk revalidation | Code verified |
| Calibration | `/calibration` | admin/technician | Client service reads | Server actions | Requests/Upcoming/Overdue/Records tabs, explainable triage model, card filters | Calibration/report/command revalidation | Typecheck verified |
| Spare parts | `/spare-parts` | admin/technician/store_user | Client service reads | Server actions | Clickable cards, stock action queue, duplicate-safe procurement tracking | Spare/logistics/command revalidation | Typecheck verified |
| Logistics | `/logistics` | admin/technician/store_user | Live summary/workflow cards | Contextual links to spare/procurement/work orders | MEMIS panels for receiving/request/issue/balance/usage | N/A | Typecheck verified |
| Procurement | `/procurement` | admin/store_user/technician | Client service reads | Server action create/status | Pipeline card filters, inline status update, delay/blocker actions | Procurement/logistics/command revalidation | Typecheck verified |
| Training | `/training` | admin/technician/department_user | Client service reads | Server actions | Requests/Upcoming/Completed/Evidence tabs; Coverage removed from primary nav | Training/report revalidation | Typecheck verified |
| Disposal | `/disposal` | admin/technician | Client service reads | Server actions | Filter cards, formal request vs candidate separation, disposed-by profile names | Disposal/replacement/report revalidation | Typecheck verified |
| Replacement | `/replacement` | admin/technician/viewer | Client service reads | No DB writes | Top-10 chart default, prototype RPI thresholds, evidence/action planning page | N/A | Typecheck verified |
| Alerts | `/alerts` | admin/technician | Client service reads | Server action acknowledge | Command Center-style alert inbox with specific source actions | Alerts/command revalidation | Typecheck verified |
| Helpdesk | `/helpdesk` | deprecated | Redirect | None | Redirects to Requests Hub | N/A | Typecheck verified |
| Documents | `/documents` | admin/technician | Client service reads | Server action upload/delete | Existing UI | Docs/equipment revalidation | Code verified |
| Reports | `/reports/[type]` | reporting roles | Client service reads | Snapshot prep + export | Timestamped snapshot evidence, freshness note, methodology, CSV/PDF | Reports/audit where permitted | Typecheck verified |
| Users | `/users` | deprecated | Redirect | None | Redirects to Settings → Staff & Access | Users/settings/audit revalidation | Typecheck verified |
| Settings | `/settings` | developer/admin/BME Head | Client service reads | Server actions where allowed | Administration tabs with staff/security/reference data | Settings/audit revalidation | Typecheck verified |
| Security | `/security` | deprecated | Redirect | None | Redirects to Settings → Security & Access | N/A | Typecheck verified |
| Developer Lab | `/developer-lab` | developer/admin | Server/client reads | Explicit refresh actions only | Simulation-only sensitivity tabs, ranking stability, data health, demo tools | Developer/audit/command/report revalidation | Typecheck verified |
| Chatbot | `/chatbot` | all roles | Client chat session reads | Existing chat service/API | Existing UI | Chatbot test suite | 111 tests passing |
| Installation | `/installation` | admin/technician | Client service reads | Server action create | Existing UI | Installation/equipment/command revalidation | Code verified |

## Seed Behavior Notes

- Recurring-failure flags keep the thesis threshold of `failureCount >= 4`. In the seeded period, currently one asset crosses that threshold. Assets with 2-3 events are below threshold and will appear after additional failures are logged.
- Supabase Storage bucket required for document workflows: create bucket `equipment-documents`, allow authenticated upload/read/delete according to project RLS/storage policy, and ensure environment variables point to the active Supabase project.
- Offline sync is intentionally scoped to work-order status updates and maintenance event logs. There is no background service worker; users sync manually from the work-order detail page.

## Final Polish Semantics

1. No passive dashboards: operational cards filter the current surface or route to exact filtered surfaces; row actions use state-aware workflow verbs.
2. Developer Lab is the only place for scoring sliders, sensitivity testing, thesis/debug tools, data health, and explicit refresh controls.
3. BME Head sees operational control pages but not scoring sandbox weights or debug/thesis controls.
4. Calibration triage uses overdue severity + equipment criticality + last result risk + department impact + workflow state.
5. Maintenance condition trace shows request condition, work-order state, completion outcome, final equipment condition, and current equipment condition.
6. Work Orders treats active work as the default and completed work as evidence/history.
7. Spare Parts tracks existing procurement instead of creating duplicate requests.
8. Logistics workflow is Receive -> Request -> Approve -> Issue -> Balance/Bin Card -> Usage Evidence.
9. Procurement inline status updates are audited/revalidated through server actions where permitted.
10. Replacement thresholds are prototype decision thresholds and not automatic approval.
11. Reports show snapshot timestamp/freshness/methodology evidence.
12. Staff & Access and Security & Access are Settings tabs; `/users` and `/security` are compatibility redirects.
13. Helpdesk is removed; `/helpdesk` redirects to Requests Hub.
14. Existing records open exact routes, missing workflows open prefilled creation, informational signals open evidence/acknowledge/convert actions, and composite scores expose explanations.

## Command Center Action Semantics

1. Exact record rule: row-level actions must open exact records when records exist.
2. Prefilled creation rule: if no record exists, open a prefilled creation flow with context.
3. Informational signal rule: informational signals use acknowledge/snooze or convert-to-workflow.
4. Count consistency rule: summary card, triage tab, drilldown, Work Queue & Assignment, and critical action count must share the same fetcher/source for the same metric.
5. State-aware action labels: Assign for unassigned work, Reassign for assigned work, View Progress for in-progress work, Resolve Blocker for on-hold work.
6. Future triage categories: new triage categories must define record IDs, exact routes, and prefilled fallback flows before being shown in the Command Center.
7. BME Head principle: the system recommends/explains; the BME Head decides.

## Requests Hub Semantics

1. Requests Hub is the central intake/tracking front door, not a replacement for operational modules.
2. Categories are corrective maintenance, calibration, training, procurement, disposal, installation, and specification/document support.
3. The unified request table uses one normalized data source for cards, filters, and counts.
4. Existing request rows open exact records where available; categories without dedicated module detail pages use `/requests/[type]/[id]`.
5. New request actions route to type-specific creation or module modal flows with `source=requests-hub`.
6. Viewer is read-only; BME Head/developer/admin see all hospital request activity; department roles are scoped to own/department rows where context exists.
7. Installation requests use `installation_requests`; installation records remain completion evidence and are not request counts.
8. Specification requests use `specification_requests`; specification documents remain output/evidence and are not request counts.
9. Disposal counts formal disposal requests only; replacement candidates are linked evidence, not disposal requests.

## Hospital Operations Calendar Semantics

1. `/calendar` is fully internal and is not Google Calendar integration.
2. Events are normalized from real BMERMS date fields across PM, calibration, maintenance, training, installation, procurement, disposal, and dated specification requests.
3. Source workflow tables remain the source of truth; internal sync means route revalidation/refresh after source actions.
4. Exact records open exact routes where available. Contextual module routes are reserved for sources without detail pages.
5. Viewer is read-only. External Google Calendar sync is intentionally deferred because it requires OAuth, token storage, duplicate prevention, and conflict handling.

## Preventive Maintenance Semantics

1. PM Plan is the recurring PM rule/program; PM Schedule is one generated task; PM Completion is the evidence that work was performed.
2. PM Compliance = completed scheduled PM tasks ÷ total scheduled PM tasks. Skipped/deferred PM is tracked separately and does not count as completed.
3. Completion evidence records result, checklist, notes/findings, technician, completion date, and final equipment condition.
4. PM issue findings can create/open corrective maintenance requests with duplicate prevention.
5. PM completion updates `/pm`, Equipment detail, Command Center overdue PM, and FMEA detectability through the existing analytics refresh path.
6. Existing PM schedule actions open exact `/pm/schedules/[id]` records. Viewer remains read-only.

## PM Count and Action Semantics

1. PM Schedule Records = all generated `pm_schedules` rows, including historical completed/skipped/deferred rows and active unfinished rows.
2. Active PM Tasks = unfinished PM tasks requiring action: scheduled, in progress, overdue, or deferred.
3. PM Plan status is different from asset criticality. Active/Paused is plan generation state; criticality is equipment risk/context.
4. `Needs next task` means no unfinished upcoming task exists for that plan, not that there is no history.
5. Generate Next Task creates the next schedule only when no unfinished task exists; otherwise it opens the existing unfinished task.
6. Pause Plan disables future generation but does not delete history or alter existing task completion state. Resume Plan re-enables generation.
7. History opens exact `/pm/plans/[id]/history` with schedule/evidence drilldown and exact schedule links.
8. Compliance = completed scheduled tasks ÷ total scheduled tasks × 100; skipped/deferred remain separate.

## Verification Results

- `npm run lint`: pass, 0 warnings.
- `npm run test:chatbot`: pass, 111 tests.
- `npm run build`: pass when run with network access for Google-hosted Next fonts.
- Remaining non-blocking warning: Next.js 16 reports the `middleware` file convention is deprecated in favor of `proxy`; migration is deferred to avoid changing Supabase session refresh behavior during this hardening pass.
