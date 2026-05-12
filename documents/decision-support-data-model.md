# Decision support data model (BMERMS / MEMIS)

This document maps database tables to roles in the system and defines the **canonical** sources of truth for decision support. It is a reference for operators and for future AI read models. **No table merges or deletions** are implied here.

## Canonical decision-support story

1. **Operational source of truth** — `equipment_assets`, work execution (`maintenance_requests`, `work_orders`, `maintenance_events`, `pm_*`, `calibration_*`, logistics, etc.) record what actually happened.
2. **Analytics layers** — `equipment_reliability_metrics`, `equipment_risk_scores`, `pm_compliance_metrics`, `equipment_performance_scores`, `replacement_priority_scores` are **derived**; they are not duplicates of each other; each answers a different question.
3. **Atomic alerts** — `recommendation_flags` stores typed, severed, asset-scoped facts (with optional `details` JSON for evidence). Powers `/alerts` and feeds triage scoring.
4. **Prioritized worklist** — `triage_action_queue` is **derived** by `refresh_decision_support_snapshots` from risk, PM, replacement, and open flags. Powers Command Center triage. **Triage is driven by this queue**, not by raw flag count.
5. **Daily snapshots** — `equipment_health_snapshots`, `clinical_readiness_snapshots`, `workload_capacity_snapshots` roll up metrics for the command center and reporting.
6. **Command Center action semantics** — operational rows must preserve record identity. If a row is an existing work order, request, PM schedule, procurement request, or replacement candidate, its primary action opens that exact record/evidence route. If no workflow record exists, the action opens a prefilled creation flow with source context. Informational Risk Watch signals are acknowledged/snoozed with a signal hash or converted into real workflow items.
7. **Developer Lab boundary** — scoring methodology, sandbox sliders, sensitivity testing, debug tools, data health checks, refresh tools, and thesis/demo tools live in `/developer-lab` and are developer-only. Sandbox controls do not affect live decision outputs unless a developer explicitly runs a real refresh action.
8. **Operational-page boundary** — BME Head pages show the situation, evidence, explanations, and next actions, but not developer-only sliders or debug controls. Replacement Priority is a planning/evidence page; scoring sliders belong only in Developer Lab.
9. **Final polishing rule** — operational count cards must filter the current surface or route to an exact filtered surface. Tables and queues must use the same loaded rows as their cards whenever possible. Completed rows are evidence/history, not default active work queues.

**Overlap note:** `recommendation_flags` and `triage_action_queue` are related but not redundant: flags are evidence; the queue is the ordered action list. `repeat_repair_flags` (schema) overlaps intent with `recommendation_flags` of type `recurring_failure` — a future PR may deprecate the separate table; **do not delete without a migration plan**.

## Table inventory by role

### Source-of-truth operational

| Table | Purpose |
| --- | --- |
| `equipment_assets` | Master equipment register |
| `maintenance_requests`, `work_orders`, `maintenance_events` | Maintenance workflow |
| `downtime_logs` | Downtime history |
| `maintenance_parts_used` | Parts consumption on events |
| `pm_plans`, `pm_schedules`, `pm_checklists`, `pm_completions` | PM lifecycle |
| `calibration_requests`, `calibration_records`, `calibration_certificates` | Calibration |
| `spare_parts`, `stock_receipts`, `stock_issues` | Parts inventory |
| `procurement_requests` | Procurement (MEMIS) |
| `disposal_requests`, `disposed_assets` | Disposal |
| `training_requests`, `training_sessions`, `staff_training_records`, `equipment_training_records` | Training |
| `installation_records`, `equipment_locations`, `asset_status_history`, `equipment_documents` | Asset history / docs |
| `chat_sessions`, `chat_messages` | Copilot/chat persistence |
| `profiles`, `user_roles` | People and roles |

### Lookup / reference

`departments`, `equipment_categories`, `manufacturers`, `equipment_models`, `vendors`, `suppliers`, `failure_codes`, `maintenance_action_codes`, `calibration_types`, `pm_templates`, `risk_scales`, `scoring_weights`, `status_labels`, `roles`, `memis_lookup_values`, `inspection_templates`.

### Computed analytics and snapshots

