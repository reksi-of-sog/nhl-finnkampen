// src/ingest.ts
import 'dotenv/config';
import { withTx, pool } from './lib/db.js'; // Ensure 'pool' is imported for direct queries outside transaction
import {
  fetchScheduleIdsForDate,
  fetchBoxscore,
  teamMetaFromBox,
  fetchPlayerLanding,
  birthCountryFromLanding,
  extractPlayerRowsFromBoxscore,
  tallyFromBoxscoreSummary,
} from './lib/nhl.js';

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
  const games = await fetchScheduleIdsForDate(date);
  console.log(`[ingest] ${games.length} game(s) on ${date}`);

  const natCache = new Map<number, string | null>();
  let sessionWrote = 0;

  await withTx(async (tx) => {
    for (let i = 0; i < games.length; i++) {
      // This is the line that fixes the error.
      // It correctly unpacks the id and gameType from the object.
      const { id: gamePk, gameType } = games[i];
      console.log(`[ingest] Processing game ${i + 1}/${games.length} (id=${gamePk}, type=${gameType})`);

      // 1) Boxscore → meta (teams/date)
      const box = await fetchBoxscore(gamePk);
      const meta = teamMetaFromBox(box);
      const season = seasonFromDate(meta.gameDate || date);
      const homeId = await upsertTeamReturnId(tx, meta.home.nhl_id, meta.home.name, meta.home.abbr);
      const awayId = await upsertTeamReturnId(tx, meta.away.nhl_id, meta.away.name, meta.away.abbr);
      const gameId = await upsertGameReturnId(tx, {
        nhl_game_pk: gamePk,
        game_date: meta.gameDate || date,
        season,
        game_type: gameType,
        home_team_id: homeId,
        away_team_id: awayId,
        status: box.gameState,
      });

      // 2) Player stats
      const playerRows = extractPlayerRowsFromBoxscore(box);
      let wrote = 0;
      if (playerRows.length > 0) {
        console.log(`  [boxscore] rows=${playerRows.length}`);
        for (const r of playerRows) {
          let nat = natCache.get(r.playerId);
          if (nat === undefined) {
            const landing = await fetchPlayerLanding(r.playerId);
            nat = birthCountryFromLanding(landing);
            natCache.set(r.playerId, nat);
          }
          if (!nat) continue;
          const pid = await upsertPlayerReturnId(tx, r.playerId, r.name || '?', nat);
          await upsertPlayerGameStats(tx, { ...r, game_id: gameId, player_id: pid });
          wrote++;
        }
      } else {
        // Fallback to summary if playerByGameStats is empty
        const tallies = tallyFromBoxscoreSummary(box);
        console.log(`  [summary] unique players with G/A: ${Object.keys(tallies).length}`);
        for (const playerId of Object.keys(tallies).map(Number)) {
          let nat = natCache.get(playerId);
          if (nat === undefined) {
            const landing = await fetchPlayerLanding(playerId);
            nat = birthCountryFromLanding(landing);
            natCache.set(playerId, nat);
          }
          if (!nat) continue;
          const t = tallies[playerId];
          const pid = await upsertPlayerReturnId(tx, playerId, t.name || '?', nat);
          await upsertPlayerGameStats(tx, {
            game_id: gameId,
            player_id: pid,
            goals: t.goals,
            assists: t.assists,
          });
          wrote++;
        }
      }
      console.log(`  [insert] wrote/updated ${wrote} rows for game ${gamePk}`);
      sessionWrote += wrote;
    }

    // 3) Aggregates for the date + season (FIN/SWE)
    await computeNightlyAgg(tx, date);
    await computeSeasonAgg(tx, date);

    // --- NEW: Calculate and update Nightly Winner and Season Wins ---
    await updateNightlyWinner(tx, date);
    await updateSeasonWins(tx, date);
  });

  console.log(`[ingest] Done for ${date} (session wrote ${sessionWrote})`);
}

