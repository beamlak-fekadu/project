-- Migration 00036: FMEA risk assessment engine
-- Makes Severity, Occurrence, and Detectability explicit, explainable, and refreshed.

ALTER TABLE equipment_risk_scores
  ADD COLUMN IF NOT EXISTS explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS assignment_method TEXT NOT NULL DEFAULT 'computed',
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS override_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source_version TEXT NOT NULL DEFAULT 'fmea_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'equipment_risk_scores_assignment_method_check'
      AND conrelid = 'equipment_risk_scores'::regclass
  ) THEN
    ALTER TABLE equipment_risk_scores
      ADD CONSTRAINT equipment_risk_scores_assignment_method_check
      CHECK (assignment_method IN ('computed', 'manual_override', 'seeded_demo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_risk_scores_asset_assessed
  ON equipment_risk_scores(asset_id, assessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_scores_assignment_method
  ON equipment_risk_scores(assignment_method);

CREATE OR REPLACE FUNCTION fn_classify_risk_level(rpn INTEGER)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE
    WHEN COALESCE(rpn, 0) >= 500 THEN 'critical'
    WHEN COALESCE(rpn, 0) >= 200 THEN 'high'
    WHEN COALESCE(rpn, 0) >= 80 THEN 'medium'
    ELSE 'low'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_compute_fmea_risk_for_asset(asset_uuid UUID)
RETURNS TABLE (
  severity INTEGER,
  occurrence INTEGER,
  detectability INTEGER,
  explanation JSONB
) AS $$
DECLARE
  v_asset RECORD;
  v_category_score INTEGER := 4;
  v_condition_severity INTEGER := 1;
  v_department_score INTEGER := 1;
  v_failure_events INTEGER := 0;
  v_corrective_work_orders INTEGER := 0;
  v_failure_count INTEGER := 0;
  v_age_years INTEGER := 0;
  v_recurring_failure BOOLEAN := false;
  v_pm_overdue_days INTEGER;
  v_pmc NUMERIC;
  v_pm_scheduled INTEGER := 0;
  v_pm_completed INTEGER := 0;
  v_has_pm_plan BOOLEAN := false;
  v_calibration_relevant BOOLEAN := false;
  v_calibration_overdue_days INTEGER;
  v_last_calibration_result TEXT;
  v_has_recent_control BOOLEAN := false;
  v_detectability_score INTEGER := 2;
  v_severity_drivers TEXT[] := ARRAY[]::TEXT[];
  v_occurrence_drivers TEXT[] := ARRAY[]::TEXT[];
  v_detectability_drivers TEXT[] := ARRAY['baseline routine controls -> 2'];
BEGIN
  SELECT
    e.id,
    e.name AS asset_name,
    e.condition,
    e.status,
    e.installation_date,
    e.purchase_date,
    c.name AS category_name,
    c.criticality_level,
    d.name AS department_name,
    d.code AS department_code
  INTO v_asset
  FROM equipment_assets e
  LEFT JOIN equipment_categories c ON c.id = e.category_id
  LEFT JOIN departments d ON d.id = e.department_id
  WHERE e.id = asset_uuid
    AND e.deleted_at IS NULL
    AND e.status = 'active';

  IF v_asset.id IS NULL THEN
    RETURN;
  END IF;

  v_category_score := CASE v_asset.criticality_level
    WHEN 'critical' THEN 9
    WHEN 'high' THEN 8
    WHEN 'medium' THEN 5
    WHEN 'low' THEN 3
    ELSE 4
  END;
  v_severity_drivers := array_append(
    v_severity_drivers,
    FORMAT('category criticality %s -> %s', COALESCE(v_asset.criticality_level, 'unknown'), v_category_score)
  );

  v_condition_severity := CASE v_asset.condition
    WHEN 'non_functional' THEN 7
    WHEN 'needs_repair' THEN 6
    WHEN 'under_maintenance' THEN 5
    ELSE 1
  END;
  IF v_condition_severity > 1 THEN
    v_severity_drivers := array_append(
      v_severity_drivers,
      FORMAT('current condition %s -> at least %s', v_asset.condition, v_condition_severity)
    );
  END IF;

  IF lower(COALESCE(v_asset.department_name, '') || ' ' || COALESCE(v_asset.department_code, '')) SIMILAR TO
     '%(icu|intensive care|emergency|operating|theater|theatre|neonatal|nicu|delivery|sterilization|cssd)%' THEN
    v_department_score := 8;
  ELSIF lower(COALESCE(v_asset.department_name, '') || ' ' || COALESCE(v_asset.department_code, '')) SIMILAR TO
     '%(laboratory|lab|radiology|imaging)%' THEN
    v_department_score := 6;
  ELSIF lower(COALESCE(v_asset.department_name, '') || ' ' || COALESCE(v_asset.department_code, '')) SIMILAR TO
     '%(ward|outpatient|pharmacy)%' THEN
    v_department_score := 4;
  END IF;
  IF v_department_score > 1 THEN
    v_severity_drivers := array_append(
      v_severity_drivers,
      FORMAT('department %s -> at least %s', COALESCE(v_asset.department_name, 'unknown'), v_department_score)
    );
  END IF;

  severity := LEAST(10, GREATEST(1, v_category_score, v_condition_severity, v_department_score));

  SELECT COUNT(*)::INT
  INTO v_failure_events
  FROM maintenance_events me
  WHERE me.asset_id = asset_uuid
    AND me.event_type IN ('corrective', 'emergency')
    AND COALESCE(me.failure_date, me.completion_date, me.created_at::DATE) >= CURRENT_DATE - INTERVAL '365 days';

  SELECT COUNT(*)::INT
  INTO v_corrective_work_orders
  FROM work_orders wo
  WHERE wo.asset_id = asset_uuid
    AND wo.work_type = 'corrective'
    AND wo.status = 'completed'
    AND COALESCE(wo.completed_at::DATE, wo.updated_at::DATE, wo.created_at::DATE) >= CURRENT_DATE - INTERVAL '365 days';

  v_failure_count := GREATEST(v_failure_events, v_corrective_work_orders);
  occurrence := CASE
    WHEN v_failure_count >= 6 THEN 9
    WHEN v_failure_count >= 5 THEN 8
    WHEN v_failure_count >= 3 THEN 6
    WHEN v_failure_count >= 1 THEN 4
    ELSE 2
  END;
  v_occurrence_drivers := array_append(
    v_occurrence_drivers,
    FORMAT('%s failures/corrective completions in last 365 days -> %s', v_failure_count, occurrence)
  );

  v_age_years := GREATEST(
    0,
    FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, COALESCE(v_asset.installation_date, v_asset.purchase_date, CURRENT_DATE))))::INT
  );
  IF v_age_years >= 12 THEN
    occurrence := GREATEST(occurrence, 6);
    v_occurrence_drivers := array_append(v_occurrence_drivers, FORMAT('equipment age %s years -> at least 6', v_age_years));
  ELSIF v_age_years >= 10 THEN
    occurrence := GREATEST(occurrence, 5);
    v_occurrence_drivers := array_append(v_occurrence_drivers, FORMAT('equipment age %s years -> at least 5', v_age_years));
  ELSIF v_age_years >= 7 THEN
    occurrence := GREATEST(occurrence, 4);
    v_occurrence_drivers := array_append(v_occurrence_drivers, FORMAT('equipment age %s years -> at least 4', v_age_years));
  END IF;

  IF v_asset.condition = 'non_functional' THEN
    occurrence := GREATEST(occurrence, 6);
    v_occurrence_drivers := array_append(v_occurrence_drivers, 'current condition non_functional -> at least 6');
  ELSIF v_asset.condition = 'needs_repair' THEN
    occurrence := GREATEST(occurrence, 5);
    v_occurrence_drivers := array_append(v_occurrence_drivers, 'current condition needs_repair -> at least 5');
  ELSIF v_asset.condition = 'under_maintenance' THEN
    occurrence := GREATEST(occurrence, 4);
    v_occurrence_drivers := array_append(v_occurrence_drivers, 'current condition under_maintenance -> at least 4');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM recommendation_flags rf
    WHERE rf.asset_id = asset_uuid
      AND rf.flag_type = 'recurring_failure'
      AND rf.is_acknowledged = false
  ) INTO v_recurring_failure;

  IF v_recurring_failure THEN
    occurrence := GREATEST(occurrence, 7);
    v_occurrence_drivers := array_append(v_occurrence_drivers, 'active recurring_failure flag -> at least 7');
  END IF;

  occurrence := LEAST(10, GREATEST(1, occurrence));

  SELECT MAX((CURRENT_DATE - ps.scheduled_date))::INT
  INTO v_pm_overdue_days
  FROM pm_schedules ps
  WHERE ps.asset_id = asset_uuid
    AND ps.status IN ('scheduled', 'overdue', 'in_progress')
    AND ps.scheduled_date < CURRENT_DATE;

  SELECT EXISTS (
    SELECT 1
    FROM pm_plans pp
    WHERE pp.asset_id = asset_uuid
      AND pp.is_active = true
  ) INTO v_has_pm_plan;

  SELECT pmc_percentage
  INTO v_pmc
  FROM pm_compliance_metrics pcm
  WHERE pcm.asset_id = asset_uuid
  ORDER BY pcm.computed_at DESC
  LIMIT 1;

  IF v_pmc IS NULL THEN
    SELECT
      COUNT(*)::INT,
      SUM(CASE WHEN ps.status = 'completed' THEN 1 ELSE 0 END)::INT
    INTO v_pm_scheduled, v_pm_completed
    FROM pm_schedules ps
    WHERE ps.asset_id = asset_uuid
      AND ps.scheduled_date >= CURRENT_DATE - INTERVAL '365 days';

    IF v_pm_scheduled > 0 THEN
      v_pmc := ROUND((v_pm_completed::NUMERIC / v_pm_scheduled::NUMERIC) * 100, 2);
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM calibration_records cr WHERE cr.asset_id = asset_uuid
    UNION
    SELECT 1 FROM calibration_requests cq WHERE cq.asset_id = asset_uuid
  ) INTO v_calibration_relevant;

  IF v_calibration_relevant THEN
    SELECT
      CASE WHEN cr.next_due_date < CURRENT_DATE THEN (CURRENT_DATE - cr.next_due_date)::INT ELSE NULL END,
      cr.result
    INTO v_calibration_overdue_days, v_last_calibration_result
    FROM calibration_records cr
    WHERE cr.asset_id = asset_uuid
    ORDER BY cr.calibration_date DESC, cr.created_at DESC
    LIMIT 1;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM maintenance_events me
    WHERE me.asset_id = asset_uuid
      AND me.event_type IN ('preventive', 'inspection')
      AND COALESCE(me.completion_date, me.failure_date, me.created_at::DATE) >= CURRENT_DATE - INTERVAL '365 days'
    UNION
    SELECT 1
    FROM pm_completions pc
    JOIN pm_schedules ps ON ps.id = pc.schedule_id
    WHERE ps.asset_id = asset_uuid
      AND pc.completion_date >= CURRENT_DATE - INTERVAL '365 days'
    UNION
    SELECT 1
    FROM calibration_records cr
    WHERE cr.asset_id = asset_uuid
      AND cr.calibration_date >= CURRENT_DATE - INTERVAL '365 days'
  ) INTO v_has_recent_control;

  IF v_asset.condition IN ('non_functional', 'needs_repair') THEN
    v_detectability_score := v_detectability_score + 2;
    v_detectability_drivers := array_append(v_detectability_drivers, FORMAT('current condition %s -> +2', v_asset.condition));
  END IF;

  IF COALESCE(v_pm_overdue_days, 0) > 30 THEN
    v_detectability_score := v_detectability_score + 2;
    v_detectability_drivers := array_append(v_detectability_drivers, FORMAT('PM overdue by %s days -> +2', v_pm_overdue_days));
  ELSIF COALESCE(v_pm_overdue_days, 0) > 0 THEN
    v_detectability_score := v_detectability_score + 1;
    v_detectability_drivers := array_append(v_detectability_drivers, FORMAT('PM overdue by %s days -> +1', v_pm_overdue_days));
  END IF;

  IF COALESCE(v_calibration_overdue_days, 0) > 0 THEN
    v_detectability_score := v_detectability_score + 2;
    v_detectability_drivers := array_append(v_detectability_drivers, FORMAT('calibration overdue by %s days -> +2', v_calibration_overdue_days));
  ELSIF v_calibration_relevant AND EXISTS (
    SELECT 1
    FROM calibration_records cr
    WHERE cr.asset_id = asset_uuid
      AND cr.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  ) THEN
    v_detectability_score := v_detectability_score + 1;
    v_detectability_drivers := array_append(v_detectability_drivers, 'calibration due within 30 days -> +1');
  END IF;

  IF v_last_calibration_result = 'fail' THEN
    v_detectability_score := v_detectability_score + 2;
    v_detectability_drivers := array_append(v_detectability_drivers, 'last calibration result fail -> +2');
  ELSIF v_last_calibration_result = 'adjusted' THEN
    v_detectability_score := v_detectability_score + 1;
    v_detectability_drivers := array_append(v_detectability_drivers, 'last calibration result adjusted -> +1');
  END IF;

  IF v_pmc IS NOT NULL AND v_pmc < 50 THEN
    v_detectability_score := v_detectability_score + 2;
    v_detectability_drivers := array_append(v_detectability_drivers, FORMAT('PM compliance %s%% -> +2', ROUND(v_pmc, 1)));
  ELSIF v_pmc IS NOT NULL AND v_pmc < 80 THEN
    v_detectability_score := v_detectability_score + 1;
    v_detectability_drivers := array_append(v_detectability_drivers, FORMAT('PM compliance %s%% -> +1', ROUND(v_pmc, 1)));
  END IF;

  IF v_asset.criticality_level IN ('high', 'critical') AND NOT v_has_pm_plan THEN
    v_detectability_score := v_detectability_score + 1;
    v_detectability_drivers := array_append(v_detectability_drivers, 'no active PM plan for high/critical equipment -> +1');
  END IF;

  IF v_asset.criticality_level IN ('high', 'critical') AND NOT v_has_recent_control THEN
    v_detectability_score := v_detectability_score + 1;
    v_detectability_drivers := array_append(v_detectability_drivers, 'no recent inspection, PM, or calibration record for high/critical equipment -> +1');
  END IF;

  detectability := LEAST(10, GREATEST(1, v_detectability_score));

  explanation := jsonb_build_object(
    'severity', jsonb_build_object(
      'score', severity,
      'drivers', to_jsonb(v_severity_drivers),
      'category_criticality', v_asset.criticality_level,
      'department', v_asset.department_name,
      'condition', v_asset.condition
    ),
    'occurrence', jsonb_build_object(
      'score', occurrence,
      'drivers', to_jsonb(v_occurrence_drivers),
      'failure_count_365d', v_failure_count,
      'maintenance_event_failures_365d', v_failure_events,
      'corrective_work_orders_365d', v_corrective_work_orders,
      'age_years', v_age_years,
      'recurring_failure_flag', v_recurring_failure
    ),
    'detectability', jsonb_build_object(
      'score', detectability,
      'drivers', to_jsonb(v_detectability_drivers),
      'pm_overdue_days', v_pm_overdue_days,
      'pm_compliance', v_pmc,
      'calibration_relevant', v_calibration_relevant,
      'calibration_overdue_days', v_calibration_overdue_days,
      'last_calibration_result', v_last_calibration_result,
      'has_active_pm_plan', v_has_pm_plan,
      'has_recent_control_record', v_has_recent_control
    ),
    'rpn', severity * occurrence * detectability,
    'risk_level', fn_classify_risk_level(severity * occurrence * detectability),
    'computed_at', now(),
    'source_version', 'fmea_v1'
  );

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_refresh_fmea_risk_score_for_asset(asset_uuid UUID, force_recompute BOOLEAN DEFAULT false)
RETURNS UUID AS $$
DECLARE
  v_existing_id UUID;
  v_existing_method TEXT;
  v_severity INTEGER;
  v_occurrence INTEGER;
  v_detectability INTEGER;
  v_explanation JSONB;
