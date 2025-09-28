import 'dotenv/config';
import { pool } from '../src/lib/db';
import { formatNightlyTweet, NightlyRow, SeasonRow } from '../src/post/format';

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

function flattenNightly(rows: any[]): NightlyRow {
  const fin = rows.find((r) => r.nation === 'FIN');
  const swe = rows.find((r) => r.nation === 'SWE');
  const base = {
    game_date: fin?.game_date ?? swe?.game_date ?? '????-??-??',
    fin_goals: 0, fin_assists: 0,
    swe_goals: 0, swe_assists: 0,
  };
  if (fin) { base.fin_goals = fin.goals; base.fin_assists = fin.assists; }
  if (swe) { base.swe_goals = swe.goals; base.swe_assists = swe.assists; }
  return base;
}

function flattenSeason(rows: any[]): SeasonRow {
  const fin = rows.find((r) => r.nation === 'FIN');
  const swe = rows.find((r) => r.nation === 'SWE');
  return {
    season: fin?.season ?? swe?.season ?? '????',
    game_type: fin?.game_type ?? swe?.game_type ?? '??',
    fin_goals: fin?.goals ?? 0,
    fin_assists: fin?.assists ?? 0,
    swe_goals: swe?.goals ?? 0,
    swe_assists: swe?.assists ?? 0,
  };
}

async function main() {
  const date = arg('--date', new Date(Date.now() - 24*3600*1000).toISOString().slice(0,10)); // default = yesterday (UTC)
  const season = seasonFromDate(date);

  const nightlyRes = await pool.query(
    `select * from nhl.nightly_nation_agg where game_date = $1`, [date]
  );

  if (nightlyRes.rowCount === 0) {
    console.log(`[post] No nightly data for ${date}. Did ingest run?`);
    process.exit(0);
  }
  const nightlyRow = flattenNightly(nightlyRes.rows);

  // Determine game type for the day and fetch correct season totals
  const gameTypeRes = await pool.query(`select game_type from nhl.games where game_date = $1 limit 1`, [date]);
  const gameType = gameTypeRes.rowCount > 0 ? gameTypeRes.rows[0].game_type : null;

  let seasonRow: SeasonRow | null = null;
  if (gameType) {
    const seasonRes = await pool.query(
      `select * from nhl.season_nation_agg where season = $1 and game_type = $2`,
      [season, gameType]
    );
    if (seasonRes.rowCount > 0) {
      seasonRow = flattenSeason(seasonRes.rows);
    }
  }

  const text = formatNightlyTweet(nightlyRow, seasonRow, gameType);
  const { postTweet } = await import('../src/post/twitter');
  await postTweet(text);
}

main().then(()=>pool.end()).catch(e => {
  console.error('[post] Error', e);
  pool.end().then(()=>process.exit(1));
});