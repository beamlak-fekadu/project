# CLAUDE.md — BMERMS Project Intelligence

Last updated: 2026-05-09 (session 8)
Branch: BMERMS_V4
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
equipment asset management and decision-support system built for Yekatit-12 Hospital
Medical College, Addis Ababa, Ethiopia. BSc thesis project for the School of Biomedical
Engineering at Addis Ababa University.

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
- Step 14: Supabase TypeScript types generated (src/types/supabase.ts)
- Step 15: Login page shows "Yekatit-12 Hospital Medical College"
- Reliability metrics (2026-05-05, migrations 00034–00035): one row per asset in equipment_reliability_metrics; idx_reliability_metrics_asset_unique; recompute upserts on asset_id; Command Center triage detail uses availability_ratio (DB column), not a misnamed percentage field.
- Command Center redesign (2026-05-09, session 6): Full redesign for developer/admin/bme_head roles. New sections: live header with 10s auto-refresh, 10-card summary strip, critical action strip (top 6 scored cross-category actions), 8-tab categorized triage center (corrective/calibration/PM/stock/installation/replacement/procurement/training), technician workload (green/amber/red), improved risk distribution (summarizeRiskDrivers instead of raw JSON), improved replacement watchlist (buildReplacementReason). Other roles keep existing CommandCenterInteractive layout. No scoring-lab or sensitivity sliders on this page. No DB migrations required. Developer scoring lab deferred to /developer/scoring-lab (future route).
- Command Center action accuracy (2026-05-09, session 8): Row-level actions now follow exact-record semantics: existing work orders open `/maintenance/work-orders/[id]` with state-aware action queries, existing requests open `/maintenance/requests/[id]`, PM uses `/pm/schedules/[id]`, procurement uses `/command/drilldown/procurement/[id]`, and replacement evidence uses `/command/drilldown/replacement/[assetId]`. Needs Request and stock actions open prefilled creation flows with `source=command-center`. Summary cards use `/command/drilldown/[type]` and counts share the same fetchers as triage/drilldowns. Risk Watch can be acknowledged via `command_center_acknowledgements` signal hashes and reappears when the signal changes. Training triage is hidden from the BME Head control room pending a future Department Head workflow.

- Audit remediation (2026-05-05, migrations 00027–00033): full recompute backfill on deploy; audit performed_by/details + acknowledgeFlag profile FK; constraints (low_stock flag_type, PMC grain unique + dedupe, partial unique asset_code for active rows, non-negative repair/downtime hours); hot-path indexes; read-model views refreshed with deleted_at filters and COALESCE; dropped unused repeat_repair_flags + equipment_locations; chat_sessions column equipment_id → asset_id

IN PROGRESS:
- Step 8:  Recurring failure count intentionally remains at 1 seeded asset because the thesis
           threshold is failureCount >= 4; this is documented in the UI and QA notes

NOT STARTED:
- Step 11: BME usability evaluation instrument design
- Step 12: Usability testing with BMEs at Yekatit 12
- Step 13: MEMIS comparison section for thesis

---

## Canonical route map — all 30+ routes

### Decision Support
  /command                    Unified decision-support home (all roles)
  /command/health             Asset health scores — admin only, not in sidebar
  /command/triage             Full triage queue — confirmed working, real data, 80 assets after dedup
  /command/drilldown/[type]   Summary-card drilldowns using Command Center shared fetchers
  /command/drilldown/procurement/[id]  Exact procurement request evidence/status view
  /command/drilldown/replacement/[assetId]  Exact replacement evidence view

### Equipment (Biomedical Asset Management)
  /equipment                  Canonical equipment list — canonical URL for biomedical assets
  /equipment/new              Create asset
  /equipment/[id]             Asset detail (reliability, risk, maintenance history, flags)
  /equipment/[id]/edit        Edit asset
  /inventory                  Deprecated redirect alias → /equipment
  /inventory/new              Deprecated redirect alias → /equipment/new
  /inventory/[id]             Deprecated redirect alias → /equipment/[id]
  /inventory/[id]/edit        Deprecated redirect alias → /equipment/[id]/edit

### Work
  /maintenance                Maintenance requests + work order overview
  /maintenance/requests/new   Create maintenance request
  /maintenance/requests/[id]  Request detail
  /maintenance/work-orders/new   Create work order
  /maintenance/work-orders/[id]  Work order detail
  /pm                         Preventive maintenance plans + schedules
  /pm/plans/new               Create PM plan
  /pm/schedules/[id]          PM schedule detail + checklist
  /calibration                Calibration records, requests, upcoming due
  /work-orders                All open work orders (cross-module view)

### Inventory & Logistics
  /spare-parts                Spare parts management
  /logistics                  Stock levels, receipts, issues, low-stock alerts
  /procurement                Procurement requests + status pipeline

### People
  /training                   Training requests, sessions, attendance
  /users                      User management + role assignment (admin only)

### Lifecycle
  /replacement                Replacement priority index + recommendations
  /disposal                   Disposal requests + disposed assets

### Support
  /helpdesk                   Help/support page
  /alerts                     Active recommendation flags
  /chatbot                    BMERMS AI Copilot (all roles)
  /documents                  Equipment document library
  /requests                   All open requests (maintenance + training + disposal + calibration)
  /installation               Installation records + commissioning

### Reports
  /reports                    Report type selector
  /reports/[type]             Equipment / Maintenance / PM / Calibration / Training /
                              SpareParts / Disposal reports with PDF + CSV export

### Administration (admin only)
  /audit                      Audit log viewer with filters
  /security                   Security settings (RLS config, bucket permissions)
  /settings                   Reference data management (departments, categories, etc.)

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

---

## Known deferred issues

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

6.  Reliability and PM Compliance cards show "No data" on asset detail — check that column
    name on join is asset_id (not equipment_id or equipment_asset_id) per migration 00010.

7.  RESOLVED (2026-05-04, migration 00024) — All 8 departments now have pm_compliance_metrics.
    PM plans, schedules (2024-2025), completions, and quarterly compliance rows added for
    Inpatient Ward (71%), Pharmacy (71%), and Radiology (82%). /pm department chart shows 8/8.

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

12. Institution name in seed — currently "St. Peter's Specialized Hospital", should be
    "Yekatit-12 Hospital" (fix pending, low priority).

13. RESOLVED (2026-05-04, migration 00023) — compute_replacement_priority_scores_all() implemented.
    replacement_priority_scores now has 80 computed rows (weights_profile_id IS NULL) plus the 8
    original seed rows (weights_profile_id = 'b7000001-...'). getReplacementPriorities() in
    analytics.service.ts filters to computed rows only (.is('weights_profile_id', null)).
    /replacement page now ranks all 80 active assets.

14. staff_training_records.staff_user_id → clearer column name deferred: seed files reference
    staff_user_id; renaming would require coordinated seed + app change (do not edit seed ad hoc).

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

NEVER modify 00001–00035. Next migration must be 00036.
