UPDATE users
SET cost_basis_method = 'WEIGHTED_AVERAGE'
WHERE cost_basis_method <> 'WEIGHTED_AVERAGE';

ALTER TABLE users
  ALTER COLUMN cost_basis_method SET DEFAULT 'WEIGHTED_AVERAGE';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_cost_basis_method_check;

ALTER TABLE users
  ADD CONSTRAINT users_cost_basis_method_check
  CHECK (cost_basis_method = 'WEIGHTED_AVERAGE');
