// src/ingest.ts
import 'dotenv/config';
import { withTx, pool } from './lib/db';
import {
  fetchScheduleIdsForDate,
  fetchBoxscore,
  teamMetaFromBox,
  fetchPlayerLanding,
  birthCountryFromLanding,
  extractPlayerRowsFromBoxscore,
  tallyFromBoxscoreSummary,
  type PlayerTallies,
} from './lib/nhl';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function seasonFromDate(d: string) {
  const [y, m] = d.split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  const end = start + 1;
  return `${start}${end}`; // e.g., 20252026
}

async function main() {
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const gameIds = await fetchScheduleIdsForDate(date);
  console.log(`[ingest] ${gameIds.length} game(s) on ${date}`);

  const natCache = new Map<number, string | null>();
  let sessionWrote = 0;

  await withTx(async (tx) => {
    for (let i = 0; i < gameIds.length; i++) {
      const gamePk = gameIds[i];
      console.log(`[ingest] Processing game ${i + 1}/${gameIds.length} (id=${gamePk})`);

      // 1) Boxscore → meta (teams/date)
      const box = await fetchBoxscore(gamePk);
      // console.log('DEBUG BOX:', JSON.stringify(box, null, 2).slice(0, 2000));
      const meta = teamMetaFromBox(box);
      const season = seasonFromDate(meta.gameDate || date);

      const homeTeamId = await upsertTeamReturnId(tx, meta.home.nhl_id, meta.home.name, meta.home.abbr);
      const awayTeamId = await upsertTeamReturnId(tx, meta.away.nhl_id, meta.away.name, meta.away.abbr);
      const gameId = await upsertGameReturnId(tx, {
        nhl_game_pk: Number(gamePk),
        game_date: meta.gameDate || date,
        season,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        status: null,
      });

      // 2) Prefer detailed roster stats (playerByGameStats.*); fallback to summary GA tallies
      const rosterRows = extractPlayerRowsFromBoxscore(box);
      let wrote = 0;

      if (rosterRows.length > 0) {
        console.log(`  [roster] rows=${rosterRows.length}`);
        for (const r of rosterRows) {
          const nhl_id = r.playerId;

          // nationality (cache landing)
          let nat = natCache.get(nhl_id) ?? null;
          if (!natCache.has(nhl_id)) {
            try {
              const landing = await fetchPlayerLanding(nhl_id);
              nat = birthCountryFromLanding(landing);
            } catch { nat = null; }
            natCache.set(nhl_id, nat);
          }

          const playerDb = await upsertPlayerReturnId(tx, nhl_id, r.name ?? `Player ${nhl_id}`, nat);

          await upsertPlayerGameStats(tx, {
            game_id: gameId,
            nhl_game_pk: Number(gamePk),
            player_id: playerDb.id,
            team_id: null,                 // optional; not needed for FIN/SWE rollups
            is_goalie: !!r.isGoalie,
            goals: nz(r.goals),
            assists: nz(r.assists),
            shots: nz(r.shots),
            pim: nz(r.pim),
            toi: r.toi ?? null,
            saves: nz(r.saves),
            shots_against: nz(r.shotsAgainst),
            goals_against: nz(r.goalsAgainst),
            decision: r.decision ?? null,
            shutout: r.isGoalie && r.shotsAgainst != null && r.goalsAgainst === 0 ? true : null,
          });
          wrote++;
        }
      } else {
        const tallies: PlayerTallies = tallyFromBoxscoreSummary(box);
        console.log(`  [summary] unique players with G/A: ${Object.keys(tallies).length}`);

        for (const pidStr of Object.keys(tallies)) {
          const nhl_id = Number(pidStr);
          const t = tallies[nhl_id];

          let nat = natCache.get(nhl_id) ?? null;
          if (!natCache.has(nhl_id)) {
            try {
              const landing = await fetchPlayerLanding(nhl_id);
              nat = birthCountryFromLanding(landing);
            } catch { nat = null; }
            natCache.set(nhl_id, nat);
          }

          const playerDb = await upsertPlayerReturnId(tx, nhl_id, t.name ?? `Player ${nhl_id}`, nat);

          await upsertPlayerGameStats(tx, {
            game_id: gameId,
            nhl_game_pk: Number(gamePk),
            player_id: playerDb.id,
            team_id: null,
            is_goalie: false,
            goals: t.goals,
            assists: t.assists,
            shots: null,
            pim: null,
            toi: null,
            saves: null,
            shots_against: null,
            goals_against: null,
            decision: null,
            shutout: null,
          });
          wrote++;
        }
      }

      console.log(`  [insert] wrote/updated ${wrote} rows for game ${gamePk}`);
      sessionWrote += wrote;
    }

    // 3) Aggregates for the date + season (FIN/SWE)
    await tx.query(`delete from nhl.nightly_nation_agg where game_date = $1`, [date]);
    await tx.query(
      `
      insert into nhl.nightly_nation_agg (game_date, nation, goals, assists, goalie_wins, shutouts)
      select
        $1 as game_date,
        nation,
        coalesce(sum(goals),0),
        coalesce(sum(assists),0),
        0, 0
      from (
        select pgs.*,
               case
                 when no.nation is not null then no.nation
                 when upper(pl.birth_country) like 'FIN%' then 'FIN'
                 when upper(pl.birth_country) like 'SWE%' then 'SWE'
                 else null
               end as nation
        from nhl.player_game_stats pgs
        join nhl.players pl on pl.id = pgs.player_id
        left join nhl.nationality_overrides no on no.player_id = pl.id
        join nhl.games g on g.id = pgs.game_id
        where g.game_date = $1
      ) t
      where nation in ('FIN','SWE')
      group by nation
      `,
      [date]
    );

    const season = seasonFromDate(date);
    await tx.query(`delete from nhl.season_nation_agg where season = $1`, [season]);
    await tx.query(
      `
      insert into nhl.season_nation_agg (season, nation, goals, assists, goalie_wins, shutouts)
      select
        $1 as season,
        nation,
        coalesce(sum(goals),0),
        coalesce(sum(assists),0),
        0, 0
      from (
        select pgs.*,
               case
                 when no.nation is not null then no.nation
                 when upper(pl.birth_country) like 'FIN%' then 'FIN'
                 when upper(pl.birth_country) like 'SWE%' then 'SWE'
                 else null
               end as nation
        from nhl.player_game_stats pgs
        join nhl.players pl on pl.id = pgs.player_id
        left join nhl.nationality_overrides no on no.player_id = pl.id
        join nhl.games g on g.id = pgs.game_id
        where g.season = $1
      ) t
      where nation in ('FIN','SWE')
      group by nation
      `,
      [season]
    );
  });

  console.log(`[ingest] Done for ${date} (session wrote ${sessionWrote})`);
  await pool.end();
}

