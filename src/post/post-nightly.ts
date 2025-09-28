// scripts/post-nightly.ts
import 'dotenv/config';
import { pool } from '../src/lib/db';
import { formatNightlyTweet } from '../src/post/format';

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
  const date = arg('--date', new Date(Date.now() - 24*3600*1000).toISOString().slice(0,10)); // default = yesterday (UTC)
  const season = seasonFromDate(date);

  const nightly = await pool.query(
    `select game_date, fin_goals, fin_assists, swe_goals, swe_assists
     from nhl.v_nightly_fin_swe where game_date = $1`, [date]
  );

  if (nightly.rowCount === 0) {
    console.log(`[post] No nightly data for ${date}. Did ingest run?`);
    process.exit(0);
  }

  const seasonQ = await pool.query(
    `select season, fin_goals, fin_assists, swe_goals, swe_assists
     from nhl.v_season_fin_swe where season = $1`, [season]
  );

  const n = nightly.rows[0];
  const s = seasonQ.rowCount ? seasonQ.rows[0] : null;

  const text = formatNightlyTweet(n, s);
  const { postTweet } = await import('../src/post/twitter');
  await postTweet(text);
}

main().then(()=>pool.end()).catch(e => {
  console.error(e);
  pool.end().then(()=>process.exit(1));
});
