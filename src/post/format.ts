export type NightlyRow = {
  game_date: string;
  fin_goals: number; fin_assists: number;
  swe_goals: number; swe_assists: number;
  night_winner: 'FIN' | 'SWE' | 'TIE' | null;
  fin_player_count: number;
  swe_player_count: number;
};

export type SeasonRow = {
  season: string;
  game_type: string;
  fin_goals: number; fin_assists: number;
  swe_goals: number; swe_assists: number;
  fin_night_wins: number;
  swe_night_wins: number;
};

function flag(nation: string): string {
  if (nation === 'FIN') return '🇫🇮';
  if (nation === 'SWE') return '🇸🇪';
  return '';
}

export function formatNightlyTweet(n: NightlyRow, s: SeasonRow | null, gameType: string | null) {
  const date = new Date(n.game_date).toLocaleDateString('sv-SE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const finPoints = n.fin_goals + n.fin_assists;
  const swePoints = n.swe_goals + n.swe_assists;

  const finLine = `${flag('FIN')} FIN  ${n.fin_goals} G, ${n.fin_assists} A, ${finPoints} P`;
  const sweLine = `${flag('SWE')} SWE ${n.swe_goals} G, ${n.swe_assists} A, ${swePoints} P`;

  let nightlyWinnerLine = '';
  if (n.night_winner === 'FIN') {
    nightlyWinnerLine = `\n🇫🇮 voitti illan/vann kvällen!`;
  } else if (n.night_winner === 'SWE') {
    nightlyWinnerLine = `\n🇸🇪 voitti illan/vann kvällen!`;
  } else if (n.night_winner === 'TIE') {
    nightlyWinnerLine = `\nTasapeli illan/Oavgjort kvällen!`;
  }

  let handicapLine = '';
  if (n.fin_player_count > 0 || n.swe_player_count > 0) {
    const finScaled = n.fin_player_count > 0 ? (finPoints / n.fin_player_count).toFixed(2) : '0.00';
    const sweScaled = n.swe_player_count > 0 ? (swePoints / n.swe_player_count).toFixed(2) : '0.00';
    handicapLine = `\n\n(Per player: 🇫🇮 ${n.fin_player_count}p, ${finScaled} | 🇸🇪 ${n.swe_player_count}p, ${sweScaled})`;
  }

  const header = `NHL i går kväll / viime yö:  ${date}`;
  const body = `${finLine}\n${sweLine}${nightlyWinnerLine}${handicapLine}`;

  const seasonHeader = gameType === 'PR'
    ? `Pre-season:`
    : `Season total:`;

  let seasonPart = '';
  if (s) {
    const finSeasonPoints = s.fin_goals + s.fin_assists;
    const sweSeasonPoints = s.swe_goals + s.swe_assists;
    seasonPart = `\n\n${seasonHeader}\n${flag('FIN')} ${s.fin_goals} G, ${s.fin_assists} A, ${finSeasonPoints} P (${s.fin_night_wins} voittoa)\n${flag('SWE')} ${s.swe_goals} G, ${s.swe_assists} A, ${sweSeasonPoints} P (${s.swe_night_wins} voittoa)`;
  }

  const hashtags = '#nhlfi #nhlsv #Finnkampen #jääkiekko #ishockey #leijonat #trekronor';

  return `${header}\n\n${body}${seasonPart}\n\n${hashtags}`;
}