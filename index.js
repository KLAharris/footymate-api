require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const cors = require('cors');

const app = express();
const cache = new NodeCache();

app.use(cors());
app.use(express.json());

// ─── BSD client ────────────────────────────────────────────────────────────────

const bsd = axios.create({
  baseURL: 'https://sports.bzzoiro.com/api',
  headers: { Authorization: `Token ${process.env.BSD_TOKEN || 'ca760e5641a9678ade27e44435cf07889991ca7f'}` },
  timeout: 15000,
});

const espn = axios.create({
  baseURL: 'https://site.api.espn.com/apis/v2/sports/soccer',
  timeout: 15000,
});

const espnSite = axios.create({
  baseURL: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
  timeout: 15000,
});

const LIVE_STATUSES = new Set([
  '1st_half', '2nd_half', 'halftime', 'extra_time',
  'extra_time_1st_half', 'extra_time_2nd_half', 'penalties', 'break_time',
  'live', 'inprogress', 'in_progress',
]);

// ESPN league slug map for standings fallback
const ESPN_LEAGUE_SLUGS = {
  'premier league': 'eng.1',
  'la liga': 'esp.1',
  'bundesliga': 'ger.1',
  'serie a': 'ita.1',
  'ligue 1': 'fra.1',
  'eredivisie': 'ned.1',
  'primeira liga': 'por.1',
  'super lig': 'tur.1',
  'champions league': 'uefa.champions',
  'europa league': 'uefa.europa',
  'championship': 'eng.2',
};

async function cachedGet(key, fn, ttl) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const data = await fn();
  cache.set(key, data, ttl);
  return data;
}

function errRes(res, msg, status = 500) {
  return res.status(status).json({ ok: false, error: msg });
}

function cleanEvent(e) {
  return {
    id: e.id,
    date: e.event_date ?? null,
    home: e.home_team_obj?.name ?? e.home_team,
    homeScore: e.home_score ?? null,
    away: e.away_team_obj?.name ?? e.away_team,
    awayScore: e.away_score ?? null,
    score: e.home_score !== null && e.away_score !== null
      ? `${e.home_score}-${e.away_score}` : null,
    status: e.status,
    minute: e.current_minute ?? null,
    competition: e.league?.name ?? null,
    venue: e.home_team_obj?.venue?.name ?? null,
    round: e.round_number ?? null,
  };
}

// ─── GET /live  (60s cache) ────────────────────────────────────────────────────

app.get('/live', async (req, res) => {
  try {
    const data = await cachedGet('live', async () => {
      const r = await bsd.get('/events/', { params: { live: true, limit: 100 } });
      return r.data;
    }, 60);

    const matches = (data?.results ?? [])
      .filter(e => LIVE_STATUSES.has((e.status ?? '').toLowerCase()))
      .map(cleanEvent);

    return res.json({ ok: true, count: matches.length, matches });
  } catch (e) {
    return errRes(res, e?.response?.data?.detail ?? e.message);
  }
});

// ─── GET /fixtures?team={teamName}  (12h cache) ───────────────────────────────

app.get('/fixtures', async (req, res) => {
  const { team } = req.query;
  if (!team) return errRes(res, 'Missing required query param: team', 400);

  try {
    const data = await cachedGet(`fixtures:${team.toLowerCase()}`, async () => {
      const r = await bsd.get('/events/', { params: { team, limit: 20 } });
      return r.data;
    }, 43200);

    const now = new Date();
    const upcoming = (data?.results ?? [])
      .filter(e => {
        const d = new Date(e.event_date);
        return !isNaN(d) && d >= now;
      })
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
      .slice(0, 3)
      .map(cleanEvent);

    if (!upcoming.length) {
      return errRes(res, `No upcoming fixtures found for: ${team}`, 404);
    }

    return res.json({ ok: true, team, upcoming });
  } catch (e) {
    return errRes(res, e?.response?.data?.detail ?? e.message);
  }
});

