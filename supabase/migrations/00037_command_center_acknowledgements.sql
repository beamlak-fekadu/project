CREATE TABLE IF NOT EXISTS command_center_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  asset_id UUID REFERENCES equipment_assets(id) ON DELETE CASCADE,
  signal_hash TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snoozed_until TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, item_type, item_key, signal_hash)
);

ALTER TABLE command_center_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their command center acknowledgements"
  ON command_center_acknowledgements
  FOR SELECT
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
    OR auth_user_has_role('developer')
    OR auth_user_has_role('admin')
    OR auth_user_has_role('bme_head')
  );

CREATE POLICY "Users can create their command center acknowledgements"
  ON command_center_acknowledgements
  FOR INSERT
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
    OR auth_user_has_role('developer')
    OR auth_user_has_role('admin')
    OR auth_user_has_role('bme_head')
  );

CREATE POLICY "Users can update their command center acknowledgements"
  ON command_center_acknowledgements
  FOR UPDATE
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
    OR auth_user_has_role('developer')
    OR auth_user_has_role('admin')
    OR auth_user_has_role('bme_head')
  )
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
    OR auth_user_has_role('developer')
    OR auth_user_has_role('admin')
    OR auth_user_has_role('bme_head')
  );

CREATE INDEX IF NOT EXISTS idx_command_center_ack_signal
  ON command_center_acknowledgements (item_type, item_key, signal_hash);

CREATE INDEX IF NOT EXISTS idx_command_center_ack_profile
  ON command_center_acknowledgements (profile_id, item_type);