| Table | Purpose |
| --- | --- |
| `equipment_reliability_metrics` | MTTR, MTBF, availability, failure counts by period |
| `equipment_risk_scores` | FMEA RPN (S×O×D) per assessment |
| `pm_compliance_metrics` | PM completion ratio |
| `equipment_performance_scores` | Weighted composite |
| `replacement_priority_scores` | Multi-criteria replacement ranking |
| `equipment_health_snapshots` | Per-asset health score and explanation JSON per day |
| `clinical_readiness_snapshots` | Per-department essential-equipment readiness per day |
| `workload_capacity_snapshots` | Assignee workload per day |

### Queues and action tables

| Table | Purpose |
| --- | --- |
| `triage_action_queue` | Open/dismissed triage rows; **primary triage driver for UI** |
| `recommendation_flags` | Atomic alerts; ack state |
| `command_center_acknowledgements` | Per-profile Command Center acknowledgement/snooze state keyed by item type, item key, and signal hash |
| `escalation_rules`, `escalation_events` | Escalation (underused in app today) |

### Audit / history / telemetry

`audit_logs`, `chat_session_memory`, `chat_telemetry_events`, `chat_evaluation_runs`, `chat_evaluation_results`, `offline_sync_events`, `repeat_repair_flags`.

### Underused / future deprecation candidates (no drop in this repo)

- `repeat_repair_flags` — consider merging narrative into `recommendation_flags` only after app reads are migrated.
- `escalation_rules` / `escalation_events` — no current UI consumers.
- `chat_evaluation_*` — evaluation harness, not product surface.

## AI-ready read models (Postgres views)

All created in migration `00021_decision_support_read_models.sql` with `WITH (security_invoker = true)` so RLS of the underlying tables applies to the caller.

| View | Description |
| --- | --- |
| `v_command_center_triage` | Triage queue + asset/department + top unacknowledged flag per asset |
| `v_asset_health_summary` | Latest `equipment_health_snapshots` per active asset with identifiers |
| `v_department_readiness` | Latest `clinical_readiness_snapshots` per department |
| `v_replacement_decision` | Replacement scores joined with latest risk, reliability, PM per asset |
| `v_maintenance_risk_context` | Per-asset maintenance/risk summary for prioritization |

These views intentionally exclude auth secrets and minimize PII (same disclosure level as existing operational screens).

## Command Center source-of-truth rules

| Workflow | Canonical Command Center source | Count consistency rule |
| --- | --- | --- |
| Corrective | Open `work_orders` where `work_type='corrective'` plus open `maintenance_requests` | Corrective tab and critical actions must not fall back to all equipment |
| Needs Request | Active condition-problem `equipment_assets` with no open corrective work/request | Used for non-functional assets without a request |
| Risk Watch | High/critical risk scores and active recommendation flags without open corrective work | Acknowledged rows hide only while `signal_hash` matches |
| PM | `fetchPMTriage()` / `v_overdue_pm` | Summary, triage, drilldown, and critical actions share this count |
| Calibration | `fetchCalibrationTriage()` / `v_calibration_due` within due/overdue window | Summary, triage, and drilldown share this count |
| Stock | `fetchStockBlockers()` / `spare_parts` below reorder with optional open-work linkage | Distinguish stockout, low-stock risk, and confirmed maintenance blocker |
| Procurement | `procurement_requests` | Row actions open exact request detail/status route |
| Replacement | `v_replacement_decision` | Evidence route and report prefill keep `asset_id` context |

Every composite score surfaced in the Command Center must be explainable in UI: formula, criteria,
weights when applicable, raw inputs, normalized inputs where applicable, generated reason,
source/method, timestamp/history if available, and a decision note. The system supports decisions;
the BME Head makes final operational decisions.

## Final system-page source-of-truth rules

