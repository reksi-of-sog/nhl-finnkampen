// src/post/format.ts
export type NightlyRow = {
  game_date: string;
  fin_goals: number; fin_assists: number;
  swe_goals: number; swe_assists: number;
  night_winner: 'FIN' | 'SWE' | 'TIE' | null; // Added for night wins
};

export type SeasonRow = {
  season: string;
  game_type: string;
  fin_goals: number; fin_assists: number;
  swe_goals: number; swe_assists: number;
  fin_night_wins: number; // Added for season night wins
  swe_night_wins: number; // Added for season night wins
};

function flag(nation: 'FIN'|'SWE') {
  return nation === 'FIN' ? '🇫🇮' : '🇸🇪';
}

export function formatNightlyTweet(n: NightlyRow, s: SeasonRow | null, gameType: string | null) {
  const d = new Date(n.game_date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
  const year = d.getFullYear();
  const date = `${day}.${month}.${year}`;

  const a = (x:number)=>String(x);

  // Calculate nightly points
  const finNightlyPoints = n.fin_goals + n.fin_assists;
  const sweNightlyPoints = n.swe_goals + n.swe_assists;

  const finLine = `${flag('FIN')} FIN  ${a(n.fin_goals)} G, ${a(n.fin_assists)} A, ${a(finNightlyPoints)} P`;
  const sweLine = `${flag('SWE')} SWE ${a(n.swe_goals)} G, ${a(n.swe_assists)} A, ${a(sweNightlyPoints)} P`;

  let nightlyWinnerLine = '';
  if (n.night_winner === 'FIN') {
    nightlyWinnerLine = `\n${flag('FIN')} voitti illan/vann kvällen!`; // FIN won the night!
  } else if (n.night_winner === 'SWE') {
    nightlyWinnerLine = `\n${flag('SWE')} voitti illan/vann kvällen!`; // SWE won the night!
  } else if (n.night_winner === 'TIE') {
    nightlyWinnerLine = `\nDeuce!.`; // Tie in nightly points.
  }

  const header = `NHL i går kväll / viime yö:  ${date}`;
  const body = `${finLine}\n${sweLine}${nightlyWinnerLine}`;

  const seasonHeader = gameType === 'PR'
    ? `Harjoituskausi - Försäsongen (${s?.season}):`
    : `Kausitilastot - Säsongen totalt (${s?.season}):`;

  let seasonPart = '';
  if (s) {
    // Calculate season points
    const finSeasonPoints = s.fin_goals + s.fin_assists;
    const sweSeasonPoints = s.swe_goals + s.swe_assists;
    seasonPart = `\n\n${seasonHeader}\n${flag('FIN')} ${s.fin_goals} G, ${s.fin_assists} A, ${finSeasonPoints} P (${s.fin_night_wins} voittoa)\n${flag('SWE')} ${s.swe_goals} G, ${s.swe_assists} A, ${sweSeasonPoints} P (${s.swe_night_wins} voittoa)`;
  }

  const tags = `\n\n#nhlfi #nhlsv #Finnkampen #jääkiekko #ishockey #leijonat #trekronor`;
  let tweet = `${header}\n\n${body}${seasonPart}${tags}`;

  // Final sanity check for length
  if (tweet.length > 280) {
    tweet = `${header}\n\n${body}${seasonPart}`; // Drop tags if too long
  }
  if (tweet.length > 280) {
    tweet = `${header}\n\n${body}`; // Drop season too
  }

  return tweet;
}