// src/lib/nhl.ts
// NHL Web API helpers (api-web.nhle.com/v1 only), adapted to the 2025-09 payload you posted.

type Json = any;

// ---------- SCHEDULE (ONLY the exact date’s game IDs) ----------
export async function fetchScheduleIdsForDate(dateISO: string): Promise<number[]> {
  const url = `https://api-web.nhle.com/v1/schedule/${dateISO}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`schedule ${dateISO} HTTP ${res.status}`);
  const json: Json = await res.json();

  // The payload is a "week" block; filter by that exact day.
  const out: number[] = [];
  const weeks = json?.gameWeek ?? [];
  for (const wk of weeks) {
    const wkDate = String(wk?.date ?? '').slice(0, 10);
    if (wkDate !== dateISO) continue;
    for (const g of wk?.games ?? []) {
      const id = g?.id ?? g?.gameId ?? g?.gamePk;
      if (typeof id === 'number') out.push(id);
    }
  }
  return out;
}

// ---------- BOXSCORE ----------
export async function fetchBoxscore(gameId: number): Promise<Json> {
  const url = `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`boxscore ${gameId} HTTP ${res.status}`);
  return res.json();
}

// Minimal team/date info
export function teamMetaFromBox(box: Json) {
  const homeAbbr = String(box?.homeTeam?.abbrev ?? '').toUpperCase();
  const awayAbbr = String(box?.awayTeam?.abbrev ?? '').toUpperCase();
  const homeId = Number(box?.homeTeam?.id);
  const awayId = Number(box?.awayTeam?.id);
  const homeName = box?.homeTeam?.placeName?.default ?? box?.homeTeam?.commonName?.default ?? homeAbbr;
  const awayName = box?.awayTeam?.placeName?.default ?? box?.awayTeam?.commonName?.default ?? awayAbbr;
  const gameDate = String(box?.gameDate ?? '').slice(0, 10);
  return {
    gameDate,
    home: { nhl_id: homeId, name: homeName, abbr: homeAbbr },
    away: { nhl_id: awayId, name: awayName, abbr: awayAbbr },
  };
}

// ---------- PLAYER LANDING (nationality) ----------
export async function fetchPlayerLanding(playerId: number): Promise<Json> {
  const url = `https://api-web.nhle.com/v1/player/${playerId}/landing`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`player ${playerId} HTTP ${res.status}`);
  return res.json();
}

export function birthCountryFromLanding(landing: Json): string | null {
  const raw =
    landing?.playerBio?.birthCountry ??
    landing?.player?.birthCountry ??
    landing?.bio?.birthCountry ??
    landing?.birthCountry ??
    landing?.playerBirthCountryCode ??
    null;

  if (!raw || typeof raw !== 'string') return null;
  const v = raw.toUpperCase();
  if (v.startsWith('FIN')) return 'FIN';
  if (v.startsWith('SWE')) return 'SWE';
  return v.length <= 3 ? v : null;
}

// ---------- Player rows from boxscore.playerByGameStats.* ----------
export type PlayerRow = {
  playerId: number;
  name: string | null;
  teamAbbrev: string | null;
  isGoalie: boolean;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  pim: number | null;
  toi: string | null;
  saves: number | null;
  shotsAgainst: number | null;
  goalsAgainst: number | null;
  decision: string | null;
};

/**
 * Handles the shape you pasted:
 *   playerByGameStats.awayTeam.{forwards, defense, goalies}[]
 *   playerByGameStats.homeTeam.{forwards, defense, goalies}[]
 */
export function extractPlayerRowsFromBoxscore(box: Json): PlayerRow[] {
  const rows: PlayerRow[] = [];

  const teamNodes = [
    { side: 'home', team: box?.homeTeam, abbr: String(box?.homeTeam?.abbrev ?? '').toUpperCase() },
    { side: 'away', team: box?.awayTeam, abbr: String(box?.awayTeam?.abbrev ?? '').toUpperCase() },
  ];

  const pgs = box?.playerByGameStats ?? {};
  const pgsHome = pgs?.homeTeam ?? {};
  const pgsAway = pgs?.awayTeam ?? {};

  const take = (arr: any[] | undefined, isGoalie: boolean, teamAbbrev: string | null) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      const pid = Number(p?.playerId ?? p?.id);
      if (!Number.isFinite(pid)) continue;
      const name =
        p?.name?.default ??
        p?.name?.full ??
        p?.firstLastName ??
        p?.fullName ??
        p?.playerName ??
        null;

      if (!isGoalie) {
        // Skater keys per your payload
        rows.push({
          playerId: pid,
          name,
          teamAbbrev,
          isGoalie: false,
          goals: num(p?.goals),
          assists: num(p?.assists),
          shots: num(p?.sog ?? p?.shots),
          pim: num(p?.pim),
          toi: str(p?.toi ?? p?.timeOnIce),
          saves: null,
          shotsAgainst: null,
          goalsAgainst: null,
          decision: null,
        });
      } else {
        rows.push({
          playerId: pid,
          name,
          teamAbbrev,
          isGoalie: true,
          goals: null,
          assists: null,
          shots: null,
          pim: null,
          toi: str(p?.toi ?? p?.timeOnIce),
          saves: num(p?.saves),
          shotsAgainst: num(p?.shotsAgainst),
          goalsAgainst: num(p?.goalsAgainst),
          decision: str(p?.decision),
        });
      }
    }
  };

  // HOME
  take(pgsHome?.forwards, false, teamNodes[0].abbr);
  take(pgsHome?.defense,  false, teamNodes[0].abbr);
  take(pgsHome?.goalies,  true,  teamNodes[0].abbr);

  // AWAY
  take(pgsAway?.forwards, false, teamNodes[1].abbr);
  take(pgsAway?.defense,  false, teamNodes[1].abbr);
  take(pgsAway?.goalies,  true,  teamNodes[1].abbr);

  return rows;
}

// ---------- Fallback: goals/assists from boxscore.summary (kept for safety) ----------
export type PlayerTallies = {
  [playerId: number]: { goals: number; assists: number; name?: string | null; teamAbbrev?: string | null };
};

export function tallyFromBoxscoreSummary(box: Json): PlayerTallies {
  const tallies: PlayerTallies = {};
  const root = box?.summary;
  if (!root) return tallies;

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const hasGA = node.scorer && Array.isArray(node.assists);
    if (hasGA) {
      const s = node.scorer;
      addGA(tallies, s?.playerId, 'goal', s?.name?.default ?? s?.playerName, s?.teamAbbrev ?? s?.teamAbbreviation);
      for (const a of node.assists) {
        addGA(tallies, a?.playerId, 'assist', a?.name?.default ?? a?.playerName, a?.teamAbbrev ?? a?.teamAbbreviation);
      }
    }
    for (const k of Object.keys(node)) {
      const v = (node as any)[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  };

  visit(root);
  return tallies;
}

function addGA(
  tallies: PlayerTallies,
  playerIdRaw: any,
  kind: 'goal' | 'assist',
  name?: string | null,
  teamAbbrev?: string | null
) {
  const playerId = Number(playerIdRaw);
  if (!Number.isFinite(playerId)) return;
  if (!tallies[playerId]) tallies[playerId] = { goals: 0, assists: 0, name: name ?? null, teamAbbrev: teamAbbrev ?? null };
  if (kind === 'goal') tallies[playerId].goals += 1;
  else tallies[playerId].assists += 1;
}

function num(x: any): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function str(x: any): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x);
  return s.length ? s : null;
}
