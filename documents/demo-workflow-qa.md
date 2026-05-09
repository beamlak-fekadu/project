# BMERMS Demo Workflow QA

Last updated: 2026-05-07

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
| Triage queue | `/command/triage` | ops roles | Client read view | Existing command actions | Empty table | Revalidates command/health | Build verified |
| Equipment | `/equipment` | admin/technician | Client service reads | Server actions | Existing UI | Equipment/report/command revalidation | Code verified |
| Maintenance requests | `/maintenance`, `/maintenance/requests/*` | admin/technician/department_user | Client service reads | Server actions | Existing UI | Maintenance/report/command revalidation | Code verified |
| Work orders | `/work-orders`, `/maintenance/work-orders/*` | admin/technician | Client service reads | Server actions | Existing UI | Maintenance/report/command revalidation | Code verified |
| Preventive maintenance | `/pm`, `/pm/*` | admin/technician | Client service reads | Server actions | Existing UI | PM/report/command revalidation | Code verified |
| Calibration | `/calibration` | admin/technician | Client service reads | Server actions | Existing UI | Calibration/report/command revalidation | Code verified |
| Spare parts | `/spare-parts` | admin/technician/store_user | Client service reads | Server actions | Existing UI | Spare/logistics/command revalidation | Code verified |
| Logistics | `/logistics` | admin/technician/store_user | Live summary cards | Links to spare/procurement | Summary defaults to zero | N/A | Build verified |
| Procurement | `/procurement` | admin/store_user/technician | Client service reads | Server action create/status | Existing UI | Procurement/logistics/command revalidation | Code verified |
| Training | `/training` | admin/technician/department_user | Client service reads | Server actions | Existing UI | Training/report revalidation | Code verified |
| Disposal | `/disposal` | admin/technician | Client service reads | Server actions | Existing UI | Disposal/replacement/report revalidation | Code verified |
| Replacement | `/replacement` | admin/technician/viewer | Client service reads | No DB writes | Empty chart/table | N/A | Polished |
| Alerts | `/alerts` | admin/technician | Client service reads | Server action acknowledge | Empty tabs | Alerts/command/helpdesk revalidation | Code verified |
| Helpdesk | `/helpdesk` | ops roles | Live alert queue | Server action acknowledge | Empty queue | Alerts/command/helpdesk revalidation | Polished |
| Documents | `/documents` | admin/technician | Client service reads | Server action upload/delete | Existing UI | Docs/equipment revalidation | Code verified |
| Reports | `/reports/[type]` | reporting roles | Client service reads | Export only | No rows toast | N/A | Build verified |
| Users | `/users` | admin | Client service reads | Server actions | Existing UI | Users/settings/audit revalidation | Code verified |
| Settings | `/settings` | admin | Client service reads | Server actions | Existing UI | Settings/audit revalidation | Code verified |
| Security | `/security` | admin | Server live summary | Links only | Empty audit text | N/A | Server-protected |
| Chatbot | `/chatbot` | all roles | Client chat session reads | Existing chat service/API | Existing UI | Chatbot test suite | 111 tests passing |
| Installation | `/installation` | admin/technician | Client service reads | Server action create | Existing UI | Installation/equipment/command revalidation | Code verified |

## Seed Behavior Notes

- Recurring-failure flags keep the thesis threshold of `failureCount >= 4`. In the seeded period, currently one asset crosses that threshold. Assets with 2-3 events are below threshold and will appear after additional failures are logged.
- Supabase Storage bucket required for document workflows: create bucket `equipment-documents`, allow authenticated upload/read/delete according to project RLS/storage policy, and ensure environment variables point to the active Supabase project.
- Offline sync is intentionally scoped to work-order status updates and maintenance event logs. There is no background service worker; users sync manually from the work-order detail page.

## Command Center Action Semantics

1. Exact record rule: row-level actions must open exact records when records exist.
2. Prefilled creation rule: if no record exists, open a prefilled creation flow with context.
3. Informational signal rule: informational signals use acknowledge/snooze or convert-to-workflow.
4. Count consistency rule: summary card, triage tab, drilldown, Work Queue & Assignment, and critical action count must share the same fetcher/source for the same metric.
5. State-aware action labels: Assign for unassigned work, Reassign for assigned work, View Progress for in-progress work, Resolve Blocker for on-hold work.
6. Future triage categories: new triage categories must define record IDs, exact routes, and prefilled fallback flows before being shown in the Command Center.
7. BME Head principle: the system recommends/explains; the BME Head decides.

## Verification Results

- `npm run lint`: pass, 0 warnings.
- `npm run test:chatbot`: pass, 111 tests.
- `npm run build`: pass when run with network access for Google-hosted Next fonts.
- Remaining non-blocking warning: Next.js 16 reports the `middleware` file convention is deprecated in favor of `proxy`; migration is deferred to avoid changing Supabase session refresh behavior during this hardening pass.
