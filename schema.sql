-- ASMA Lines — схема базы Cloudflare D1.
-- Применяется один раз перед первым деплоем с биндингом DB:
--   npx wrangler d1 execute asma-lines --remote --file=./schema.sql
-- Тот же SQL продублирован в _shared/store.js (SCHEMA_SQL) и применяется
-- автоматически при первом запросе, так что расхождение исключено.

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  lead_number TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  type TEXT,
  category TEXT,
  name TEXT,
  company TEXT,
  contact TEXT,
  contact_raw TEXT,
  email TEXT,
  from_city TEXT,
  to_city TEXT,
  route TEXT,
  distance TEXT,
  distance_km REAL,
  vehicle TEXT,
  weight TEXT,
  weight_tons REAL,
  volume TEXT,
  volume_m3 REAL,
  price TEXT,
  price_value INTEGER,
  price_breakdown TEXT,
  comment TEXT,
  cargo TEXT,
  loading INTEGER DEFAULT 0,
  source TEXT,
  assigned_to TEXT,
  priority TEXT DEFAULT 'normal',
  dispatcher TEXT,
  direction TEXT,
  topic TEXT,
  preferred_channel TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_number ON leads(lead_number DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

CREATE TABLE IF NOT EXISTS deleted_leads (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT
);

CREATE TABLE IF NOT EXISTS access_users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT,
  username TEXT,
  name TEXT,
  role TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_username ON access_users(username);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT,
  role TEXT,
  telegram_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Счётчик номеров заявок. Обновляется атомарно (UPDATE ... SET value = value + 1),
-- поэтому два одновременных запроса больше не получат один и тот же номер.
INSERT INTO counters (name, value) VALUES ('lead_number', 100)
  ON CONFLICT(name) DO NOTHING;

INSERT INTO meta (key, value) VALUES ('schema_version', '2')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
