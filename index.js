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

const sportsdb = axios.create({
  baseURL: 'https://www.thesportsdb.com/api/v1/json/3',
  timeout: 15000,
});

const SPORTSDB_LEAGUE_MAP = {
  "premier league": "4328",
  "epl": "4328",
  "la liga": "4335",
  "serie a": "4332",
  "bundesliga": "4331",
  "ligue 1": "4334",
  "champions league": "4480",
  "uefa champions league": "4480",
  "europa league": "4481",
  "fa cup": "4482",
};

function currentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  return (now.getMonth() + 1) >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

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

// Team IDs verified from TheSportsDB eventsseason.php for 2025-2026 season
const teamMap = {
  // Premier League (verified 2025-2026)
  "arsenal": "133604",
  "aston villa": "133601",
  "bournemouth": "134301",
  "brentford": "134355",
  "brighton": "133619",
  "brighton and hove albion": "133619",
  "burnley": "133623",
  "chelsea": "133610",
  "crystal palace": "133632",
  "everton": "133615",
  "fulham": "133600",
  "leeds": "133635",
  "leeds united": "133635",
  "liverpool": "133602",
  "manchester city": "133613",
  "man city": "133613",
  "manchester united": "133612",
  "man united": "133612",
  "man utd": "133612",
  "newcastle": "134777",
  "newcastle united": "134777",
  "nottingham forest": "133720",
  "forest": "133720",
  "sunderland": "133603",
  "tottenham": "133616",
  "tottenham hotspur": "133616",
  "spurs": "133616",
  "west ham": "133636",
  "west ham united": "133636",
  "wolverhampton": "133599",
  "wolves": "133599",

  // La Liga (verified 2025-2026)
  "athletic bilbao": "133727",
  "bilbao": "133727",
  "atletico madrid": "133729",
  "atletico": "133729",
  "barcelona": "133739",
  "barca": "133739",
  "celta vigo": "133937",
  "celta": "133937",
  "deportivo alaves": "134221",
  "alaves": "134221",
  "elche": "134384",
  "espanyol": "133734",
  "getafe": "133731",
  "girona": "134700",
  "levante": "133732",
  "mallorca": "133733",
  "osasuna": "133730",
  "rayo vallecano": "133728",
  "rayo": "133728",
  "real betis": "133722",
  "betis": "133722",
  "real madrid": "133738",
  "real oviedo": "135455",
  "oviedo": "135455",
  "real sociedad": "133724",
  "sevilla": "133735",
  "valencia": "133725",
  "villarreal": "133740",

  // Serie A (verified 2025-2026)
  "ac milan": "133667",
  "milan": "133667",
  "atalanta": "134782",
  "bologna": "134781",
  "cagliari": "134783",
  "como": "134243",
  "cremonese": "134224",
  "fiorentina": "133674",
  "genoa": "133675",
  "hellas verona": "134784",
  "verona": "134784",
  "inter milan": "133681",
  "inter": "133681",
  "juventus": "133676",
  "juve": "133676",
  "lazio": "133668",
  "lecce": "133678",
  "napoli": "133670",
  "parma": "135728",
  "pisa": "133859",
  "roma": "133682",
  "as roma": "133682",
  "sassuolo": "133701",
  "torino": "133687",
  "udinese": "133679",

  // Bundesliga (verified 2025-2026)
  "bayer leverkusen": "133666",
  "leverkusen": "133666",
  "bayern munich": "133664",
  "bayern": "133664",
  "borussia dortmund": "133650",
  "dortmund": "133650",
  "bvb": "133650",
  "borussia monchengladbach": "134779",
  "gladbach": "134779",
  "eintracht frankfurt": "133814",
  "frankfurt": "133814",
  "augsburg": "133652",
  "fc augsburg": "133652",
  "heidenheim": "134696",
  "fc heidenheim": "134696",
  "cologne": "133654",
  "fc koln": "133654",
  "freiburg": "133653",
  "sc freiburg": "133653",
  "hamburg": "133651",
  "hsv": "133651",
  "hoffenheim": "133657",
  "mainz": "133665",
  "rb leipzig": "134695",
  "leipzig": "134695",
  "st pauli": "133813",
  "stuttgart": "133660",
  "vfb stuttgart": "133660",
  "union berlin": "134690",
  "union": "134690",
  "werder bremen": "133662",
  "bremen": "133662",
  "wolfsburg": "133655",

  // Ligue 1 (verified 2025-2026)
  "angers": "134709",
  "auxerre": "134788",
  "brest": "133704",
  "le havre": "133862",
  "lens": "133822",
  "lille": "133711",
  "lorient": "133715",
  "lyon": "133713",
  "marseille": "133707",
  "metz": "133883",
  "monaco": "133823",
  "nantes": "133861",
  "nice": "133712",
  "paris fc": "135465",
  "psg": "133714",
  "paris saint-germain": "133714",
  "paris sg": "133714",
  "paris": "133714",
  "rennes": "133719",
  "strasbourg": "133882",
  "toulouse": "133703",
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

  if (!teamMap[team.toLowerCase()]) {
    return res.status(404).json({ ok: false, error: `Team not found: ${team}`, available: Object.keys(teamMap) });
  }

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

  if (!teamMap[team.toLowerCase()]) {
    return res.status(404).json({ ok: false, error: `Team not found: ${team}`, available: Object.keys(teamMap) });
  }

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
    const data = await cachedGet(`player:${name.toLowerCase()}`, async () => {
      const r = await sportsdb.get('/searchplayers.php', { params: { p: name.trim() } });
      return r.data?.player ?? [];
    }, 86400);

    if (!data.length) return errRes(res, `Player not found: ${name}`, 404);

    const clean = data.slice(0, 5).map(p => ({
      name: p.strPlayer,
      team: p.strTeam ?? null,
      nationality: p.strNationality ?? null,
      position: p.strPosition ?? null,
      thumbnail: p.strThumb ?? null,
    }));

    return res.json({ ok: true, count: clean.length, players: clean });
  } catch (e) {
    return errRes(res, e.message);
  }
});

