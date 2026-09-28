-- Target PostgreSQL model for the hosted, multi-user stage.
-- The local pilot currently persists only quest events in SQLite.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  auth_subject text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  provider_customer_id text UNIQUE,
  provider_subscription_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('trial','active','past_due','canceled','expired')),
  paid_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  refresh_token_hash text UNIQUE NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
CREATE TABLE game_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK (mode IN ('pvp','pve','seasonal')),
  account_id bigint NOT NULL,
  character_id text NOT NULL,
  season_id text NOT NULL DEFAULT '',
  nickname text NOT NULL,
  UNIQUE (user_id,mode,account_id,character_id,season_id)
);
CREATE TABLE profile_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_profile_id uuid NOT NULL REFERENCES game_profiles(id),
  payload jsonb NOT NULL,
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quest_events (
  game_profile_id uuid NOT NULL REFERENCES game_profiles(id),
  event_id text NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id),
  task_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','completed','failed')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_profile_id,event_id)
);
CREATE INDEX quest_events_projection ON quest_events(game_profile_id,task_id,occurred_at);
CREATE TABLE hideout_progress (
  game_profile_id uuid NOT NULL REFERENCES game_profiles(id),
  station_id text NOT NULL,
  level integer NOT NULL CHECK (level >= 0),
  source text NOT NULL CHECK (source IN ('manual','upstream')),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (game_profile_id,station_id)
);
CREATE TABLE catalog_versions (
  mode text NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY(mode,content_hash)
);
CREATE TABLE payment_webhook_receipts (
  provider text NOT NULL,
  event_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
