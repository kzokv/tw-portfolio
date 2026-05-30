ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_users_demo_cleanup ON users(demo_expires_at) WHERE is_demo = true;
