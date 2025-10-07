import 'dotenv/config';
import { withTx, pool } from './lib/db.js';
import {
  fetchScheduleIdsForDate,
  fetchBoxscore,
  fetchPlayerLanding,
} from './lib/nhl-api.js';
import {
  teamMetaFromBox,
  extractPlayerRowsFromBoxscore,
  tallyFromBoxscoreSummary,
  birthCountryFromLanding,
} from './lib/nhl-data.js';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function seasonFromDate(d: string) {
  const [y, m] = d.split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  const end = start + 1;
  return `${start}${end}`;
}

async function main() {
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const games = await fetchScheduleIdsForDate(date);
  console.log(`[ingest] ${games.length} game(s) on ${date}`);

  const natCache = new Map<number, string | null>();
  let sessionWrote = 0;

  await withTx(async (tx) => {
    for (let i = 0; i < games.length; i++) {
      const { id: gamePk, gameType } = games[i];
      console.log(`[ingest] Processing game ${i + 1}/${games.length} (id=${gamePk}, type=${gameType})`);

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
    await computeNightlyAgg(tx, date); // This will now also store player_count
    await computeSeasonAgg(tx, date);

    // Calculate and update Nightly Winner and Season Wins
    await updateNightlyWinner(tx, date);
    await updateSeasonWins(tx, date);
  });

  console.log(`[ingest] Done for ${date} (session wrote ${sessionWrote})`);
}

function nz(v: any): number | null {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ---------- DB helpers (your schema) ----------
async function upsertTeamReturnId(tx: any, nhl_id: number, name: string, tri: string) {
  const q = `
    INSERT INTO nhl.teams (nhl_id, name, tri_code)
    VALUES ($1, $2, $3)
    ON CONFLICT (nhl_id) DO UPDATE SET
      name = excluded.name,
      tri_code = excluded.tri_code,
      updated_at = NOW()
    RETURNING id;
  `;
  const res = await tx.query(q, [nhl_id, name, tri]);
  return res.rows[0].id;
}

async function upsertGameReturnId(tx: any, game: {
  nhl_game_pk: number;
  game_date: string;
  season: string;
  game_type: string;
  home_team_id: number;
  away_team_id: number;
  status: string;
}) {
  const q = `
    INSERT INTO nhl.games (nhl_game_pk, game_date, season, game_type, home_team_id, away_team_id, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (nhl_game_pk) DO UPDATE SET
      game_date = excluded.game_date,
      season = excluded.season,
      game_type = excluded.game_type,
      home_team_id = excluded.home_team_id,
      away_team_id = excluded.away_team_id,
      status = excluded.status,
      updated_at = NOW()
    RETURNING id;
  `;
  const res = await tx.query(q, [
    game.nhl_game_pk,
    game.game_date,
    game.season,
    game.game_type,
    game.home_team_id,
    game.away_team_id,
    game.status,
  ]);
  return res.rows[0].id;
}

async function upsertPlayerReturnId(tx: any, nhl_id: number, name: string, birth_country: string) {
  const q = `
    INSERT INTO nhl.players (nhl_id, name, birth_country)
    VALUES ($1, $2, $3)
    ON CONFLICT (nhl_id) DO UPDATE SET
      name = excluded.name,
      birth_country = excluded.birth_country,
      updated_at = NOW()
    RETURNING id;
  `;
  const res = await tx.query(q, [nhl_id, name, birth_country]);
  return res.rows[0].id;
}

async function upsertPlayerGameStats(tx: any, stats: {
  game_id: number;
  player_id: number;
  goals: number | null;
  assists: number | null;
  decision?: string | null;
}) {
  const q = `
    INSERT INTO nhl.player_game_stats (game_id, player_id, goals, assists, decision)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (game_id, player_id) DO UPDATE SET
      goals = excluded.goals,
      assists = excluded.assists,
      decision = excluded.decision,
      updated_at = NOW();
  `;
  await tx.query(q, [stats.game_id, stats.player_id, nz(stats.goals), nz(stats.assists), stats.decision || null]);
}

async function computeNightlyAgg(client: any, date: string) {
  const dataToUpsertRes = await client.query(
    `SELECT
      g.game_date,
      p.birth_country AS nation,
      COALESCE(SUM(s.goals), 0) AS goals,
      COALESCE(SUM(s.assists), 0) AS assists,
      COALESCE(SUM(CASE WHEN s.decision = 'W' THEN 1 ELSE 0 END), 0) AS goalie_wins,
      COUNT(DISTINCT p.id)::INTEGER AS player_count
    FROM nhl.player_game_stats s
    JOIN nhl.games g ON s.game_id = g.id
    JOIN nhl.players p ON s.player_id = p.id
    WHERE g.game_date = $1 AND p.birth_country IN ('FIN', 'SWE')
    GROUP BY g.game_date, p.birth_country;`,
    [date]
  );

  console.log(`[ingest:debug] Data calculated for nightly_nation_agg for ${date}:`, dataToUpsertRes.rows);

  // Ensure rows exist for FIN/SWE even if no players/points, so updateNightlyWinner can process them
  const nationsPresent = new Set(dataToUpsertRes.rows.map(row => row.nation));
  const nationsToEnsure = ['FIN', 'SWE'];

  for (const nation of nationsToEnsure) {
    if (!nationsPresent.has(nation)) {
      dataToUpsertRes.rows.push({
        game_date: date,
        nation: nation,
        goals: 0,
        assists: 0,
        goalie_wins: 0,
        player_count: 0
      });
    }
  }

  for (const row of dataToUpsertRes.rows) {
    await client.query(
      `INSERT INTO nhl.nightly_nation_agg (game_date, nation, goals, assists, goalie_wins, player_count, night_winner)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)
       ON CONFLICT (game_date, nation) DO UPDATE SET
         goals = excluded.goals,
         assists = excluded.assists,
         goalie_wins = excluded.goalie_wins,
         player_count = excluded.player_count,
         night_winner = NULL,
         updated_at = NOW();`,
      [row.game_date, row.nation, row.goals, row.assists, row.goalie_wins, row.player_count]
    );
  }
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
      updated_at = now()
  `;
  await client.query(q, [season]);
}

async function updateNightlyWinner(client: any, date: string) {
  const nightlyAggsRes = await client.query(
    `SELECT nation, goals, assists, player_count FROM nhl.nightly_nation_agg WHERE game_date = $1`,
    [date]
  );

  console.log(`[ingest:debug] Data read by updateNightlyWinner for ${date}:`, nightlyAggsRes.rows);

  let finNightlyPoints = 0;
  let sweNightlyPoints = 0;
  let finPlayerCount = 0;
  let swePlayerCount = 0;

  for (const row of nightlyAggsRes.rows) {
    const totalPoints = row.goals + row.assists;
    if (row.nation === 'FIN') {
      finNightlyPoints = totalPoints;
      finPlayerCount = row.player_count;
    } else if (row.nation === 'SWE') {
      sweNightlyPoints = totalPoints;
      swePlayerCount = row.player_count;
    }
  }

  let finScaledScore = 0;
  let sweScaledScore = 0;
  let nightWinner: 'FIN' | 'SWE' | 'TIE' | null = null;

  if (finPlayerCount > 0) {
    finScaledScore = finNightlyPoints / finPlayerCount;
  }
  if (swePlayerCount > 0) {
    sweScaledScore = sweNightlyPoints / swePlayerCount;
  }

  // Determine winner based on scaled scores
  if (finScaledScore > sweScaledScore) {
    nightWinner = 'FIN';
  } else if (sweScaledScore > finScaledScore) {
    nightWinner = 'SWE';
  } else if (finScaledScore === sweScaledScore && (finPlayerCount > 0 || swePlayerCount > 0)) {
    // Tie if scaled scores are equal AND at least one player was present for either
    nightWinner = 'TIE';
  } else if (finPlayerCount === 0 && swePlayerCount === 0) {
    // No players for either nation, no winner
    nightWinner = null;
  } else {
    // This case should ideally not be hit if logic is sound, but as a fallback
    nightWinner = null;
  }


  if (nightWinner) {
    await client.query(
      `UPDATE nhl.nightly_nation_agg SET night_winner = $1 WHERE game_date = $2`,
      [nightWinner, date]
    );
    console.log(`[ingest] Nightly winner for ${date}: ${nightWinner} (FIN G+A: ${finNightlyPoints}, Players: ${finPlayerCount}, Scaled: ${finScaledScore.toFixed(2)} | SWE G+A: ${sweNightlyPoints}, Players: ${swePlayerCount}, Scaled: ${sweScaledScore.toFixed(2)})`);
  } else {
    console.log(`[ingest] No FIN or SWE players/points on ${date}, no nightly winner.`);
  }
}

async function updateSeasonWins(client: any, date: string) {
  const season = seasonFromDate(date);

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

    await client.query(
      `UPDATE nhl.season_nation_agg
       SET fin_night_wins = $1
       WHERE season = $2 AND game_type = $3 AND nation = 'FIN'`,
      [finSeasonWins, season, gt]
    );

    await client.query(
      `UPDATE nhl.season_agg
       SET swe_night_wins = $1
       WHERE season = $2 AND game_type = $3 AND nation = 'SWE'`,
      [sweSeasonWins, season, gt]
    );

    console.log(`[ingest] Season wins for ${season} (${gt}): FIN ${finSeasonWins}, SWE ${sweSeasonWins}`);
  }
}

main().catch((e) => {
  console.error(e);
  pool.end(); // Ensure pool is ended on error
  process.exit(1);
});