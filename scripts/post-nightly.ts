import 'dotenv/config'; // To load environment variables from .env
import { pool } from '../src/lib/db.js';
import { seasonFromDate } from '../src/lib/util.js';
import { TwitterApi } from 'twitter-api-v2';

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
      finNightlyGoals = Number(row.goals);
      finNightlyAssists = Number(row.assists);
      finPlayerCount = Number(row.player_count);
    } else if (row.nation === 'SWE') {
      sweNightlyGoals = Number(row.goals);
      sweNightlyAssists = Number(row.assists);
      swePlayerCount = Number(row.player_count);
    }
    if (row.night_winner) {
      nightlyWinner = row.night_winner;
    }
  }

  const finNightlyPoints = finNightlyGoals + finNightlyAssists;
  const sweNightlyPoints = sweNightlyGoals + sweNightlyAssists;

  // 2. Determine gameType for the date
  const gameTypeRes = await pool.query(
    `SELECT DISTINCT game_type FROM nhl.games WHERE game_date = $1 AND season = $2 LIMIT 1`,
    [date, season]
  );
  const gameType = gameTypeRes.rows.length > 0 ? gameTypeRes.rows[0].game_type : 'PR'; // Default to PR if not found

  console.log(`[post] Determined gameType for ${date}: ${gameType}`);

  // 3. Calculate season aggregates (goals, assists) up to this date by summing player stats
  const seasonGoalsAssistsRes = await pool.query(
    `SELECT
      p.birth_country AS nation,
      COALESCE(SUM(s.goals), 0) AS goals,
      COALESCE(SUM(s.assists), 0) AS assists
    FROM nhl.player_game_stats s
    JOIN nhl.games g ON s.game_id = g.id
    JOIN nhl.players p ON s.player_id = p.id
    WHERE g.season = $1
      AND g.game_type = $2
      AND g.game_date::DATE <= $3::DATE
      AND p.birth_country IN ('FIN', 'SWE')
    GROUP BY p.birth_country;`,
    [season, gameType, date]
  );

  let finSeasonGoals = 0, finSeasonAssists = 0;
  let sweSeasonGoals = 0, sweSeasonAssists = 0;

  for (const row of seasonGoalsAssistsRes.rows) {
    if (row.nation === 'FIN') {
      finSeasonGoals = Number(row.goals);
      finSeasonAssists = Number(row.assists);
    } else if (row.nation === 'SWE') {
      sweSeasonGoals = Number(row.goals);
      sweSeasonAssists = Number(row.assists);
    }
  }

  const finSeasonPoints = finSeasonGoals + finSeasonAssists;
  const sweSeasonPoints = sweSeasonGoals + sweSeasonAssists;

  // 4. Calculate season wins up to this date by counting distinct nightly winners
  const seasonNightlyWinnersRes = await pool.query(
    `SELECT DISTINCT ON (nna.game_date) nna.night_winner
     FROM nhl.nightly_nation_agg nna
     WHERE nna.game_date::DATE <= $1::DATE
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

  // --- TWEET CONTENT ---
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

  const seasonLabel = gameType === 'PR' ? 'Pre-season' : 'Regular Season';
  tweet += `${seasonLabel}:\n`;
  tweet += `🇫🇮 ${finSeasonGoals} G, ${finSeasonAssists} A, ${finSeasonPoints} Pts (${finSeasonWins} wins)\n`;
  tweet += `🇸🇪 ${sweSeasonGoals} G, ${sweSeasonAssists} A, ${sweSeasonPoints} Pts (${sweSeasonWins} wins)\n\n`;

  // Determine which hashtag to use based on the day of the month. Just two hashtags to choose from.
  const dayOfMonth = new Date(date).getDate();
  if (dayOfMonth % 2 === 0) { // Even day
    tweet += `#nhlfi`;
  } else { // Odd day
    tweet += `#nhlse`;
  }

  // Append a unique timestamp to the tweet content for debugging duplicate issues
  tweet += `\n\n(Debug ID: ${new Date().toISOString()})`;
  // --- END TWEET CONTENT ---


  if (process.env.TWITTER_ENABLE === '1') {
    console.log(`[post] Sending tweet:\n${tweet}`);
    console.log('[post:debug] Attempting to initialize Twitter client...');
    try {
      // Ensure all environment variables are defined
      if (!process.env.TWITTER_APP_KEY || !process.env.TWITTER_APP_SECRET || !process.env.TWITTER_ACCESS_TOKEN || !process.env.TWITTER_ACCESS_SECRET) {
        console.error('[post:error] Missing one or more Twitter API credentials in environment variables.');
        return; // Exit early if credentials are missing
      }

      const client = new TwitterApi({
        appKey: process.env.TWITTER_APP_KEY!,
        appSecret: process.env.TWITTER_APP_SECRET!,
        accessToken: process.env.TWITTER_ACCESS_TOKEN!,
        accessSecret: process.env.TWITTER_ACCESS_SECRET!,
      });
      console.log('[post:debug] Twitter client initialized. Attempting to send tweet...');

      await client.v2.tweet(tweet);
      console.log('[post] Tweet sent successfully!');
    } catch (error) {
      console.error('[post:error] Error sending tweet:', error);
      if (error instanceof Error) {
        console.error('[post:error] Error name:', error.name);
        console.error('[post:error] Error message:', error.message);
        if ('code' in error) console.error('[post:error] Error code:', (error as any).code);
        if ('data' in error) console.error('[post:error] Error data:', (error as any).data);
      }
    }
  } else {
    console.log(`[post] Skipped (TWITTER_ENABLE!=1):\n${tweet}`);
  }
}

main().catch((e) => {
  console.error(e);
  pool.end();
  process.exit(1);
});