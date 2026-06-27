ALTER TABLE mcp_replay_position_runs
  ADD CONSTRAINT uq_mcp_replay_position_runs_preview_id UNIQUE (preview_id);
