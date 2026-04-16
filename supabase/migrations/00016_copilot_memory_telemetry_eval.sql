-- Migration 00016: Copilot memory, telemetry, and evaluation artifacts

CREATE TABLE IF NOT EXISTS chat_session_memory (
  session_id UUID PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT 'operations',
  last_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  intent TEXT NOT NULL,
  capability TEXT NOT NULL,
  confidence_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  confidence_label TEXT NOT NULL CHECK (confidence_label IN ('high', 'medium', 'low')),
  decision TEXT NOT NULL CHECK (decision IN ('answer', 'limited_answer', 'check_manual', 'escalate', 'refuse')),
  blocked BOOLEAN NOT NULL DEFAULT false,
  fallback_reason TEXT NULL,
  role_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  module_label TEXT NULL,
  evidence_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES chat_evaluation_runs(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  expected_capability TEXT NOT NULL,
  actual_capability TEXT NULL,
  capability_match BOOLEAN NOT NULL DEFAULT false,
  confidence_score NUMERIC(5,4) NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  over_refusal BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_telemetry_session_created
  ON chat_telemetry_events (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_telemetry_capability_created
  ON chat_telemetry_events (capability, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_eval_results_run
  ON chat_evaluation_results (run_id, created_at);

ALTER TABLE chat_session_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_evaluation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_chat_memory ON chat_session_memory
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM chat_sessions cs
    JOIN profiles p ON p.id = cs.user_id
    WHERE cs.id = chat_session_memory.session_id
      AND p.user_id = auth.uid()
  )
  OR auth_user_has_role('admin')
);

CREATE POLICY upsert_own_chat_memory ON chat_session_memory
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM chat_sessions cs
    JOIN profiles p ON p.id = cs.user_id
    WHERE cs.id = chat_session_memory.session_id
      AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM chat_sessions cs
    JOIN profiles p ON p.id = cs.user_id
    WHERE cs.id = chat_session_memory.session_id
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY select_chat_telemetry ON chat_telemetry_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM chat_sessions cs
    JOIN profiles p ON p.id = cs.user_id
    WHERE cs.id = chat_telemetry_events.session_id
      AND p.user_id = auth.uid()
  )
  OR auth_user_has_role('admin')
);

CREATE POLICY insert_chat_telemetry ON chat_telemetry_events
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM chat_sessions cs
    JOIN profiles p ON p.id = cs.user_id
    WHERE cs.id = chat_telemetry_events.session_id
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY select_eval_runs ON chat_evaluation_runs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = chat_evaluation_runs.created_by
      AND p.user_id = auth.uid()
  )
  OR auth_user_has_role('admin')
);

CREATE POLICY insert_eval_runs ON chat_evaluation_runs
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = chat_evaluation_runs.created_by
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY select_eval_results ON chat_evaluation_results
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM chat_evaluation_runs r
    JOIN profiles p ON p.id = r.created_by
    WHERE r.id = chat_evaluation_results.run_id
      AND p.user_id = auth.uid()
  )
  OR auth_user_has_role('admin')
);

CREATE POLICY insert_eval_results ON chat_evaluation_results
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM chat_evaluation_runs r
    JOIN profiles p ON p.id = r.created_by
    WHERE r.id = chat_evaluation_results.run_id
      AND p.user_id = auth.uid()
  )
);
