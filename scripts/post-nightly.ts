import 'dotenv/config';
import { pool } from '../src/lib/db.js';
import { seasonFromDate } from '../src/ingest.js'; // Import seasonFromDate

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const season = seasonFromDate(date);

  // 1. Fetch nightly aggregates for the specified date
  const nightlyAggsRes = await pool.query(
    `SELECT nation, goals, assists, player_count, night_winner FROM nhl.nightly_nation_agg WHERE game_date = $1`,
    [date]
  );

  let finNightlyGoals = 0, finNightlyAssists = 0, finPlayerCount = 0;
  let sweNightlyGoals = 0, sweNightlyAssists = 0, swePlayerCount = 0;
  let nightlyWinner: string | null = null;

  for (const row of nightlyAggsRes.rows) {
    if (row.nation === 'FIN') {
      finNightlyGoals = row.goals;
      finNightlyAssists = row.assists;
      finPlayerCount = row.player_count;
    } else if (row.nation === 'SWE') {
      sweNightlyGoals = row.goals;
      sweNightlyAssists = row.assists;
      swePlayerCount = row.player_count;
    }
    if (row.night_winner) {
      nightlyWinner = row.night_winner;
    }
  }

  const finNightlyPoints = finNightlyGoals + finNightlyAssists;
  const sweNightlyPoints = sweNightlyGoals + sweNightlyAssists;

  // 2. Determine gameType for the date (assuming all games on a date have the same type for simplicity here)
  const gameTypeRes = await pool.query(
    `SELECT DISTINCT game_type FROM nhl.games WHERE game_date = $1 AND season = $2 LIMIT 1`,
    [date, season]
  );
  const gameType = gameTypeRes.rows.length > 0 ? gameTypeRes.rows[0].game_type : 'PR'; // Default to PR if not found

  console.log(`[post] Determined gameType for ${date}: ${gameType}`);

  // 3. Fetch season aggregates (goals, assists) up to this date from season_nation_agg
  const seasonAggsRes = await pool.query(
    `SELECT nation, goals, assists
     FROM nhl.season_nation_agg
     WHERE season = $1 AND game_type = $2`,
    [season, gameType]
  );

  let finSeasonGoals = 0, finSeasonAssists = 0;
  let sweSeasonGoals = 0, sweSeasonAssists = 0;

  for (const row of seasonAggsRes.rows) {
    if (row.nation === 'FIN') {
      finSeasonGoals = row.goals;
      finSeasonAssists = row.assists;
    } else if (row.nation === 'SWE') {
      sweSeasonGoals = row.goals;
      sweSeasonAssists = row.assists;
    }
  }

  const finSeasonPoints = finSeasonGoals + finSeasonAssists;
  const sweSeasonPoints = sweSeasonGoals + sweSeasonAssists;

  // 4. CRITICAL: Calculate season wins up to this date by counting distinct nightly winners
  const seasonNightlyWinnersRes = await pool.query(
    `SELECT DISTINCT ON (nna.game_date) nna.night_winner
     FROM nhl.nightly_nation_agg nna
     WHERE nna.game_date::DATE <= $1::DATE -- Filter up to the specified date
       AND nna.night_winner IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM nhl.games g
         WHERE g.game_date::DATE = nna.game_date::DATE
           AND g.game_type = $2
           AND g.season = $3
       )
     ORDER BY nna.game_date, nna.nation`,
    [date, gameType, season]
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

  // Format the tweet
  let tweet = `NHL i går kväll / viime yö:  ${date}\n\n`;
  tweet += `🇫🇮 FIN  ${finNightlyGoals} G, ${finNightlyAssists} A, ${finNightlyPoints} P\n`;
  tweet += `🇸🇪 SWE ${sweNightlyGoals} G, ${sweNightlyAssists} A, ${sweNightlyPoints} P\n`;

  if (nightlyWinner) {
    tweet += `${nightlyWinner === 'FIN' ? '🇫🇮' : '🇸🇪'} voitti illan/vann kvällen!\n\n`;
  } else {
    tweet += `Ingen vinnare / Ei voittajaa (inga spelare / ei pelaajia)\n\n`;
  }

  if (finPlayerCount > 0 || swePlayerCount > 0) {
    const finScaled = finPlayerCount > 0 ? (finNightlyPoints / finPlayerCount).toFixed(2) : '0.00';
    const sweScaled = swePlayerCount > 0 ? (sweNightlyPoints / swePlayerCount).toFixed(2) : '0.00';
    tweet += `(Per player: 🇫🇮 ${finPlayerCount}p, ${finScaled} | 🇸🇪 ${swePlayerCount}p, ${sweScaled})\n\n`;
  }

  tweet += `Pre-season:\n`;
  tweet += `🇫🇮 ${finSeasonGoals} G, ${finSeasonAssists} A, ${finSeasonPoints} P (${finSeasonWins} voittoa)\n`;
  tweet += `🇸🇪 ${sweSeasonGoals} G, ${sweSeasonAssists} A, ${sweSeasonPoints} P (${sweSeasonWins} voittoa)\n\n`;

  tweet += `#nhlfi #nhlsv #Finnkampen #jääkiekko #ishockey #leijonat #trekronor`;

  if (process.env.TWITTER_ENABLE === '1') {
    // In a real scenario, you'd send the tweet here
    console.log(`[post] Sending tweet:\n${tweet}`);
  } else {
    console.log(`[post] Skipped (TWITTER_ENABLE!=1):\n${tweet}`);
  }
}

main().catch((e) => {
  console.error(e);
  pool.end();
  process.exit(1);
});