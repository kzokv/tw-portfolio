-- app_config: single-row global configuration (KZO-133)
CREATE TABLE IF NOT EXISTS public.app_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  repair_cooldown_minutes INT NULL
    CHECK (repair_cooldown_minutes IS NULL OR repair_cooldown_minutes > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_config (id, repair_cooldown_minutes)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
