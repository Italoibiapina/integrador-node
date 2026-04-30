ALTER TABLE api_services
ADD COLUMN IF NOT EXISTS parametro_get TEXT;

ALTER TABLE api_services
ALTER COLUMN parametros DROP DEFAULT;
