## Compact DB Redesign Plan (55 objects -> ~20 tables, Core Ops v1)

### Summary
- Current DB has **49 tables + 6 views** (likely why it feels like “55”); too fragmented for a final-year MVP.
- Target is a **big-bang reset** to a compact schema of **20 tables**, centered on core operations only.
- Scope basis is **proposal-first + current app reality**, with non-core modules hidden for phase 2.

### Key Changes
- **Target table set (20)**
1. `departments` (keep)
2. `roles` (keep)
3. `profiles` (keep)
4. `user_roles` (keep)
5. `audit_logs` (keep)
6. `equipment_categories` (keep)
7. `business_partners` (new; merge `manufacturers` + `vendors` + `suppliers`, with `partner_type`)
8. `equipment_models` (keep, FK to `equipment_categories` + optional `business_partners`)
9. `code_sets` (new; merge `failure_codes` + `maintenance_action_codes` + `calibration_types` + `status_labels` + optional risk labels)
10. `pm_templates` (keep, simplified)
11. `equipment_assets` (keep; absorb installation summary fields)
12. `equipment_documents` (keep)
13. `asset_events` (new; merge `equipment_locations` + `asset_status_history` + installation/event timeline)
14. `maintenance_requests` (keep)
15. `work_orders` (expanded; absorb `maintenance_events` + `downtime_logs` fields)
16. `pm_plans` (keep)
17. `pm_tasks` (new; merge `pm_schedules` + `pm_checklists` + `pm_completions`)
18. `calibration_jobs` (new; merge `calibration_requests` + `calibration_records` + `calibration_certificates`)
19. `spare_parts` (keep)
20. `inventory_movements` (new; merge `stock_receipts` + `stock_issues` + part consumption linkage)

- **Dropped from v1 (phase 2)**
- Training module tables (`training_requests`, `training_sessions`, `staff_training_records`, `equipment_training_records`)
- Disposal module tables (`disposal_requests`, `disposed_assets`)
- Persisted analytics tables (`equipment_reliability_metrics`, `equipment_risk_scores`, `pm_compliance_metrics`, `equipment_performance_scores`, `replacement_priority_scores`, `recommendation_flags`)

- **Analytics strategy**
- Reliability/risk/PMC/performance/replacement are computed on demand via SQL views/functions/RPC, not stored in dedicated tables.

- **App/interface impact**
- Update service-layer queries to new table names and merged shapes.
- Replace settings/reference CRUD from many lookup tables to `code_sets` + `business_partners`.
- Hide deferred modules from sidebar/routes (training, disposal, advanced analytics pages) instead of compatibility mode.

### Migration + Cutover (Big-Bang)
1. Create a new compact-schema migration set with 20 tables, constraints, indexes, triggers, and revised RLS.
2. Build one-time data migration SQL mapping old -> new (including merge transforms and enum/code normalization).
3. Re-seed compact master data (`departments`, `equipment_categories`, `roles`, `code_sets`, templates).
4. Switch app services/pages to compact schema and remove old table dependencies.
5. Recreate required dashboard/report views on compact model.
6. Validate, then drop legacy tables and old RLS/policies in the same release window.

### Test Plan
- Schema validation: FK integrity, unique constraints, check constraints, RLS policy coverage.
- Data migration validation: row-count reconciliation and spot checks for merged entities (partners, PM tasks, calibration jobs, inventory movements).
- Core route smoke tests: inventory, documents, installation, maintenance/work orders, PM, calibration, spare parts, users/roles, dashboard, reports.
- Regression checks: create/update/delete flows in each kept module; stock in/out correctness; PM overdue and open work-order views.
- Performance checks: key list pages under realistic seeded data remain responsive.

### Assumptions
- “About 20” means acceptable range is around **18-24**, with this plan targeting exactly 20.
- Core operations are the v1 deliverable; deferred modules are intentionally hidden, not kept via compatibility layers.
- Proposal is primary scope source, but this plan also preserves currently implemented core app workflows.
- Because local tooling couldn’t parse the PDFs directly, proposal alignment is based on your stated priority plus existing module structure; if any proposal-mandatory feature is missing, it should be added before implementation starts.
