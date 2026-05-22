-- Migration 00081: Link calibration_records to calibration_requests
--
-- Root cause: calibration_records had no FK to calibration_requests. The two
-- tables shared only asset_id. When a technician recorded a calibration result,
-- the originating request status never changed (stayed pending/in_progress
-- forever) because the action had no FK to follow.
--
-- This migration adds an optional request_id FK so createCalibrationRecordAction
-- can close the originating request in the same server action.

ALTER TABLE calibration_records
  ADD COLUMN IF NOT EXISTS request_id UUID
    REFERENCES calibration_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calibration_records_request
  ON calibration_records(request_id)
  WHERE request_id IS NOT NULL;

-- Also add an RLS UPDATE policy so the action can flip calibration_requests
-- status to 'completed'.  Migration 00079 aligned INSERT; UPDATE was still
-- missing for the result-recording flow.
DROP POLICY IF EXISTS update_calibration_requests_result_complete ON calibration_requests;
CREATE POLICY update_calibration_requests_result_complete
  ON calibration_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('developer','admin','bme_head','technician')
    )
  );
