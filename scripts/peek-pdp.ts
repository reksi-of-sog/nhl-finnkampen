// scripts/peek-pbp.ts
import 'dotenv/config';
import { fetchPlayByPlay } from '../src/lib/nhl';

const gameId = Number(process.argv[2]);
if (!gameId) {
  console.error('Usage: npm run peek:pbp -- <gameId>');
  process.exit(1);
}

(async () => {
  const pbp = await fetchPlayByPlay(gameId);
  const plays = pbp?.plays ?? pbp?.gameCenter?.plays ?? [];
  const goals = plays.filter((p: any) => {
    const k = String(p?.typeDescKey || p?.type || p?.eventType || '').toLowerCase();
    return k.includes('goal');
  });
  console.log(`gameId=${gameId} plays=${plays.length} goal_plays=${goals.length}`);
  if (goals[0]) {
    console.log('example goal play:', JSON.stringify(goals[0], null, 2).slice(0, 1200));
  }
})();