// ─── GET /results?team={teamName}  (12h cache) ────────────────────────────────

app.get('/results', async (req, res) => {
  const { team } = req.query;
  if (!team) return errRes(res, 'Missing required query param: team', 400);

  try {
    const q = team.toLowerCase();
    const now = new Date();
    const from = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const dateRange = `${fmt(from)}-${fmt(now)}`;

    const recent = await cachedGet(`results:${q}`, async () => {
      const fetches = Object.entries(ESPN_LEAGUE_SLUGS).map(([leagueName, slug]) =>
        espnSite.get(`/${slug}/scoreboard`, { params: { dates: dateRange } })
          .then(r => (r.data?.events ?? []).map(e => ({ ...e, _league: leagueName })))
          .catch(() => [])
      );
      const allEvents = (await Promise.all(fetches)).flat();

      return allEvents
        .filter(e => {
          const competitors = e.competitions?.[0]?.competitors ?? [];
          return competitors.some(c => c.team?.displayName?.toLowerCase().includes(q));
        })
        .map(e => {
          const comps = e.competitions?.[0] ?? {};
          const home = comps.competitors?.find(c => c.homeAway === 'home');
          const away = comps.competitors?.find(c => c.homeAway === 'away');
          return {
            id: e.id,
            date: e.date,
            home: home?.team?.displayName ?? null,
            homeScore: home?.score ?? null,
            away: away?.team?.displayName ?? null,
            awayScore: away?.score ?? null,
            score: home?.score != null && away?.score != null ? `${home.score}-${away.score}` : null,
            status: e.status?.type?.name ?? null,
            competition: e._league,
            venue: comps.venue?.fullName ?? null,
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 3);
    }, 43200);

    if (!recent.length) return errRes(res, `No results found for: ${team}`, 404);

    return res.json({ ok: true, team, recent });
  } catch (e) {
    return errRes(res, e?.response?.data?.detail ?? e.message);
  }
});

// ─── GET /player?name={playerName}  (24h cache) ───────────────────────────────

app.get('/player', async (req, res) => {
  const { name } = req.query;
  if (!name) return errRes(res, 'Missing required query param: name', 400);

  try {
    const nameTokens = name.trim().split(/\s+/);
    const q = name.toLowerCase();

    const data = await cachedGet(`player:${q}`, async () => {
      const r = await bsd.get('/players/', { params: { search: name.trim(), limit: 100 } });
      return r.data?.results ?? [];
    }, 86400);

    const players = Array.isArray(data) ? data : (data?.results ?? []);
    if (!players.length) return errRes(res, `Player not found: ${name}`, 404);

    const tokens = q.split(/\s+/);

    // Score each player by how many name tokens match
    const scored = players
      .map(p => {
        const pName = (p.name ?? '').toLowerCase();
        const exact = pName === q ? 100 : 0;
        const tokenMatches = tokens.filter(t => pName.includes(t)).length;
        return { p, score: exact + tokenMatches };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return errRes(res, `Player not found: ${name}`, 404);

    const top = scored.slice(0, 5).map(x => x.p);

    const clean = top.map(p => ({
      id: p.id,
      name: p.name,
      shortName: p.short_name,
      position: p.specific_position ?? p.position,
      nationality: p.nationality,
      team: p.current_team?.name ?? null,
      dateOfBirth: p.date_of_birth ?? null,
      marketValue: p.market_value ?? null,
    }));

    return res.json({ ok: true, count: clean.length, players: clean });
  } catch (e) {
    return errRes(res, e?.response?.data?.detail ?? e.message);
  }
});

// ─── GET /standings?league={leagueName}  (6h cache) ───────────────────────────

app.get('/standings', async (req, res) => {
  const { league } = req.query;
  if (!league) return errRes(res, 'Missing required query param: league', 400);

  const q = league.toLowerCase();

  // Try ESPN first (more reliable)
  const espnSlug = Object.entries(ESPN_LEAGUE_SLUGS).find(([k]) => q.includes(k) || k.includes(q))?.[1];

  if (espnSlug) {
    try {
      const table = await cachedGet(`standings:espn:${espnSlug}`, async () => {
        const r = await espn.get(`/${espnSlug}/standings`);
        const groups = r.data?.children ?? [];
        const rows = [];
        for (const group of groups) {
          for (const entry of group.standings?.entries ?? []) {
            const stats = Object.fromEntries((entry.stats ?? []).map(s => [s.name, s.value]));
            rows.push({
              position: rows.length + 1,
              team: entry.team?.displayName ?? entry.team?.name,
              played: stats.gamesPlayed ?? stats.played ?? null,
              won: stats.wins ?? null,
              drawn: stats.ties ?? stats.drawn ?? null,
              lost: stats.losses ?? null,
              points: stats.points ?? null,
              goalDiff: stats.pointDifferential ?? stats.goalDifference ?? null,
            });
          }
        }
        return rows;
      }, 21600);

      if (table.length) {
        return res.json({ ok: true, league, source: 'espn', standings: table });
      }
    } catch (_) {
      // fall through to BSD
    }
  }

  // BSD fallback
  try {
    const leaguesData = await cachedGet('all_leagues', async () => {
      const r = await bsd.get('/leagues/', { params: { limit: 100 } });
      return r.data;
    }, 86400);

    const leagues = leaguesData?.results ?? [];
    const leagueObj = leagues.find(l =>
      (l.name ?? '').toLowerCase().includes(q) || q.includes((l.name ?? '').toLowerCase())
    );

    if (!leagueObj) return errRes(res, `League not found: ${league}`, 404);

    const seasonId = leagueObj.current_season?.id;
    if (!seasonId) return errRes(res, `No active season for: ${league}`, 404);

    const standingsData = await cachedGet(`standings:bsd:${seasonId}`, async () => {
      const r = await bsd.get('/standings/', { params: { season: seasonId, limit: 30 } });
      return r.data;
    }, 21600);

    const rows = standingsData?.results ?? standingsData?.standings ?? (Array.isArray(standingsData) ? standingsData : []);

    if (!rows.length) return errRes(res, `No standings data found for: ${league}`, 404);

    const table = rows.map(r => ({
      position: r.rank ?? r.position,
      team: r.team?.name ?? r.team_name,
      played: r.played ?? r.matches_played,
      won: r.won ?? r.wins,
      drawn: r.drawn ?? r.draws,
      lost: r.lost ?? r.losses,
      points: r.points ?? r.pts,
      goalDiff: r.goal_difference ?? r.gd,
    }));

    return res.json({ ok: true, league: leagueObj.name, source: 'bsd', standings: table });
  } catch (e) {
    return errRes(res, e?.response?.data?.detail ?? e.message);
  }
});

// ─── GET /debug ────────────────────────────────────────────────────────────────

app.get('/debug', async (req, res) => {
  try {
    const r = await bsd.get('/events/', { params: { live: true, limit: 5 } });
    const statuses = (r.data?.results ?? []).map(e => e.status);
    return res.json({
      ok: true,
      tokenSet: !!process.env.BSD_TOKEN,
      bsdStatus: r.status,
      totalLive: r.data?.count,
      sampleStatuses: statuses,
    });
  } catch (e) {
    return res.json({ ok: false, tokenSet: !!process.env.BSD_TOKEN, error: e.message, status: e?.response?.status });
  }
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'footymate-api',
    endpoints: [
      'GET /live',
      'GET /standings?league={leagueName}',
      'GET /fixtures?team={teamName}',
      'GET /results?team={teamName}',
      'GET /player?name={playerName}',
    ],
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`footymate-api running on port ${PORT}`));
module.exports = app;
