import { fetchSchedule, extractGameIdsForDate, fetchGameBoxscore } from '../src/lib/nhl.js';

async function run() {
  const date = process.argv[2] || '2024-10-12';
  const schedule = await fetchSchedule(date);
  const ids = extractGameIdsForDate(schedule, date);
  console.log(`date=${date} gameIds=`, ids);

  for (const id of ids) {
    const box = await fetchGameBoxscore(id);
    const list = Array.isArray(box?.playerByGameStats) ? box.playerByGameStats : [];
    console.log(`game ${id}: playerByGameStats length = ${list.length}`);
    if (!list.length) {
      // Show a sample of the boxscore keys so we can adapt parser
      console.log('boxscore keys:', Object.keys(box));
    } else {
      // Show first two entries to confirm field names
      console.log('sample rows:', list.slice(0, 2));
    }
  }
}
run().catch(e => { console.error(e); process.exit(1); });
