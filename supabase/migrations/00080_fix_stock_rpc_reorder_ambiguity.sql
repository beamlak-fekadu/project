-- Migration 00080: Fix reorder_level column-reference ambiguity in stock RPCs
--
-- Symptom: every call to record_stock_issue (and record_stock_receipt) raised
--   PostgreSQL error 42702: column reference "reorder_level" is ambiguous
--
-- Root cause: both functions declare RETURNS TABLE (..., reorder_level INTEGER, ...).
-- In PostgreSQL 15+, RETURNS TABLE column names become PL/pgSQL local variables
-- that are in scope throughout the function body.  When the function body then
-- runs
--   SELECT current_stock, reorder_level FROM spare_parts ...
-- the parser sees "reorder_level" as ambiguous between the local output variable
-- and the table column.  The fix is to qualify every spare_parts column reference
-- with the table alias "sp".
--
-- Both record_stock_issue (00064) and record_stock_receipt (00065) are affected.
-- DROP + CREATE OR REPLACE is required because RETURNS TABLE shape changes are
-- rejected by plain CREATE OR REPLACE in Postgres.

-- ============================================================================
-- record_stock_issue (replaces 00064)
-- ============================================================================

DROP FUNCTION IF EXISTS record_stock_issue(UUID, INTEGER, UUID, DATE, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION record_stock_issue(
  p_part_id         UUID,
  p_quantity        INTEGER,
  p_issued_by       UUID,
  p_issue_date      DATE,
  p_issued_to_event_id UUID DEFAULT NULL,
  p_department_id   UUID DEFAULT NULL,
  p_notes           TEXT DEFAULT NULL
)
RETURNS TABLE (
  issue_id          UUID,
  part_id           UUID,
  new_current_stock INTEGER,
  reorder_level     INTEGER,
  crossed_reorder   BOOLEAN,
  crossed_zero      BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current  INTEGER;
  v_reorder  INTEGER;
  v_new_stock INTEGER;
  v_issue_id  UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Stock issue quantity must be at least 1, got %', p_quantity;
  END IF;

  -- Qualify all spare_parts columns with alias "sp" to avoid ambiguity with
  -- the RETURNS TABLE output columns of the same names.
  SELECT sp.current_stock, sp.reorder_level
    INTO v_current, v_reorder
  FROM spare_parts sp
  WHERE sp.id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spare part % not found', p_part_id;
  END IF;

  IF COALESCE(v_current, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock: part % has % units, requested %',
      p_part_id, COALESCE(v_current, 0), p_quantity
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO stock_issues (
    part_id, quantity, issued_to_event_id, issued_by, issue_date,
    department_id, notes
  )
  VALUES (
    p_part_id, p_quantity, p_issued_to_event_id, p_issued_by, p_issue_date,
    p_department_id, p_notes
  )
  RETURNING id INTO v_issue_id;

  v_new_stock := COALESCE(v_current, 0) - p_quantity;

  UPDATE spare_parts
     SET current_stock = v_new_stock
   WHERE id = p_part_id;

  issue_id          := v_issue_id;
  part_id           := p_part_id;
  new_current_stock := v_new_stock;
  reorder_level     := COALESCE(v_reorder, 0);
  crossed_zero      := COALESCE(v_current, 0) > 0 AND v_new_stock <= 0;
  crossed_reorder   := COALESCE(v_current, 0) > COALESCE(v_reorder, 0)
                       AND v_new_stock <= COALESCE(v_reorder, 0);
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION record_stock_issue(UUID, INTEGER, UUID, DATE, UUID, UUID, TEXT)
  TO authenticated;

-- ============================================================================
-- record_stock_receipt (replaces 00065)
-- ============================================================================

DROP FUNCTION IF EXISTS record_stock_receipt(UUID, INTEGER, UUID, DATE, UUID, TEXT, NUMERIC, TEXT, UUID);

CREATE OR REPLACE FUNCTION record_stock_receipt(
  p_part_id        UUID,
  p_quantity       INTEGER,
  p_received_by    UUID,
  p_received_date  DATE,
  p_supplier_id    UUID    DEFAULT NULL,
  p_invoice_ref    TEXT    DEFAULT NULL,
  p_unit_cost      NUMERIC DEFAULT NULL,
  p_notes          TEXT    DEFAULT NULL,
  p_procurement_id UUID    DEFAULT NULL
)
RETURNS TABLE (
  receipt_id        UUID,
  part_id           UUID,
  new_current_stock INTEGER,
  reorder_level     INTEGER,
  crossed_up        BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_current   INTEGER;
  v_reorder   INTEGER;
  v_new_stock INTEGER;
  v_receipt_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Stock receipt quantity must be at least 1, got %', p_quantity;
  END IF;

  -- Qualify all spare_parts columns with alias "sp".
  SELECT sp.current_stock, sp.reorder_level
    INTO v_current, v_reorder
  FROM spare_parts sp
  WHERE sp.id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spare part % not found', p_part_id;
  END IF;

  INSERT INTO stock_receipts (
    part_id, quantity, received_by, received_date,
    supplier_id, invoice_ref, unit_cost, notes, procurement_id
  )
  VALUES (
    p_part_id, p_quantity, p_received_by, p_received_date,
    p_supplier_id, p_invoice_ref, p_unit_cost, p_notes, p_procurement_id
  )
  RETURNING id INTO v_receipt_id;

  v_new_stock := COALESCE(v_current, 0) + p_quantity;

  UPDATE spare_parts
     SET current_stock = v_new_stock
   WHERE id = p_part_id;

  receipt_id        := v_receipt_id;
  part_id           := p_part_id;
  new_current_stock := v_new_stock;
  reorder_level     := COALESCE(v_reorder, 0);
  crossed_up        := COALESCE(v_reorder, 0) > 0
                       AND COALESCE(v_current, 0) <= COALESCE(v_reorder, 0)
                       AND v_new_stock > COALESCE(v_reorder, 0);
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION record_stock_receipt(UUID, INTEGER, UUID, DATE, UUID, TEXT, NUMERIC, TEXT, UUID)
  TO authenticated;
