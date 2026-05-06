require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const cors = require('cors');

const app = express();
const cache = new NodeCache({ stdTTL: 43200 }); // 12h default

app.use(cors());
app.use(express.json());

// ─── RapidAPI client ───────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || 'https://free-api-live-football-data.p.rapidapi.com';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
    'X-RapidAPI-Host': process.env.RAPIDAPI_HOST || 'free-api-live-football-data.p.rapidapi.com',
  },
  timeout: 15000,
});

async function cachedGet(key, path, params = {}, ttl = 43200) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const { data } = await api.get(path, { params });
  cache.set(key, data, ttl);
  return data;
}

function toArray(data, ...keys) {
  for (const k of keys) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  if (Array.isArray(data)) return data;
  return [];
}

function errRes(res, msg, status = 500) {
  return res.status(status).json({ ok: false, error: msg });
}

// ─── Lookup helpers ────────────────────────────────────────────────────────────

async function getAllLeagues() {
  const data = await cachedGet('all_leagues', '/football-get-all-leagues');
  // response.leagues[] shape confirmed
  return data?.response?.leagues ?? toArray(data, 'response', 'data', 'leagues', 'result');
}

async function getPopularLeagues() {
  const data = await cachedGet('popular_leagues', '/football-popular-leagues');
  // response.popular[] shape confirmed
  return data?.response?.popular ?? toArray(data, 'response', 'data', 'popular', 'leagues');
}

async function getLeagueMatches(leagueId) {
  const data = await cachedGet(`matches:${leagueId}`, '/football-get-all-matches-by-league', { leagueid: leagueId });
  // confirmed shape: response.matches[]
  return data?.response?.matches ?? toArray(data, 'response', 'data', 'events', 'result');
}

function getLeagueId(obj) {
  return obj?.id ?? obj?.leagueId ?? obj?.league_id ?? obj?.tournamentId;
}

function fuzzyMatch(haystack = '', needle = '') {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n) || n.includes(h);
}

// Find a league — tries popular leagues first, then full list
async function findLeague(name) {
  const tryFind = (list) => list.find(l =>
    fuzzyMatch(l.name ?? l.leagueName ?? l.localizedName ?? '', name)
  );
  const popular = await getPopularLeagues();
  const hit = tryFind(popular);
  if (hit) return hit;
  const all = await getAllLeagues();
  return tryFind(all) ?? null;
}

// Find all matches for a team by searching through popular leagues' match data
async function findTeamMatches(teamName) {
  const mapKey = `teammatches:${teamName.toLowerCase()}`;
  const cached = cache.get(mapKey);
  if (cached) return cached;

  const popular = await getPopularLeagues();

  for (const league of popular) {
    const leagueId = league?.id;
    if (!leagueId) continue;
    try {
      const matches = await getLeagueMatches(leagueId);
      const teamMatches = matches.filter(m =>
        fuzzyMatch(m.home?.name ?? '', teamName) || fuzzyMatch(m.away?.name ?? '', teamName)
      );
      if (teamMatches.length > 0) {
        const result = { matches: teamMatches, league, leagueId };
        cache.set(mapKey, result, 43200);
        return result;
      }
    } catch (_) {
      // Skip leagues that error
    }
  }
  return null;
}

// Parse match date from timestamp or string
function parseDate(m) {
  const raw = m.startTimestamp ?? m.startTime ?? m.date ?? m.match_date ?? m.eventDate ?? m.matchDate;
  if (!raw) return null;
  if (typeof raw === 'number') return new Date(raw * 1000);
  return new Date(raw);
}

function cleanMatch(m) {
  const home = m.homeTeam ?? m.home_team ?? {};
  const away = m.awayTeam ?? m.away_team ?? {};
  const score = m.homeScore ?? m.score ?? {};
  return {
    id: m.id ?? m.eventId ?? m.event_id,
    date: parseDate(m)?.toISOString() ?? null,
    home: home.name ?? home.teamName ?? m.homeTeamName ?? m.localteam_name,
    away: away.name ?? away.teamName ?? m.awayTeamName ?? m.visitorteam_name,
    score: score.current ?? score.fulltime ?? m.ftScore ?? `${m.localteam_score ?? '?'}-${m.visitorteam_score ?? '?'}`,
    status: m.status?.type ?? m.statusType ?? m.status ?? m.match_status,
    competition: m.tournament?.name ?? m.league?.name ?? m.leagueName ?? m.competition,
  };
}

// ─── GET /live ─────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

app.get('/live', async (req, res) => {
  try {
    const today = todayStr();
    const raw = await cachedGet(`live:${today}`, '/football-get-matches-by-date', { date: today }, 60);
    // confirmed shape: response.matches[]
    const all = raw?.response?.matches ?? toArray(raw, 'response', 'data', 'events', 'result');

    const live = all.filter(m => m.status?.started === true && m.status?.finished === false);

    const clean = live.map(m => ({
      id: m.id,
      home: m.home?.name,
      homeScore: m.home?.score ?? 0,
      away: m.away?.name,
      awayScore: m.away?.score ?? 0,
      score: `${m.home?.score ?? 0}-${m.away?.score ?? 0}`,
      minute: m.status?.liveTime?.short ?? m.status?.liveTime?.long ?? null,
      leagueId: m.leagueId,
    }));

    return res.json({ ok: true, count: clean.length, matches: clean });
  } catch (e) {
    return errRes(res, e?.response?.data?.message ?? e.message);
  }
});

