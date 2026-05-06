-- Migration 00014: RLS policies and refresh pipeline for MEMIS 2.0 additions

-- =============================================================================
-- Enable RLS on newly introduced tables
-- =============================================================================
ALTER TABLE memis_lookup_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_readiness_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_action_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE repeat_repair_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workload_capacity_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_sync_events ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS policies
-- =============================================================================

-- MEMIS lookup dictionary
CREATE POLICY select_memis_lookup_values ON memis_lookup_values FOR SELECT TO authenticated USING (true);
CREATE POLICY manage_memis_lookup_values ON memis_lookup_values FOR ALL TO authenticated USING (auth_user_has_role('admin'));

-- Procurement tracking
CREATE POLICY select_procurement_requests ON procurement_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY insert_procurement_requests ON procurement_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth_user_has_role('admin')
    OR auth_user_has_role('technician')
    OR auth_user_has_role('store_user')
    OR auth_user_has_role('department_user')
  );
CREATE POLICY update_procurement_requests ON procurement_requests FOR UPDATE TO authenticated
  USING (
    auth_user_has_role('admin')
    OR auth_user_has_role('technician')
    OR auth_user_has_role('store_user')
  );
CREATE POLICY delete_procurement_requests ON procurement_requests FOR DELETE TO authenticated
  USING (auth_user_has_role('admin'));

-- Decision-support result tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'equipment_health_snapshots',
        'clinical_readiness_snapshots',
        'triage_action_queue',
        'repeat_repair_flags',
        'escalation_rules',
        'escalation_events',
        'workload_capacity_snapshots',
        'inspection_templates'
    ] LOOP
        EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', 'select_' || tbl, tbl);
        EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (auth_user_has_role(''admin'') OR auth_user_has_role(''technician''))', 'manage_' || tbl, tbl);
    END LOOP;
END $$;

-- Offline sync telemetry
CREATE POLICY select_offline_sync_events ON offline_sync_events FOR SELECT TO authenticated USING (true);
CREATE POLICY insert_offline_sync_events ON offline_sync_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY update_offline_sync_events ON offline_sync_events FOR UPDATE TO authenticated
  USING (auth_user_has_role('admin') OR auth_user_has_role('technician'));

