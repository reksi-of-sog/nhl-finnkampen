-- 1. SCHEMA
create schema if not exists nhl;

-- 2. PLAYERS
create table if not exists nhl.players (
  id bigserial primary key,
  nhl_id integer unique not null,
  full_name text not null,
  birth_country text,              -- e.g., "FIN", "SWE" (we'll normalize to ISO-3 or ISO-2 as needed)
  position text,
  shoots_catches text,
  current_team_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_nhl_id_idx on nhl.players(nhl_id);
create index if not exists players_birth_country_idx on nhl.players(birth_country);

-- 3. TEAMS (minimal for joins if needed later)
create table if not exists nhl.teams (
  id bigserial primary key,
  nhl_id bigint not null unique,
  name varchar(255),
  tricode varchar(3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teams_nhl_id_idx on nhl.teams(nhl_id);

-- 4. GAMES
create table if not exists nhl.games (
  id bigserial primary key,
  game_type varchar(2), -- PR, R, P
  nhl_game_pk bigint unique not null,   -- NHL's unique game id
  game_date date not null,
  season text not null,                 -- e.g., "20242025"
  home_team_id integer,
  away_team_id integer,
  status text,                          -- e.g., FINAL, LIVE, PREVIEW
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_date_idx on nhl.games(game_date);
create index if not exists games_pk_idx on nhl.games(nhl_game_pk);

-- 5. PLAYER GAME STATS (skater + goalie in one table; nullable fields for non-applicable)
create table if not exists nhl.player_game_stats (
  id bigserial primary key,
  game_id bigint not null references nhl.games(id) on delete cascade,
  player_id bigint not null references nhl.players(id) on delete cascade,
  team_id bigint references nhl.teams(id),
  -- Skater stats
  goals int,
  assists int,
  shots int,
  pim int,  -- penalties in minutes
  toi text, -- time on ice e.g. "18:23"
  -- Goalie stats (nullable for skaters)
  saves int,
  shots_against int,
  goals_against int,
  decision text,  -- W/L/OT
  -- meta
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, player_id) -- THIS LINE IS THE FIX
);

create index if not exists pgs_game_idx on nhl.player_game_stats(game_id);
create index if not exists pgs_player_idx on nhl.player_game_stats(player_id);


-- 6. NIGHTLY NATIONALITY AGGREGATES
create table if not exists nhl.nightly_nation_agg (
  id bigserial primary key,
  game_date date not null,
  nation text not null check (nation in ('FIN','SWE')),
  goals int not null default 0,
  assists int not null default 0,
  points int generated always as (coalesce(goals,0)+coalesce(assists,0)) stored,
  goalie_wins int not null default 0,
  shutouts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_date, nation)
);

create index if not exists night_agg_date_idx on nhl.nightly_nation_agg(game_date);

-- 7. SEASON NATIONALITY AGGREGATES
create table if not exists nhl.season_nation_agg (
  id bigserial primary key,
  season text not null,
  nation text not null check (nation in ('FIN','SWE')),
  game_type varchar(2) not null,
  goals int not null default 0,
  assists int not null default 0,
  points int generated always as (coalesce(goals,0)+coalesce(assists,0)) stored,
  goalie_wins int not null default 0,
  shutouts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, nation, game_type)
);

create index if not exists season_agg_season_idx on nhl.season_nation_agg(season);

-- 8. POSTS (track what we published)
create table if not exists nhl.posts (
  id bigserial primary key,
  kind text not null check (kind in ('nightly','correction','funfact')),
  target_date date not null,         -- which game date the post refers to
  x_status_id text,                  -- tweet/status id
  body text not null,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists posts_date_idx on nhl.posts(target_date);

-- 9. OPTIONAL: nationality overrides (dual-citizenship edge cases)
create table if not exists nhl.nationality_overrides (
  player_id bigint primary key references nhl.players(id) on delete cascade,
  nation text not null check (nation in ('FIN','SWE')),
  reason text,
  created_at timestamptz not null default now()
);

-- 10. TRIGGERS to auto-update updated_at
create or replace function nhl.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

DROP TRIGGER IF EXISTS t_players_uat ON nhl.players;
create trigger t_players_uat before update on nhl.players
for each row execute function nhl.touch_updated_at();

DROP TRIGGER IF EXISTS t_teams_uat ON nhl.teams;
create trigger t_teams_uat before update on nhl.teams
for each row execute function nhl.touch_updated_at();

DROP TRIGGER IF EXISTS t_games_uat ON nhl.games;
create trigger t_games_uat before update on nhl.games
for each row execute function nhl.touch_updated_at();

DROP TRIGGER IF EXISTS t_pgs_uat ON nhl.player_game_stats;
create trigger t_pgs_uat before update on nhl.player_game_stats
for each row execute function nhl.touch_updated_at();

DROP TRIGGER IF EXISTS t_night_uat ON nhl.nightly_nation_agg;
create trigger t_night_uat before update on nhl.nightly_nation_agg
for each row execute function nhl.touch_updated_at();

DROP TRIGGER IF EXISTS t_season_uat ON nhl.season_nation_agg;
create trigger t_season_uat before update on nhl.season_nation_agg
for each row execute function nhl.touch_updated_at();

-- 11. RLS NOTES
-- Supabase best practice: enable RLS and access these tables only via the service role
-- from your server-side worker (cron/Edge Function). If you later build a public UI,
-- add narrow policies. For now, we simply enable RLS and create no broad policies.

alter table nhl.players enable row level security;
alter table nhl.teams enable row level security;
alter table nhl.games enable row level security;
alter table nhl.player_game_stats enable row level security;
alter table nhl.nightly_nation_agg enable row level security;
alter table nhl.season_nation_agg enable row level security;
alter table nhl.posts enable row level security;
alter table nhl.nationality_overrides enable row level security;

-- No policies created here on purpose. Your server (service role) bypasses RLS.