// ─── GET /fixtures?team={teamName} ────────────────────────────────────────────

app.get('/fixtures', async (req, res) => {
  const { team } = req.query;
  if (!team) return errRes(res, 'Missing required query param: team', 400);

  try {
    const found = await findTeamMatches(team);
    if (!found) return errRes(res, `Team not found: ${team}`, 404);

    const now = Date.now();
    const upcoming = found.matches
      .filter(m => {
        const d = new Date(m.status?.utcTime ?? m.startTimestamp * 1000 ?? null);
        return d && d.getTime() > now && m.status?.started === false;
      })
      .sort((a, b) => new Date(a.status?.utcTime) - new Date(b.status?.utcTime))
      .slice(0, 3)
      .map(m => ({
        id: m.id,
        date: m.status?.utcTime ?? null,
        home: m.home?.name,
        away: m.away?.name,
        competition: found.league?.name,
      }));

    return res.json({
      ok: true,
      team,
      league: found.league?.name,
      upcoming,
    });
  } catch (e) {
    return errRes(res, e?.response?.data?.message ?? e.message);
  }
});

// ─── GET /results?team={teamName} ─────────────────────────────────────────────

app.get('/results', async (req, res) => {
  const { team } = req.query;
  if (!team) return errRes(res, 'Missing required query param: team', 400);

  try {
    const found = await findTeamMatches(team);
    if (!found) return errRes(res, `Team not found: ${team}`, 404);

    const now = Date.now();
    const recent = found.matches
      .filter(m => {
        const d = new Date(m.status?.utcTime ?? null);
        return d && d.getTime() < now && m.status?.finished === true;
      })
      .sort((a, b) => new Date(b.status?.utcTime) - new Date(a.status?.utcTime))
      .slice(0, 3)
      .map(m => ({
        id: m.id,
        date: m.status?.utcTime ?? null,
        home: m.home?.name,
        homeScore: m.home?.score,
        away: m.away?.name,
        awayScore: m.away?.score,
        score: `${m.home?.score ?? '?'}-${m.away?.score ?? '?'}`,
        competition: found.league?.name,
      }));

    return res.json({
      ok: true,
      team,
      league: found.league?.name,
      recent,
    });
  } catch (e) {
    return errRes(res, e?.response?.data?.message ?? e.message);
  }
});

// ─── GET /player?name={playerName} ────────────────────────────────────────────

app.get('/player', async (req, res) => {
  const { name } = req.query;
  if (!name) return errRes(res, 'Missing required query param: name (e.g. /player?name=Messi)', 400);

  try {
    const raw = await cachedGet(`player_search:${name.toLowerCase()}`, '/football-players-search', { search: name });
    // confirmed shape: response.suggestions[]
    const all = raw?.response?.suggestions ?? toArray(raw, 'response', 'data', 'players', 'result');
    const players = all.filter(p => p.type === 'player' || !p.type);

    if (!players.length) return errRes(res, `Player not found: ${name}`, 404);

    const clean = players.slice(0, 5).map(p => ({
      id: p.id ?? p.playerId,
      name: p.name ?? p.playerName,
      team: p.teamName ?? p.team?.name,
      teamId: p.teamId,
    }));

    return res.json({ ok: true, count: clean.length, players: clean });
  } catch (e) {
    return errRes(res, e?.response?.data?.message ?? e.message);
  }
});

// ─── GET /standings?league={leagueName} ───────────────────────────────────────

app.get('/standings', async (req, res) => {
  const { league } = req.query;
  if (!league) return errRes(res, 'Missing required query param: league', 400);

  try {
    const leagueObj = await findLeague(league);
    if (!leagueObj) return errRes(res, `League not found: ${league}`, 404);

    const lid = getLeagueId(leagueObj);
    const raw = await cachedGet(`standings:${lid}`, '/football-get-standing-all', { leagueid: lid });
    // confirmed shape: response.standing[]
    const rows = raw?.response?.standing ?? toArray(raw, 'response', 'data', 'standings', 'table', 'result');

    const table = rows.map(r => ({
      position: r.idx ?? r.position ?? r.rank,
      team: r.name ?? r.shortName ?? r.teamName,
      played: r.played ?? r.matches,
      won: r.wins ?? r.won,
      drawn: r.draws ?? r.drawn,
      lost: r.losses ?? r.lost,
      points: r.pts ?? r.points,
      goalDiff: r.goalConDiff ?? r.goalsDiff,
      score: r.scoresStr,
    }));

    return res.json({
      ok: true,
      league: leagueObj.leagueName ?? leagueObj.name ?? leagueObj.tournamentName ?? league,
      standings: table,
    });
  } catch (e) {
    return errRes(res, e?.response?.data?.message ?? e.message);
  }
});

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'footymate-api',
    endpoints: [
      'GET /live',
      'GET /fixtures?team={teamName}',
      'GET /results?team={teamName}',
      'GET /player?name={playerName}',
      'GET /standings?league={leagueName}',
    ],
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`footymate-api running on port ${PORT}`));
module.exports = app;