| Page | Source/evidence rule |
| --- | --- |
| Developer Lab | Developer-only; owns scoring methodology, sandbox weights, ranking comparison, data health, refresh/debug, and thesis/demo tools |
| Settings | Administration center for hospital profile, departments, categories, Staff & Access, Security & Access, notifications, reference data, preferences, import/export |
| Staff & Access | Uses `profiles`, `user_roles`, `roles`, and `departments`; profile-only staff and auth-linked login users are both shown |
| Security & Access | Uses roles/profile/audit evidence; shows role matrix, users per role, RLS/audit posture, risky accounts, and recent governance events |
| Calibration | Uses `calibration_records`, `calibration_requests`, and `v_calibration_due`; failed/adjusted and overdue rows must be visible |
| Calibration | Uses `calibration_records`, `calibration_requests`, and `v_calibration_due`; priority = overdue severity + criticality + last result risk + department impact + workflow state |
| Work Orders | Uses `work_orders`; default active queue excludes completed history; row actions open exact `/maintenance/work-orders/[id]` with state-aware action query where needed |
| Spare Parts | Uses `spare_parts`, `stock_receipts`, `stock_issues`, and procurement prefill links; open procurement is tracked instead of duplicated |
| Logistics | Uses real receipt, issue, spare part, and procurement rows; represents Receive -> Request -> Approve -> Issue -> Balance/Bin Card -> Usage Evidence |
| Procurement | Uses `procurement_requests`; exact detail/status route is `/command/drilldown/procurement/[id]`; inline status updates use server actions where permitted |
| Training | Uses `training_requests`, `training_sessions`, and `staff_training_records`; primary tabs are Requests, Upcoming, Completed, Competency Evidence |
| Replacement | Uses `replacement_priority_scores` and `v_replacement_decision`; thresholds are prototype/system decision thresholds: >=0.70 strong, 0.55-0.69 review, <0.55 monitor |
| Disposal | Uses formal `disposal_requests` and `disposed_assets`; replacement/non-repairable candidates are evidence prompts, not request counts; disposed_by resolves through profiles |
| Alerts | Uses `recommendation_flags` today; specific source action labels are preferred over generic source links |
| Reports | Uses table-backed report services; report detail shows generated timestamp, refresh/freshness note, methodology, and export evidence |
| Audit | Uses `audit_logs`; page highlights high-risk governance events and must degrade gracefully if the table is empty or inaccessible |

Route compatibility rules: `/helpdesk` redirects to `/requests`, `/users` redirects to `/settings?tab=staff-access`, `/security` redirects to `/settings?tab=security-access`, and `/command/health` plus `/decision-support-health` redirect to `/developer-lab`.

## Requests Hub source-of-truth rules

The Requests Hub is a cross-category intake and tracking layer. It must not replace operational modules or invent request data.

| Category | Requests Hub source | Routing rule |
| --- | --- | --- |
| Corrective maintenance | `maintenance_requests` plus linked `work_orders` for next action | Existing request/work order opens exact `/maintenance/...` route; new requests use `/maintenance/requests/new?type=corrective&source=requests-hub` |
| Calibration | `calibration_requests` | Uses lightweight `/requests/calibration/[id]` detail when no dedicated calibration request detail page exists |
| Training | `training_requests` | Uses lightweight `/requests/training/[id]` detail when no dedicated training request detail page exists |
| Procurement | `procurement_requests` | Opens exact `/command/drilldown/procurement/[id]` status/evidence route |
| Disposal | `disposal_requests` | Formal disposal requests only; replacement candidates are linked evidence and are not counted |
| Installation | `installation_requests` | Request rows open `/installation/requests/[id]`; `installation_records` remain completion evidence only |
| Specification | `specification_requests` | Request rows open `/documents/specification-requests/[id]`; `equipment_documents` remain output/evidence only |

Cards, workflow summaries, and the unified table must share the same normalized Requests Hub fetcher so counts do not drift.

Installation Request = intake/workflow item. Installation Record = completion evidence. The expected flow is submitted → reviewed/approved → scheduled or assigned → in progress → installation/commissioning completed → installation record created → go-live.

Specification Request = request/tracking item. Specification Document = output/evidence. Requests may be reviewed, assigned, linked to uploaded specification documents, completed, rejected, and retrieved from the Documents workflow.

## Hospital Operations Calendar source-of-truth rules

The Hospital Operations Calendar at `/calendar` is a fully internal BMERMS read/overview surface. It is not Google Calendar integration and must not create external events, request Google OAuth, or store external calendar tokens.

