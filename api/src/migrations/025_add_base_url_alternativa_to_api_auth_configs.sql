ALTER TABLE api_auth_configs
ADD COLUMN IF NOT EXISTS base_url_alternativa TEXT NULL;