-- =============================================================================
-- Snapshot refresh function for decision-support center
-- =============================================================================
CREATE OR REPLACE FUNCTION refresh_decision_support_snapshots(snapshot_dt DATE DEFAULT CURRENT_DATE)
RETURNS VOID AS $$
BEGIN
  -- Equipment health snapshots
  WITH latest_reliability AS (
      SELECT DISTINCT ON (asset_id)
          asset_id,
          COALESCE(availability_ratio, 0.92) AS availability_ratio
      FROM equipment_reliability_metrics
      ORDER BY asset_id, computed_at DESC
  ),
  latest_pm AS (
      SELECT DISTINCT ON (asset_id)
          asset_id,
          COALESCE(pmc_percentage, 80) AS pmc_percentage
      FROM pm_compliance_metrics
      WHERE asset_id IS NOT NULL
      ORDER BY asset_id, computed_at DESC
  ),
  latest_risk AS (
      SELECT DISTINCT ON (asset_id)
          asset_id,
          COALESCE(rpn, 120) AS rpn
      FROM equipment_risk_scores
      ORDER BY asset_id, assessed_at DESC
  ),
  active_flag_counts AS (
      SELECT asset_id, COUNT(*)::INT AS open_flags
      FROM recommendation_flags
      WHERE is_acknowledged = false
      GROUP BY asset_id
  )
  INSERT INTO equipment_health_snapshots (
      asset_id,
      health_score,
      reliability_component,
      pm_component,
      risk_component,
      status_component,
      explanation,
      snapshot_date
  )
  SELECT
      e.id AS asset_id,
      GREATEST(
          1,
          ROUND((
              COALESCE(r.availability_ratio, 0.92) * 35
              + (COALESCE(p.pmc_percentage, 80) / 100.0) * 25
              + (1 - LEAST(0.35, COALESCE(k.rpn, 120) / 1000.0)) * 25
              + (1 - CASE
                  WHEN e.condition = 'functional' THEN 0
                  WHEN e.condition = 'needs_repair' THEN 0.15
                  ELSE 0.30
                END
                - LEAST(0.25, COALESCE(f.open_flags, 0) * 0.05)) * 15
          )::NUMERIC, 2)
      ) AS health_score,
      ROUND((COALESCE(r.availability_ratio, 0.92) * 100)::NUMERIC, 2) AS reliability_component,
      ROUND(COALESCE(p.pmc_percentage, 80)::NUMERIC, 2) AS pm_component,
      ROUND(COALESCE(k.rpn, 120)::NUMERIC, 2) AS risk_component,
      ROUND(
        ((1 - CASE
            WHEN e.condition = 'functional' THEN 0
            WHEN e.condition = 'needs_repair' THEN 0.15
            ELSE 0.30
          END) * 100)::NUMERIC, 2
      ) AS status_component,
      jsonb_build_object(
          'availability', ROUND((COALESCE(r.availability_ratio, 0.92) * 100)::NUMERIC, 2),
          'pmc_percentage', ROUND(COALESCE(p.pmc_percentage, 80)::NUMERIC, 2),
          'rpn', ROUND(COALESCE(k.rpn, 120)::NUMERIC, 2),
          'open_flags', COALESCE(f.open_flags, 0),
          'condition', e.condition
      ) AS explanation,
      snapshot_dt
  FROM equipment_assets e
  LEFT JOIN latest_reliability r ON r.asset_id = e.id
  LEFT JOIN latest_pm p ON p.asset_id = e.id
  LEFT JOIN latest_risk k ON k.asset_id = e.id
  LEFT JOIN active_flag_counts f ON f.asset_id = e.id
  WHERE e.deleted_at IS NULL
  ON CONFLICT (asset_id, snapshot_date) DO UPDATE
    SET health_score = EXCLUDED.health_score,
        reliability_component = EXCLUDED.reliability_component,
        pm_component = EXCLUDED.pm_component,
        risk_component = EXCLUDED.risk_component,
        status_component = EXCLUDED.status_component,
        explanation = EXCLUDED.explanation;

  -- Department readiness snapshots (essential equipment = high/critical categories)
  INSERT INTO clinical_readiness_snapshots (
      department_id,
      readiness_score,
      essential_total,
      essential_functional,
      details,
      snapshot_date
  )
  SELECT
      d.id,
      CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND((SUM(CASE WHEN e.condition = 'functional' AND e.status = 'active' THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
      END AS readiness_score,
      COUNT(*)::INT AS essential_total,
      SUM(CASE WHEN e.condition = 'functional' AND e.status = 'active' THEN 1 ELSE 0 END)::INT AS essential_functional,
      jsonb_build_object(
          'functional_today', SUM(CASE WHEN e.condition = 'functional' AND e.status = 'active' THEN 1 ELSE 0 END)::INT,
          'essential_total', COUNT(*)::INT
      ) AS details,
      snapshot_dt
  FROM departments d
  JOIN equipment_assets e ON e.department_id = d.id AND e.deleted_at IS NULL
  JOIN equipment_categories c ON c.id = e.category_id
  WHERE c.criticality_level IN ('high', 'critical')
  GROUP BY d.id
  ON CONFLICT (department_id, snapshot_date) DO UPDATE
    SET readiness_score = EXCLUDED.readiness_score,
        essential_total = EXCLUDED.essential_total,
        essential_functional = EXCLUDED.essential_functional,
        details = EXCLUDED.details;

  -- Workload capacity snapshots
  INSERT INTO workload_capacity_snapshots (
      assignee_id,
      snapshot_date,
      open_assignments,
      overdue_assignments,
      estimated_hours,
      capacity_hours,
      backlog_delta
  )
  SELECT
      wo.assigned_to AS assignee_id,
      snapshot_dt,
      COUNT(*)::INT AS open_assignments,
      SUM(CASE WHEN wo.priority IN ('high', 'critical') THEN 1 ELSE 0 END)::INT AS overdue_assignments,
      COALESCE(SUM(wo.estimated_hours), 0)::NUMERIC(8,2) AS estimated_hours,
      8.00::NUMERIC(8,2) AS capacity_hours,
      (COALESCE(SUM(wo.estimated_hours), 0) - 8.00)::NUMERIC(8,2) AS backlog_delta
  FROM work_orders wo
  WHERE wo.assigned_to IS NOT NULL
    AND wo.status IN ('open', 'assigned', 'in_progress', 'on_hold')
  GROUP BY wo.assigned_to
  ON CONFLICT (assignee_id, snapshot_date) DO UPDATE
    SET open_assignments = EXCLUDED.open_assignments,
        overdue_assignments = EXCLUDED.overdue_assignments,
        estimated_hours = EXCLUDED.estimated_hours,
        capacity_hours = EXCLUDED.capacity_hours,
        backlog_delta = EXCLUDED.backlog_delta;

  -- Refresh open triage queue for today
  DELETE FROM triage_action_queue
  WHERE generated_at::DATE = snapshot_dt AND status = 'open';

  WITH latest_risk AS (
      SELECT DISTINCT ON (asset_id) asset_id, COALESCE(rpn, 120) AS rpn
      FROM equipment_risk_scores
      ORDER BY asset_id, assessed_at DESC
  ),
  latest_pm AS (
      SELECT DISTINCT ON (asset_id) asset_id, COALESCE(pmc_percentage, 80) AS pmc_percentage
      FROM pm_compliance_metrics
      WHERE asset_id IS NOT NULL
      ORDER BY asset_id, computed_at DESC
  ),
  latest_replacement AS (
      SELECT DISTINCT ON (asset_id) asset_id, COALESCE(rank, 999) AS rank
      FROM replacement_priority_scores
      ORDER BY asset_id, computed_at DESC
  ),
  ranked_flags AS (
      SELECT
          asset_id,
          flag_type,
          CASE WHEN severity = 'critical' THEN 45 WHEN severity = 'high' THEN 25 WHEN severity = 'medium' THEN 10 ELSE 4 END::NUMERIC AS severity_score,
          ROW_NUMBER() OVER (
              PARTITION BY asset_id
              ORDER BY
                  CASE WHEN severity = 'critical' THEN 45 WHEN severity = 'high' THEN 25 WHEN severity = 'medium' THEN 10 ELSE 4 END DESC,
                  CASE flag_type
                      WHEN 'urgent_maintenance' THEN 1
                      WHEN 'recurring_failure' THEN 2
                      WHEN 'replacement_candidate' THEN 3
                      WHEN 'high_risk' THEN 4
                      WHEN 'low_availability' THEN 5
                      WHEN 'overdue_pm' THEN 6
                      WHEN 'calibrate_soon' THEN 7
                      WHEN 'part_shortage' THEN 8
                      WHEN 'prioritize_pm' THEN 9
                      ELSE 99
                  END ASC
          ) AS rn
      FROM recommendation_flags
      WHERE is_acknowledged = false
  ),
  active_flags AS (
      SELECT
          asset_id,
          COUNT(*)::INT AS cnt,
          SUM(severity_score)::NUMERIC AS sev_score,
          COALESCE(MAX(flag_type) FILTER (WHERE rn = 1), 'none') AS top_flag
      FROM ranked_flags
      GROUP BY asset_id
  ),
  triage AS (
      SELECT
          e.id AS asset_id,
          ROUND(
            COALESCE(f.sev_score, 0)
            + LEAST(40, COALESCE(r.rpn, 120) / 15.0)
            + GREATEST(0, (80 - COALESCE(p.pmc_percentage, 80)) / 2.0)
            + GREATEST(0, 20 - COALESCE(rep.rank, 999))
          , 2) AS priority_score,
          COALESCE(f.top_flag, 'none') AS top_flag,
          COALESCE(rep.rank, 999) AS replacement_rank,
          COALESCE(r.rpn, 120) AS rpn,
          COALESCE(p.pmc_percentage, 80) AS pmc_percentage,
          jsonb_build_array(
            CONCAT('open_flags=', COALESCE(f.cnt, 0)),
            CONCAT('top_flag=', COALESCE(f.top_flag, 'none')),
            CONCAT('rpn=', COALESCE(r.rpn, 120)),
            CONCAT('pmc=', ROUND(COALESCE(p.pmc_percentage, 80)::NUMERIC, 1)),
            CONCAT('replacement_rank=', COALESCE(rep.rank, 999))
          ) AS rationale
      FROM equipment_assets e
      LEFT JOIN latest_risk r ON r.asset_id = e.id
      LEFT JOIN latest_pm p ON p.asset_id = e.id
      LEFT JOIN latest_replacement rep ON rep.asset_id = e.id
      LEFT JOIN active_flags f ON f.asset_id = e.id
      WHERE e.deleted_at IS NULL
  )
  INSERT INTO triage_action_queue (asset_id, priority_score, recommendation, rationale, status, generated_at)
  SELECT
      t.asset_id,
      t.priority_score,
      CASE
          WHEN t.top_flag = 'urgent_maintenance' THEN 'Create urgent corrective work order'
          WHEN t.top_flag = 'recurring_failure' THEN 'Schedule diagnostic for recurring failures'
          WHEN t.top_flag = 'replacement_candidate' OR t.replacement_rank <= 5 THEN 'Review replacement priority plan'
          WHEN t.top_flag = 'calibrate_soon' THEN 'Schedule calibration or QA'
          WHEN t.top_flag = 'overdue_pm' THEN 'Schedule overdue preventive maintenance'
          WHEN t.top_flag = 'part_shortage' THEN 'Expedite spare part or procurement action'
          WHEN t.top_flag = 'high_risk' OR t.rpn >= 200 THEN 'Schedule risk mitigation'
          WHEN t.top_flag = 'low_availability' THEN 'Investigate availability loss'
          WHEN t.top_flag IN ('warranty_expiring', 'contract_expiring') THEN 'Review service coverage and renewal plan'
          WHEN t.priority_score >= 75 THEN 'Immediate intervention and escalation'
          WHEN t.priority_score >= 45 THEN 'Schedule within 24-48 hours'
          ELSE 'Monitor and plan preventive action'
      END AS recommendation,
      t.rationale,
      'open',
      now()
  FROM triage t
  ORDER BY t.priority_score DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