| Event family | Calendar source | Routing rule |
| --- | --- | --- |
| Preventive maintenance | `pm_schedules` with `pm_plans` and asset context | Opens exact `/pm/schedules/[id]` |
| Calibration | `calibration_records` and `calibration_requests` | Uses calibration context query because no dedicated calibration detail route exists |
| Work orders | `work_orders` | Opens exact `/maintenance/work-orders/[id]` |
| Maintenance requests | `maintenance_requests` | Opens exact `/maintenance/requests/[id]` |
| Training | `training_sessions` and `training_requests` | Uses training context query because no dedicated training detail route exists |
| Installation | `installation_requests` and `installation_records` | Requests open exact `/installation/requests/[id]`; records use contextual `/installation` route |
| Procurement | `procurement_requests` | Opens exact `/command/drilldown/procurement/[id]` |
| Disposal | `disposal_requests` and `disposed_assets` | Uses contextual `/disposal` route because no dedicated disposal detail route exists |
| Specification/document | `specification_requests.required_by` when present | Opens exact `/documents/specification-requests/[id]` |

Calendar events are normalized from real date fields only. Source tables remain authoritative; calendar sync means internal revalidation/refresh after source-module actions. Viewer is read-only. Future external Google Calendar sync would require OAuth, token storage, duplicate prevention, and conflict handling.

## Preventive Maintenance source-of-truth rules

| Concept | Source | Rule |
| --- | --- | --- |
| PM Plan | `pm_plans` | Recurring PM rule/program with asset, frequency, checklist expectation, next due date, and active state |
| PM Schedule | `pm_schedules` | One planned task instance with exact `/pm/schedules/[id]` route, status, assignment, and completion/defer evidence |
| PM Completion | `pm_completions` plus schedule evidence fields | Evidence that work was performed: result, checklist, notes, technician, completion date, final condition |
| PM Compliance | `pm_schedules` / `pm_compliance_metrics` | Completed scheduled PM tasks ÷ total scheduled PM tasks. Skipped/deferred are separate and not completed |
| Overdue PM | `fetchPMTriage()` / `v_overdue_pm` | PM page overdue tab, Command Center PM triage, and critical action counts share this source |

PM completion updates equipment condition, schedule evidence, completion evidence, PM compliance, Command Center overdue PM, Equipment detail context, and FMEA detectability through the existing recompute/trigger pipeline where available. If PM finds an issue, the completion flow can create/open a corrective request while respecting duplicate prevention.

## PM Count and Action Semantics

| Concept | Definition |
| --- | --- |
| PM Schedule Records | All generated `pm_schedules` rows, including historical completed/skipped/deferred/canceled rows and active unfinished rows |
| Active PM Tasks | Unfinished rows requiring action: `scheduled`, `in_progress`, `overdue`, or `deferred` |
| Plan Status | `pm_plans.is_active`; Active means future tasks can be generated, Paused means generation is disabled |
| Asset Criticality | Equipment category/risk context; separate from PM plan state |
| Needs next task | No unfinished upcoming/active schedule exists for the plan; this does not imply no history |
| Generate Next Task | Creates one next schedule only when no unfinished task exists; otherwise returns/opens the existing unfinished task |
| Pause Plan | Sets `is_active=false`, preserves history, and does not mark existing tasks complete/canceled |
| History | `/pm/plans/[id]/history` exact plan schedule/evidence drilldown |
| Compliance | Completed scheduled tasks ÷ total scheduled tasks × 100; skipped/deferred tracked separately |

## Command Center Action Semantics

1. Exact record rule: row-level actions must open exact records when records exist.
2. Prefilled creation rule: if no record exists, open a prefilled creation flow with context.
3. Informational signal rule: informational signals use acknowledge/snooze or convert-to-workflow.
4. Count consistency rule: summary card, triage tab, drilldown, Work Queue & Assignment, and critical action count must share the same fetcher/source for the same metric.
5. State-aware action labels: Assign for unassigned work, Reassign for assigned work, View Progress for in-progress work, Resolve Blocker for on-hold work.
6. Future triage categories: new triage categories must define record IDs, exact routes, and prefilled fallback flows before being shown in the Command Center.
7. BME Head principle: the system recommends/explains; the BME Head decides.

## Operational refresh logging

Table `decision_support_refresh_log` records server-side recompute runs triggered by `recompute_equipment_analytics` / `recompute_all_equipment_analytics` (see `src/actions/analytics.actions.ts`).
