import 'dotenv/config';
import { pool } from '../src/lib/db.js'; // Assuming db.js is in src/lib
import { formatNightlyTweet, NightlyRow, SeasonRow } from '../src/post/format.js'; // Assuming format.js is in src/post

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

// Helper to flatten nightly aggregate rows into a single NightlyRow object
function flattenNightly(rows: any[]): NightlyRow {
  const fin = rows.find(r => r.nation === 'FIN') || {};
  const swe = rows.find(r => r.nation === 'SWE') || {};
  return {
    game_date: rows[0]?.game_date || '',
    fin_goals: fin.goals || 0,
    fin_assists: fin.assists || 0,
    swe_goals: swe.goals || 0,
    swe_assists: swe.assists || 0,
    night_winner: rows[0]?.night_winner || null, // Ensure night_winner is included
  };
}

// Helper to flatten season aggregate rows into a single SeasonRow object
function flattenSeason(rows: any[]): SeasonRow {
  const fin = rows.find(r => r.nation === 'FIN') || {};
  const swe = rows.find(r => r.nation === 'SWE') || {};
  return {
    season: rows[0]?.season || '',
    game_type: rows[0]?.game_type || '',
    fin_goals: fin.goals || 0,
    fin_assists: fin.assists || 0,
    swe_goals: swe.goals || 0,
    swe_assists: swe.assists || 0,
    fin_night_wins: fin.fin_night_wins || 0, // ADDED: Ensure fin_night_wins is included
    swe_night_wins: swe.swe_night_wins || 0, // ADDED: Ensure swe_night_wins is included
  };
}

async function main() {
  const date = arg('--date', new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)); // default = yesterday (UTC)
  const season = seasonFromDate(date);
  const twitterEnable = arg('TWITTER_ENABLE', process.env.TWITTER_ENABLE || '0');

  try {
    // Fetch nightly aggregates
    const nightlyRes = await pool.query(
      `SELECT game_date, nation, goals, assists, night_winner FROM nhl.nightly_nation_agg WHERE game_date = $1`,
      [date]
    );
    const nightlyAgg = flattenNightly(nightlyRes.rows);

    // Determine gameType for header and season aggregates
    const gameTypeRes = await pool.query(
      `SELECT DISTINCT game_type FROM nhl.games WHERE game_date = $1 LIMIT 1`,
      [date]
    );
    const gameType = gameTypeRes.rows[0]?.game_type || null;
    console.log(`[post] Determined gameType for ${date}: ${gameType}`); // ADDED: Log gameType

    // Fetch season aggregates
    const seasonRes = await pool.query(
      `SELECT season, game_type, nation, goals, assists, fin_night_wins, swe_night_wins
       FROM nhl.season_nation_agg
       WHERE season = $1 AND game_type = $2`,
      [season, gameType]
    );
    const seasonAgg = flattenSeason(seasonRes.rows);

    const tweet = formatNightlyTweet(nightlyAgg, seasonAgg, gameType);

    if (twitterEnable === '1') {
      // Your Twitter posting logic would go here
      // For now, we'll just log it as skipped
      console.log('[post] Twitter posting is enabled, but actual posting logic is commented out for now.');
      console.log(tweet); // Log the tweet even if posting is enabled
    } else {
      console.log('[post] Skipped (TWITTER_ENABLE!=1):\n', tweet);
    }
  } catch (e) {
    console.error('[post] Error during main execution:', e);
    process.exit(1); // Exit with error code if something goes wrong
  } finally {
    // Ensure pool is always ended, even if errors occur
    try {
      await pool.end();
    } catch (e) {
      console.error('[post] Error ending database pool:', e);
      // Do not re-exit here, as main() might have already exited or is about to.
    }
  }
}

main(); // Call main directly, the finally block handles pool.end()