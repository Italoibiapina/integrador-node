CREATE TABLE IF NOT EXISTS profiles (
  role TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

INSERT INTO profiles (role, name)
VALUES
  ('admin', 'Administrador'),
  ('operator', 'Operador')
ON CONFLICT (role) DO UPDATE
SET name = EXCLUDED.name;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_role_fk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_fk
      FOREIGN KEY (role) REFERENCES profiles(role)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS profile_screen_permissions (
  role TEXT NOT NULL REFERENCES profiles(role) ON DELETE CASCADE ON UPDATE CASCADE,
  screen TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, screen)
);

CREATE INDEX IF NOT EXISTS idx_profile_screen_permissions_role
  ON profile_screen_permissions(role);

INSERT INTO profile_screen_permissions (role, screen)
VALUES
  ('admin', '/dashboard'),
  ('admin', '/service-execution-logs'),
  ('admin', '/manual-run'),
  ('admin', '/manual-powerstock'),
  ('admin', '/manual-integrador-powerstock-dispatcher'),
  ('admin', '/manual-dispatcher'),
  ('admin', '/api-auth-configs'),
  ('admin', '/api-services'),
  ('admin', '/sistema-destino-configs'),
  ('admin', '/schedules'),
  ('admin', '/integrations'),
  ('admin', '/executions'),
  ('admin', '/connections'),
  ('admin', '/custom-connections'),
  ('admin', '/notifiers'),
  ('admin', '/users'),
  ('admin', '/profiles'),
  ('operator', '/dashboard'),
  ('operator', '/service-execution-logs'),
  ('operator', '/integrations'),
  ('operator', '/executions')
ON CONFLICT (role, screen) DO NOTHING;
