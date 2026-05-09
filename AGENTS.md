# AGENTS.md — BMERMS Codebase Reference for AI Agents

Last updated: 2026-05-09 (session 8, Command Center action accuracy)
Branch: BMERMS_V4
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
- src/types/supabase.ts is generated — do not hand-edit it
- Regenerate: `npx supabase gen types typescript --project-id fgqyszbxzpmqzpqvdivx > src/types/supabase.ts`

### RPC calls used in TypeScript
```ts
// Single asset full recompute
supabase.rpc('recompute_equipment_analytics', { p_asset_id: assetId })

// All assets recompute
supabase.rpc('recompute_all_equipment_analytics')

// Refresh decision support snapshots
supabase.rpc('refresh_decision_support_snapshots')
```

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
| maintenance_requests     | id, request_number(UQ), asset_id(FK), requested_by(FK), department_id(FK), fault_description, urgency(enum), status(enum) |
| work_orders              | id, work_order_number(UQ), request_id(FK), asset_id(FK), assigned_to(FK), status(enum), priority(enum), work_type(enum) |
| maintenance_events       | id, work_order_id(FK), asset_id(FK), event_type(enum), failure_date, downtime_start, downtime_end, repair_duration_hours (CHECK ≥0 when set — migration 00029), failure_code_id(FK), action_code_id(FK), service_cost |
| downtime_logs            | id, asset_id(FK), event_id(FK), start_time, end_time, duration_hours (CHECK ≥0 when set — migration 00029) |
| maintenance_parts_used   | id, event_id(FK), spare_part_id(FK), quantity_used, unit_cost       |

maintenance_requests status enum: pending / approved / assigned / in_progress / completed / rejected / canceled
work_orders status enum: open / assigned / in_progress / on_hold / completed / canceled

### Preventive Maintenance (Migration 00005)
| Table          | Key columns                                                                       |
|----------------|-----------------------------------------------------------------------------------|
| pm_plans       | id, asset_id(FK), template_id(FK), name, frequency_days, next_due_date, last_completed_date, is_active |
| pm_schedules   | id, plan_id(FK), asset_id(FK), scheduled_date, status(enum), assigned_to(FK profiles) |
| pm_checklists  | id, schedule_id(FK), items(JSONB)                                                 |
| pm_completions | id, schedule_id(FK), completed_by(FK), completion_date, duration_hours, checklist_results(JSONB) |

pm_schedules status enum: scheduled / completed / overdue / skipped / in_progress

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

### maintenance.service.ts
- getMaintenanceRequests(filters), getRequestById(id)
- createRequest(data) — request_number: MR-{timestamp}
- updateRequestStatus(id, status) — sets resolved_at if completed
- getWorkOrders(filters), getWorkOrderById(id)
- createWorkOrder(data) — work_order_number: WO-{timestamp}
- updateWorkOrder(id, data) — triggers recomputeAssetAnalytics if status='completed'
- getMaintenanceEvents(assetId), createMaintenanceEvent(data)

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
GEMINI_TIMEOUT_MS        Default: 30000
GEMINI_RETRY_COUNT       Default: 1
GEMINI_MAX_COMPLETION_TOKENS  Default: 900
CHAT_DEBUG_PROVIDER_FLOW "true" to enable debug logging in orchestrator
```

---

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

- Do not use localStorage or sessionStorage (except the existing offline queue in technician-queue.ts)
- Do not import recharts — it is not installed
- Do not add gradients to visualizations — flat colors only (CSS variables)
- Do not add decorative orbs, blur effects, or glassmorphism
- Do not use useEffect for initial data fetching in server components
- Do not create a Supabase client outside of src/lib/supabase/
- Do not modify seed files (supabase/seed/)
- Do not modify migrations 00001–00035; next migration is 00036
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
