// src/post/format.ts
export type NightlyRow = {
  game_date: string;
  fin_goals: number; fin_assists: number;
  swe_goals: number; swe_assists: number;
};

export type SeasonRow = {
  season: string;
  fin_goals: number; fin_assists: number;
  swe_goals: number; swe_assists: number;
};

function flag(nation: 'FIN'|'SWE') {
  return nation === 'FIN' ? '🇫🇮' : '🇸🇪';
}

export function formatNightlyTweet(n: NightlyRow, s: SeasonRow | null) {
  const date = n.game_date;
  const a = (x:number)=>String(x);

  const finLine = `${flag('FIN')} FIN  ${a(n.fin_goals)} G, ${a(n.fin_assists)} A`;
  const sweLine = `${flag('SWE')} SWE ${a(n.swe_goals)} G, ${a(n.swe_assists)} A`;

  const header = `NHL last night — ${date}`;
  const body = `${finLine}\n${sweLine}`;

  const seasonPart = s
    ? `\n\nSeason to date (${s.season}):\n${flag('FIN')} ${s.fin_goals} G, ${s.fin_assists} A\n${flag('SWE')} ${s.swe_goals} G, ${s.swe_assists} A`
    : '';

  const tags = `\n\n#NHL #Finland #Sweden #Finnkampen`;
  let tweet = `${header}\n\n${body}${seasonPart}${tags}`;

  // X hard limit safe-guard (280)
  if (tweet.length > 280) {
    tweet = `${header}\n\n${body}${tags}`;
  }
  return tweet;
}