function nz(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- DB helpers (your schema) ----------
async function upsertTeamReturnId(tx: any, nhl_id: number, name: string, tri: string) {
  const q = `
    insert into nhl.teams (nhl_id, name, tricode) values ($1, $2, $3)
    on conflict (nhl_id) do update set name = excluded.name, tricode = excluded.tricode
    returning id`;
  const res = await tx.query(q, [nhl_id, name, tri]);
  return res.rows[0].id;
}

async function upsertGameReturnId(tx: any, g: {
  nhl_game_pk: number; game_date: string; season: string; game_type: string;
  home_team_id: number | null; away_team_id: number | null; status: string | null;
}) {
  const q = `
    insert into nhl.games (nhl_game_pk, game_date, season, game_type, home_team_id, away_team_id, status)
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (nhl_game_pk) do update set
      game_date = excluded.game_date,
      status = excluded.status,
      updated_at = now()
    returning id`;
  const res = await tx.query(q, [g.nhl_game_pk, g.game_date, g.season, g.game_type, g.home_team_id, g.away_team_id, g.status]);
  return res.rows[0].id;
}

async function upsertPlayerReturnId(tx: any, nhl_id: number, full_name: string, birth_country: string | null) {
  const q = `
    insert into nhl.players (nhl_id, full_name, birth_country) values ($1, $2, $3)
    on conflict (nhl_id) do update set
      full_name = excluded.full_name,
      birth_country = excluded.birth_country,
      updated_at = now()
    returning id`;
  const res = await tx.query(q, [nhl_id, full_name, birth_country]);
  return res.rows[0].id;
}

async function upsertPlayerGameStats(tx: any, s: any) {
  const q = `
    insert into nhl.player_game_stats (
      game_id, player_id, team_id,
      goals, assists, shots, pim, toi,
      saves, shots_against, goals_against, decision
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    on conflict (game_id, player_id) do update set
      team_id = excluded.team_id,
      goals = excluded.goals,
      assists = excluded.assists,
      shots = excluded.shots,
      pim = excluded.pim,
      toi = excluded.toi,
      saves = excluded.saves,
      shots_against = excluded.shots_against,
      goals_against = excluded.goals_against,
      decision = excluded.decision,
      updated_at = now()
  `;
  await tx.query(q, [
    s.game_id, s.player_id, s.team_id,
    nz(s.goals), nz(s.assists), nz(s.shots), nz(s.pim), s.toi,
    nz(s.saves), nz(s.shotsAgainst), nz(s.goalsAgainst), s.decision,
  ]);
}

async function computeNightlyAgg(client: any, date: string) {
  const q = `
    insert into nhl.nightly_nation_agg (game_date, nation, goals, assists, goalie_wins)
    select
      g.game_date,
      p.birth_country,
      coalesce(sum(s.goals), 0) as goals,
      coalesce(sum(s.assists), 0) as assists,
      coalesce(sum(case when s.decision = 'W' then 1 else 0 end), 0) as goalie_wins
    from nhl.player_game_stats s
    join nhl.games g on s.game_id = g.id
    join nhl.players p on s.player_id = p.id
    where g.game_date = $1 and p.birth_country in ('FIN', 'SWE')
    group by g.game_date, p.birth_country
    on conflict (game_date, nation) do update set
      goals = excluded.goals,
      assists = excluded.assists,
      goalie_wins = excluded.goalie_wins,
      night_winner = NULL, -- Reset night_winner, will be set in updateNightlyWinner
      updated_at = now()
  `;
  await client.query(q, [date]);
}

async function computeSeasonAgg(client: any, date: string) {
  const season = seasonFromDate(date);
  const q = `
    insert into nhl.season_nation_agg (season, nation, game_type, goals, assists)
    select
      g.season,
      p.birth_country,
      g.game_type,
      coalesce(sum(s.goals), 0) as goals,
      coalesce(sum(s.assists), 0) as assists
    from nhl.player_game_stats s
    join nhl.games g on s.game_id = g.id
    join nhl.players p on s.player_id = p.id
    where g.season = $1 and p.birth_country in ('FIN', 'SWE') and g.game_type is not null
    group by g.season, p.birth_country, g.game_type
    on conflict (season, nation, game_type) do update set
      goals = excluded.goals,
      assists = excluded.assists,
      -- REMOVED: fin_night_wins = 0,
      -- REMOVED: swe_night_wins = 0,
      updated_at = now()
  `;
  await client.query(q, [season]);
}

// --- NEW FUNCTIONS FOR NIGHT WINS AND SEASON WINS ---

async function updateNightlyWinner(client: any, date: string) {
  const nightlyAggsRes = await client.query( // Use client from transaction
    `SELECT nation, goals, assists FROM nhl.nightly_nation_agg WHERE game_date = $1`,
    [date]
  );

  let finNightlyPoints = 0;
  let sweNightlyPoints = 0;

  for (const row of nightlyAggsRes.rows) {
    const totalPoints = row.goals + row.assists;
    if (row.nation === 'FIN') {
      finNightlyPoints = totalPoints;
    } else if (row.nation === 'SWE') {
      sweNightlyPoints = totalPoints;
    }
  }

  let nightWinner: 'FIN' | 'SWE' | 'TIE' | null = null;
  if (finNightlyPoints > sweNightlyPoints) {
    nightWinner = 'FIN';
  } else if (sweNightlyPoints > finNightlyPoints) {
    nightWinner = 'SWE';
  } else if (finNightlyPoints > 0 || sweNightlyPoints > 0) { // Only a tie if at least one point was scored
    nightWinner = 'TIE';
  }

  if (nightWinner) {
    await client.query( // Use client from transaction
      `UPDATE nhl.nightly_nation_agg SET night_winner = $1 WHERE game_date = $2`,
      [nightWinner, date]
    );
    console.log(`[ingest] Nightly winner for ${date}: ${nightWinner}`);
  } else {
    console.log(`[ingest] No points scored for FIN/SWE on ${date}, no nightly winner.`);
  }
}

async function updateSeasonWins(client: any, date: string) {
  const season = seasonFromDate(date);

  // Get all distinct game_types for the current season up to the current date.
  const distinctGameTypesRes = await client.query(
    `SELECT DISTINCT game_type FROM nhl.games WHERE season = $1 AND game_date <= $2`,
    [season, date]
  );
  const distinctGameTypes = distinctGameTypesRes.rows.map(row => row.game_type);

  for (const gt of distinctGameTypes) {
    const seasonNightlyWinnersRes = await client.query(
      `SELECT night_winner FROM nhl.nightly_nation_agg
       WHERE game_date <= $1 AND night_winner IS NOT NULL
       AND EXISTS (SELECT 1 FROM nhl.games WHERE nhl.games.game_date = nhl.nightly_nation_agg.game_date AND nhl.games.game_type = $2 AND nhl.games.season = $3)`,
      [date, gt, season]
    );

    let finSeasonWins = 0;
    let sweSeasonWins = 0;

    for (const row of seasonNightlyWinnersRes.rows) {
      if (row.night_winner === 'FIN') {
        finSeasonWins++;
      } else if (row.night_winner === 'SWE') {
        sweSeasonWins++;
      }
    }

    // Update FIN's season_nation_agg row
    await client.query(
      `UPDATE nhl.season_nation_agg
       SET fin_night_wins = $1
       WHERE season = $2 AND game_type = $3 AND nation = 'FIN'`,
      [finSeasonWins, season, gt]
    );

    // Update SWE's season_nation_agg row
    await client.query(
      `UPDATE nhl.season_nation_agg
       SET swe_night_wins = $1
       WHERE season = $2 AND game_type = $3 AND nation = 'SWE'`,
      [sweSeasonWins, season, gt]
    );

    console.log(`[ingest] Season wins for ${season} (${gt}): FIN ${finSeasonWins}, SWE ${sweSeasonWins}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});