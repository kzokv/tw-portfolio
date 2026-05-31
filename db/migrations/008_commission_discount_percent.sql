ALTER TABLE fee_profiles
  ADD COLUMN IF NOT EXISTS commission_discount_percent NUMERIC(5, 2);

UPDATE fee_profiles
SET commission_discount_percent = ROUND((100 - commission_discount_bps::NUMERIC / 100), 2)
WHERE commission_discount_percent IS NULL;

ALTER TABLE fee_profiles
  ALTER COLUMN commission_discount_percent SET DEFAULT 0,
  ALTER COLUMN commission_discount_percent SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'fee_profiles'
      AND c.conname = 'ck_fee_profiles_commission_discount_percent'
  ) THEN
    ALTER TABLE fee_profiles
      ADD CONSTRAINT ck_fee_profiles_commission_discount_percent
      CHECK (commission_discount_percent >= 0 AND commission_discount_percent <= 100);
  END IF;
END $$;
