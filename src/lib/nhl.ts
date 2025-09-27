import { request } from 'undici';


const BASE = 'https://statsapi.web.nhl.com/api/v1';


export async function fetchSchedule(date: string) {
const url = `${BASE}/schedule?date=${date}`;
const { body } = await request(url);
return await body.json();
}


export async function fetchGameBoxscore(gamePk: number) {
const url = `${BASE}/game/${gamePk}/boxscore`;
const { body } = await request(url);
return await body.json();
}


export function isoNationFromBirthCountry(raw?: string | null): 'FIN' | 'SWE' | null {
if (!raw) return null;
const v = raw.toUpperCase();
if (v.startsWith('FIN')) return 'FIN';
if (v.startsWith('SWE')) return 'SWE';
return null;
}