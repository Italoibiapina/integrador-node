ALTER TABLE api_auth_configs
ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'bearer';
