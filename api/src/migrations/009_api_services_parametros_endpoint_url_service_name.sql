ALTER TABLE api_services
ADD COLUMN IF NOT EXISTS endpoint_url TEXT;

ALTER TABLE api_services
ADD COLUMN IF NOT EXISTS service_name TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'api_services' AND column_name = 'endpoints'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'api_services' AND column_name = 'parametros'
  ) THEN
    ALTER TABLE api_services RENAME COLUMN endpoints TO parametros;
  END IF;
END $$;