function nz(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- DB helpers (your schema) ----------
async function upsertTeamReturnId(tx: any, nhl_id: number, name: string, tri: string) {
  const { rows } = await tx.query(
    `
    insert into nhl.teams (nhl_id, name, tri_code)
    values ($1,$2,$3)
    on conflict (nhl_id) do update
      set name = excluded.name, tri_code = excluded.tri_code, updated_at = now()
    returning id
    `,
    [nhl_id || null, name || null, tri || null]
  );
  return rows[0].id as number;
}

async function upsertGameReturnId(tx: any, g: {
  nhl_game_pk: number; game_date: string; season: string;
  home_team_id: number | null; away_team_id: number | null; status: string | null;
}) {
  const { rows } = await tx.query(
    `
    insert into nhl.games (nhl_game_pk, game_date, season, home_team_id, away_team_id, status)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (nhl_game_pk) do update
      set game_date = excluded.game_date,
          season = excluded.season,
          home_team_id = excluded.home_team_id,
          away_team_id = excluded.away_team_id,
          status = excluded.status,
          updated_at = now()
    returning id
    `,
    [g.nhl_game_pk, g.game_date, g.season, g.home_team_id, g.away_team_id, g.status]
  );
  return rows[0].id as number;
}

async function upsertPlayerReturnId(tx: any, nhl_id: number, full_name: string, birth_country: string | null) {
  const { rows } = await tx.query(
    `
    insert into nhl.players (nhl_id, full_name, birth_country)
    values ($1,$2,$3)
    on conflict (nhl_id) do update
      set full_name = excluded.full_name,
          birth_country = coalesce(nhl.players.birth_country, excluded.birth_country),
          updated_at = now()
    returning id
    `,
    [nhl_id, full_name || `Player ${nhl_id}`, birth_country]
  );
  return rows[0];
}

async function upsertPlayerGameStats(tx: any, s: any) {
  await tx.query(
    `
    insert into nhl.player_game_stats
      (game_id, nhl_game_pk, player_id, team_id, is_goalie,
       goals, assists, shots, pim, toi,
       saves, shots_against, goals_against, decision, shutout)
    values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    on conflict (player_id, nhl_game_pk) do update set
      game_id = excluded.game_id,
      team_id = excluded.team_id,
      is_goalie = excluded.is_goalie,
      goals = excluded.goals,
      assists = excluded.assists,
      shots = excluded.shots,
      pim = excluded.pim,
      toi = excluded.toi,
      saves = excluded.saves,
      shots_against = excluded.shots_against,
      goals_against = excluded.goals_against,
      decision = excluded.decision,
      shutout = excluded.shutout,
      updated_at = now()
    `,
    [
      s.game_id, s.nhl_game_pk, s.player_id, s.team_id, s.is_goalie,
      s.goals, s.assists, s.shots, s.pim, s.toi,
      s.saves, s.shots_against, s.goals_against, s.decision, s.shutout
    ]
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
