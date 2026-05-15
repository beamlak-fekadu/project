-- Migration 00044: Expose asset_id and department_id from operational views
--
-- Root cause: v_open_work_orders did not expose asset_id or department_id,
-- so all department-filtered queries and viewer WO components returned 0 rows.
-- v_overdue_pm lacked department_id for the same reason.
--
-- These are non-breaking additions: existing queries that don't request the
-- new columns continue to work unchanged.

-- ── v_open_work_orders ────────────────────────────────────────────────────────
-- Adds: asset_id (FK → equipment_assets, enables embedded resource queries)
--        department_id (from equipment_assets, enables .eq('department_id', ...) filter)
-- Note: work_orders table has no scheduled_date column; do NOT add one.

CREATE OR REPLACE VIEW v_open_work_orders AS
SELECT
  wo.id,
  wo.work_order_number,
  wo.status,
  wo.priority,
  wo.work_type,
  wo.created_at,
  wo.started_at,
  wo.asset_id,
  ea.department_id,
  ea.asset_code,
  ea.name          AS asset_name,
  d.name           AS department_name,
  p.full_name      AS assigned_to_name
FROM work_orders wo
JOIN equipment_assets ea ON wo.asset_id = ea.id AND ea.deleted_at IS NULL
LEFT JOIN departments   d ON ea.department_id = d.id
LEFT JOIN profiles      p ON wo.assigned_to   = p.id
WHERE wo.status NOT IN ('completed', 'canceled');

-- ── v_overdue_pm ──────────────────────────────────────────────────────────────
-- Adds: department_id (from equipment_assets, enables .eq('department_id', ...) filter)
-- Keeps all columns from migration 00042 exactly.

CREATE OR REPLACE VIEW v_overdue_pm AS
SELECT
    ps.id,
    ps.asset_id,
    ps.scheduled_date,
    ps.status,
    ea.department_id,
    pp.name          AS plan_name,
    ea.asset_code,
    ea.name          AS asset_name,
    d.name           AS department_name,
    ec.name          AS category_name,
    ec.criticality_level,
    p.full_name      AS assigned_to_name,
    CURRENT_DATE - ps.scheduled_date AS days_overdue
FROM pm_schedules ps
JOIN pm_plans pp        ON ps.plan_id  = pp.id
JOIN equipment_assets ea ON ps.asset_id = ea.id
LEFT JOIN departments   d  ON ea.department_id = d.id
LEFT JOIN equipment_categories ec ON ea.category_id = ec.id
LEFT JOIN profiles      p  ON ps.assigned_to   = p.id
WHERE ps.status IN ('overdue', 'in_progress')
   OR (ps.status = 'scheduled' AND ps.scheduled_date < CURRENT_DATE)
ORDER BY ps.scheduled_date ASC;