BEGIN
  SELECT id, assignment_method
  INTO v_existing_id, v_existing_method
  FROM equipment_risk_scores
  WHERE asset_id = asset_uuid
  ORDER BY assessed_at DESC, id DESC
  LIMIT 1;

  IF v_existing_method = 'manual_override' AND NOT force_recompute THEN
    RETURN v_existing_id;
  END IF;

  SELECT fr.severity, fr.occurrence, fr.detectability, fr.explanation
  INTO v_severity, v_occurrence, v_detectability, v_explanation
  FROM fn_compute_fmea_risk_for_asset(asset_uuid) fr
  LIMIT 1;

  IF v_severity IS NULL THEN
    RETURN v_existing_id;
  END IF;

  IF v_existing_id IS NULL THEN
    INSERT INTO equipment_risk_scores (
      asset_id,
      severity,
      occurrence,
      detectability,
      assessed_by,
      assessed_at,
      notes,
      explanation,
      assignment_method,
      computed_at,
      source_version
    )
    VALUES (
      asset_uuid,
      v_severity,
      v_occurrence,
      v_detectability,
      NULL,
      now(),
      'System-computed FMEA risk score.',
      v_explanation,
      'computed',
      now(),
      'fmea_v1'
    )
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE equipment_risk_scores
    SET severity = v_severity,
        occurrence = v_occurrence,
        detectability = v_detectability,
        assessed_by = NULL,
        assessed_at = now(),
        explanation = v_explanation,
        assignment_method = 'computed',
        override_reason = NULL,
        override_by = NULL,
        override_at = NULL,
        computed_at = now(),
        source_version = 'fmea_v1',
        notes = COALESCE(NULLIF(notes, ''), 'System-computed FMEA risk score.')
    WHERE id = v_existing_id
    RETURNING id INTO v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_refresh_fmea_risk_scores()
