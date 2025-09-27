import { withTx, pool } from './lib/db.js';
[
s.game_id, s.nhl_game_pk, s.player_id, s.team_id, s.is_goalie,
s.goals, s.assists, s.shots, s.pim, s.toi,
s.saves, s.shots_against, s.goals_against, s.decision, s.shutout
]
);
}


async function computeNightlyAgg(client: any, date: string) {
// Aggregate FIN/SWE for one date
await client.query('delete from nhl.nightly_nation_agg where game_date = $1', [date]);
await client.query(
`insert into nhl.nightly_nation_agg (game_date, nation, goals, assists, goalie_wins, shutouts)
select $1 as game_date, nation, coalesce(sum(goals),0) as goals, coalesce(sum(assists),0) as assists,
coalesce(sum(case when is_goalie and decision = 'W' then 1 else 0 end),0) as goalie_wins,
coalesce(sum(case when is_goalie and shutout then 1 else 0 end),0) as shutouts
from (
select pgs.*, case
when no.nation is not null then no.nation
when upper(pl.birth_country) like 'FIN%' then 'FIN'
when upper(pl.birth_country) like 'SWE%' then 'SWE'
else null end as nation
from nhl.player_game_stats pgs
join nhl.players pl on pl.id = pgs.player_id
left join nhl.nationality_overrides no on no.player_id = pl.id
join nhl.games g on g.id = pgs.game_id
where g.game_date = $1
) t
where nation in ('FIN','SWE')
group by nation`
, [date]);
}


async function computeSeasonAgg(client: any, season: string) {
// Recompute season aggregates for FIN/SWE for the season
await client.query('delete from nhl.season_nation_agg where season = $1', [season]);
await client.query(
`insert into nhl.season_nation_agg (season, nation, goals, assists, goalie_wins, shutouts)
select $1 as season, nation, coalesce(sum(goals),0), coalesce(sum(assists),0),
coalesce(sum(case when is_goalie and decision = 'W' then 1 else 0 end),0),
coalesce(sum(case when is_goalie and shutout then 1 else 0 end),0)
from (
select pgs.*, case
when no.nation is not null then no.nation
when upper(pl.birth_country) like 'FIN%' then 'FIN'
when upper(pl.birth_country) like 'SWE%' then 'SWE'
else null end as nation
from nhl.player_game_stats pgs
join nhl.players pl on pl.id = pgs.player_id
left join nhl.nationality_overrides no on no.player_id = pl.id
join nhl.games g on g.id = pgs.game_id
where g.season = $1
) t
where nation in ('FIN','SWE')
group by nation`
, [season]);
}


main().catch((e) => {
console.error(e);
process.exit(1);
});