DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'uq_mcp_replay_position_runs_preview_id'
       AND conrelid = 'mcp_replay_position_runs'::regclass
  ) THEN
    ALTER TABLE mcp_replay_position_runs
      ADD CONSTRAINT uq_mcp_replay_position_runs_preview_id UNIQUE (preview_id);
  END IF;
END $$;