// ─── GET /standings?league={leagueName}  (6h cache) ───────────────────────────

app.get('/standings', async (req, res) => {
  const { league } = req.query;
  if (!league) return errRes(res, 'Missing required query param: league', 400);

  const q = league.toLowerCase().trim();

  // Map league name to TheSportsDB league ID
  const leagueEntry = Object.entries(SPORTSDB_LEAGUE_MAP).find(([k]) =>
    q === k || q.includes(k) || k.includes(q)
  );
  const leagueId = leagueEntry?.[1];

  // Try TheSportsDB lookuptable first
  if (leagueId) {
    try {
      const season = currentSeason();
      const table = await cachedGet(`standings:sportsdb:${leagueId}:${season}`, async () => {
        const r = await sportsdb.get('/lookuptable.php', { params: { l: leagueId, s: season } });
        return (r.data?.table ?? []).map(row => ({
          position: parseInt(row.intRank, 10),
          team: row.strTeam,
          badge: row.strBadge ?? null,
          played: parseInt(row.intPlayed, 10),
          won: parseInt(row.intWin, 10),
          drawn: parseInt(row.intDraw, 10),
          lost: parseInt(row.intLoss, 10),
          points: parseInt(row.intPoints, 10),
          goalDiff: parseInt(row.intGoalDifference, 10),
          form: row.strForm ?? null,
        }));
      }, 21600);

      if (table.length) {
        return res.json({ ok: true, league, season, source: 'thesportsdb', standings: table });
      }
    } catch (_) {
      // fall through to ESPN
    }
  }

  // ESPN fallback
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
    } catch (_) {}
  }

  return errRes(res, `League not found or no standings available: ${league}`, 404);
});

// ─── GET /team?name={teamName}  (team:24h, fixtures/results:12h) ──────────────

app.get('/team', async (req, res) => {
  const { name } = req.query;
  if (!name) return errRes(res, 'Missing required query param: name', 400);

  const key = name.toLowerCase();
  const teamId = teamMap[key];
  if (!teamId) {
    return res.status(404).json({ ok: false, error: `Team not found: ${name}`, available: Object.keys(teamMap) });
  }
  const teamName = name;
  const teamBadge = null;

  // Fetch upcoming and recent in parallel, each isolated
  const [upcoming, recent] = await Promise.all([
    (async () => {
      try {
        return await cachedGet(`sportsdb:fixtures:${teamId}`, async () => {
          const r = await sportsdb.get('/eventsnext.php', { params: { id: teamId } });
          return (r.data?.events ?? []).slice(0, 3).map(e => ({
            date:   e.dateEvent ?? null,
            time:   e.strTime ? e.strTime.slice(0, 5) : null,
            home:   e.strHomeTeam ?? null,
            away:   e.strAwayTeam ?? null,
            venue:  e.strVenue ?? null,
            league: e.strLeague ?? null,
          }));
        }, 43200);
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        return await cachedGet(`sportsdb:results:${teamId}`, async () => {
          const r = await sportsdb.get('/eventslast.php', { params: { id: teamId } });
          return (r.data?.results ?? []).slice(0, 3).map(e => ({
            date:   e.dateEvent ?? null,
            home:   e.strHomeTeam ?? null,
            away:   e.strAwayTeam ?? null,
            score:  e.intHomeScore != null && e.intAwayScore != null
                      ? `${e.intHomeScore}-${e.intAwayScore}` : null,
            league: e.strLeague ?? null,
          }));
        }, 43200);
      } catch {
        return [];
      }
    })(),
  ]);

  return res.json({ ok: true, team: teamName, teamBadge, upcoming, recent });
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
      'GET /team?name={teamName}',
    ],
    supportedLeagues: [
      'Premier League',
      'EPL',
      'La Liga',
      'Serie A',
      'Bundesliga',
      'Ligue 1',
      'Champions League',
      'UEFA Champions League',
      'Europa League',
      'FA Cup',
    ],
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`footymate-api running on port ${PORT}`));
module.exports = app;