RETURNS VOID AS $$
DECLARE
  v_asset_id UUID;
BEGIN
  FOR v_asset_id IN
    SELECT id
    FROM equipment_assets
    WHERE deleted_at IS NULL
      AND status = 'active'
  LOOP
    PERFORM fn_refresh_fmea_risk_score_for_asset(v_asset_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_set_fmea_risk_manual_override(
  asset_uuid UUID,
  p_severity INTEGER,
  p_occurrence INTEGER,
  p_detectability INTEGER,
  p_override_reason TEXT,
  p_override_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_existing_id UUID;
  v_profile_id UUID;
  v_explanation JSONB;
BEGIN
  IF NOT (
    auth_user_has_role('developer')
    OR auth_user_has_role('bme_head')
    OR auth_user_has_role('admin')
  ) THEN
    RAISE EXCEPTION 'Only Developer, BME Head, or Admin may override FMEA risk scores';
  END IF;

  IF p_severity NOT BETWEEN 1 AND 10
     OR p_occurrence NOT BETWEEN 1 AND 10
     OR p_detectability NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Severity, occurrence, and detectability must be between 1 and 10';
  END IF;

  IF LENGTH(TRIM(COALESCE(p_override_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Manual override requires a justification of at least 10 characters';
  END IF;

  SELECT COALESCE(
    p_override_by,
    (SELECT id FROM profiles WHERE user_id = auth.uid() LIMIT 1)
  ) INTO v_profile_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Manual override requires a linked profile';
  END IF;

  SELECT id
  INTO v_existing_id
  FROM equipment_risk_scores
  WHERE asset_id = asset_uuid
  ORDER BY assessed_at DESC, id DESC
  LIMIT 1;

  v_explanation := jsonb_build_object(
    'severity', jsonb_build_object(
      'score', p_severity,
      'drivers', jsonb_build_array('manual expert override')
    ),
    'occurrence', jsonb_build_object(
      'score', p_occurrence,
      'drivers', jsonb_build_array('manual expert override')
    ),
    'detectability', jsonb_build_object(
      'score', p_detectability,
      'drivers', jsonb_build_array('manual expert override')
    ),
    'rpn', p_severity * p_occurrence * p_detectability,
    'risk_level', fn_classify_risk_level(p_severity * p_occurrence * p_detectability),
    'assignment_method', 'manual_override',
    'override_reason', p_override_reason,
    'override_at', now(),
    'source_version', 'fmea_v1'
  );

  IF v_existing_id IS NULL THEN
    INSERT INTO equipment_risk_scores (
      asset_id,
      severity,
      occurrence,
      detectability,
      assessed_by,
      assessed_at,
      notes,
      explanation,
      assignment_method,
      override_reason,
      override_by,
      override_at,
      computed_at,
      source_version
    )
    VALUES (
      asset_uuid,
      p_severity,
      p_occurrence,
      p_detectability,
      v_profile_id,
      now(),
      'Manual expert override: ' || p_override_reason,
      v_explanation,
      'manual_override',
      p_override_reason,
      v_profile_id,
      now(),
      now(),
      'fmea_v1'
    )
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE equipment_risk_scores
    SET severity = p_severity,
        occurrence = p_occurrence,
        detectability = p_detectability,
        assessed_by = v_profile_id,
        assessed_at = now(),
        notes = 'Manual expert override: ' || p_override_reason,
        explanation = v_explanation,
        assignment_method = 'manual_override',
        override_reason = p_override_reason,
        override_by = v_profile_id,
        override_at = now(),
        computed_at = now(),
        source_version = 'fmea_v1'
    WHERE id = v_existing_id
    RETURNING id INTO v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_clear_fmea_manual_override(asset_uuid UUID)
RETURNS UUID AS $$
BEGIN
  RETURN fn_refresh_fmea_risk_score_for_asset(asset_uuid, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION _ensure_baseline_risk_scores()
RETURNS VOID AS $$
BEGIN
  PERFORM fn_refresh_fmea_risk_scores();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION recompute_equipment_analytics(p_asset_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM _recompute_asset_metrics(p_asset_id);
  PERFORM fn_refresh_fmea_risk_score_for_asset(p_asset_id);
  PERFORM refresh_decision_support_snapshots();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION recompute_all_equipment_analytics()
RETURNS VOID AS $$
DECLARE
  v_asset_id UUID;
BEGIN
  FOR v_asset_id IN
    SELECT id
    FROM equipment_assets
    WHERE deleted_at IS NULL
      AND status = 'active'
  LOOP
    PERFORM _recompute_asset_metrics(v_asset_id);
  END LOOP;

  PERFORM fn_refresh_fmea_risk_scores();
  PERFORM compute_replacement_priority_scores_all();
  PERFORM refresh_decision_support_snapshots();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_trigger_refresh_fmea_risk_score()
RETURNS TRIGGER AS $$
DECLARE
  v_asset_id UUID;
BEGIN
  IF TG_TABLE_NAME IN ('maintenance_events', 'work_orders', 'pm_schedules', 'calibration_records', 'calibration_requests', 'equipment_assets') THEN
    IF TG_OP = 'DELETE' THEN
      v_asset_id := OLD.asset_id;
    ELSE
      v_asset_id := NEW.asset_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'pm_completions' THEN
    SELECT ps.asset_id
    INTO v_asset_id
    FROM pm_schedules ps
    WHERE ps.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.schedule_id ELSE NEW.schedule_id END;
  END IF;

  IF v_asset_id IS NOT NULL THEN
    PERFORM fn_refresh_fmea_risk_score_for_asset(v_asset_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_fmea_refresh_maintenance_events ON maintenance_events;
CREATE TRIGGER trg_fmea_refresh_maintenance_events
AFTER INSERT OR UPDATE OR DELETE ON maintenance_events
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_work_orders ON work_orders;
CREATE TRIGGER trg_fmea_refresh_work_orders
AFTER INSERT OR UPDATE OR DELETE ON work_orders
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_pm_schedules ON pm_schedules;
CREATE TRIGGER trg_fmea_refresh_pm_schedules
AFTER INSERT OR UPDATE OR DELETE ON pm_schedules
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_pm_completions ON pm_completions;
CREATE TRIGGER trg_fmea_refresh_pm_completions
AFTER INSERT OR UPDATE OR DELETE ON pm_completions
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_calibration_records ON calibration_records;
CREATE TRIGGER trg_fmea_refresh_calibration_records
AFTER INSERT OR UPDATE OR DELETE ON calibration_records
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_calibration_requests ON calibration_requests;
CREATE TRIGGER trg_fmea_refresh_calibration_requests
AFTER INSERT OR UPDATE OR DELETE ON calibration_requests
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_equipment_assets_insert ON equipment_assets;
CREATE TRIGGER trg_fmea_refresh_equipment_assets_insert
AFTER INSERT ON equipment_assets
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

DROP TRIGGER IF EXISTS trg_fmea_refresh_equipment_assets_update ON equipment_assets;
CREATE TRIGGER trg_fmea_refresh_equipment_assets_update
AFTER UPDATE OF condition, status, category_id, department_id, installation_date, purchase_date, deleted_at ON equipment_assets
FOR EACH ROW EXECUTE FUNCTION fn_trigger_refresh_fmea_risk_score();

UPDATE equipment_risk_scores
SET explanation = jsonb_build_object(
      'severity', jsonb_build_object('score', severity, 'drivers', jsonb_build_array('legacy score before FMEA v1 migration')),
      'occurrence', jsonb_build_object('score', occurrence, 'drivers', jsonb_build_array('legacy score before FMEA v1 migration')),
      'detectability', jsonb_build_object('score', detectability, 'drivers', jsonb_build_array('legacy score before FMEA v1 migration')),
      'rpn', rpn,
      'risk_level', risk_level,
      'legacy_notes', notes,
      'source_version', 'legacy_seed_import'
    ),
    assignment_method = COALESCE(NULLIF(assignment_method, ''), 'computed'),
    computed_at = COALESCE(computed_at, assessed_at),
    source_version = COALESCE(NULLIF(source_version, ''), 'fmea_v1')
WHERE explanation = '{}'::jsonb;

SELECT fn_refresh_fmea_risk_scores();
