# Decision support data model (BMERMS / MEMIS)

This document maps database tables to roles in the system and defines the **canonical** sources of truth for decision support. It is a reference for operators and for future AI read models. **No table merges or deletions** are implied here.

## Canonical decision-support story

1. **Operational source of truth** — `equipment_assets`, work execution (`maintenance_requests`, `work_orders`, `maintenance_events`, `pm_*`, `calibration_*`, logistics, etc.) record what actually happened.
2. **Analytics layers** — `equipment_reliability_metrics`, `equipment_risk_scores`, `pm_compliance_metrics`, `equipment_performance_scores`, `replacement_priority_scores` are **derived**; they are not duplicates of each other; each answers a different question.
3. **Atomic alerts** — `recommendation_flags` stores typed, severed, asset-scoped facts (with optional `details` JSON for evidence). Powers `/alerts` and feeds triage scoring.
4. **Prioritized worklist** — `triage_action_queue` is **derived** by `refresh_decision_support_snapshots` from risk, PM, replacement, and open flags. Powers Command Center triage. **Triage is driven by this queue**, not by raw flag count.
5. **Daily snapshots** — `equipment_health_snapshots`, `clinical_readiness_snapshots`, `workload_capacity_snapshots` roll up metrics for the command center and reporting.
6. **Command Center action semantics** — operational rows must preserve record identity. If a row is an existing work order, request, PM schedule, procurement request, or replacement candidate, its primary action opens that exact record/evidence route. If no workflow record exists, the action opens a prefilled creation flow with source context. Informational Risk Watch signals are acknowledged/snoozed with a signal hash or converted into real workflow items.

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
