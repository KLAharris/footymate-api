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

const teamMap = {
  // Premier League
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
  "ipswich": "133618",
  "ipswich town": "133618",
  "leeds": "133624",
  "leeds united": "133624",
  "leicester": "133614",
  "leicester city": "133614",
  "liverpool": "133602",
  "luton": "134303",
  "luton town": "134303",
  "manchester city": "133613",
  "man city": "133613",
  "manchester united": "133612",
  "man united": "133612",
  "man utd": "133612",
  "newcastle": "133608",
  "newcastle united": "133608",
  "nottingham forest": "133609",
  "forest": "133609",
  "sheffield united": "133620",
  "southampton": "133607",
  "sunderland": "133621",
  "tottenham": "133616",
  "tottenham hotspur": "133616",
  "spurs": "133616",
  "west ham": "133611",
  "west ham united": "133611",
  "wolverhampton": "133622",
  "wolves": "133622",

  // La Liga
  "barcelona": "133739",
  "barca": "133739",
  "real madrid": "133738",
  "atletico madrid": "133744",
  "atletico": "133744",
  "sevilla": "133746",
  "real betis": "133748",
  "betis": "133748",
  "real sociedad": "133749",
  "villarreal": "133752",
  "athletic bilbao": "133743",
  "bilbao": "133743",
  "valencia": "133750",
  "osasuna": "133756",
  "celta vigo": "133755",
  "celta": "133755",
  "getafe": "133758",
  "rayo vallecano": "133760",
  "rayo": "133760",
  "mallorca": "133753",
  "girona": "134316",
  "cadiz": "134308",
  "granada": "133759",
  "almeria": "134314",
  "las palmas": "133762",

  // Serie A
  "juventus": "133632",
  "juve": "133632",
  "inter milan": "133728",
  "inter": "133728",
  "ac milan": "133722",
  "milan": "133722",
  "napoli": "133723",
  "roma": "133731",
  "as roma": "133731",
  "lazio": "133733",
  "atalanta": "133726",
  "fiorentina": "133725",
  "torino": "133729",
  "bologna": "133724",
  "udinese": "133736",
  "sampdoria": "133730",
  "sassuolo": "133732",
  "empoli": "133738",
  "lecce": "133740",
  "monza": "134409",
  "hellas verona": "133734",
  "verona": "133734",
  "frosinone": "133737",
  "salernitana": "134311",
  "genoa": "133727",
  "cagliari": "133735",

  // Bundesliga
  "bayern munich": "133655",
  "bayern": "133655",
  "borussia dortmund": "133656",
  "dortmund": "133656",
  "bvb": "133656",
  "rb leipzig": "134310",
  "leipzig": "134310",
  "bayer leverkusen": "133657",
  "leverkusen": "133657",
  "eintracht frankfurt": "133659",
  "frankfurt": "133659",
  "wolfsburg": "133664",
  "borussia monchengladbach": "133660",
  "gladbach": "133660",
  "union berlin": "134302",
  "union": "134302",
  "freiburg": "133661",
  "sc freiburg": "133661",
  "mainz": "133665",
  "hoffenheim": "133663",
  "augsburg": "133666",
  "werder bremen": "133662",
  "bremen": "133662",
  "stuttgart": "133658",
  "vfb stuttgart": "133658",
  "cologne": "133667",
  "fc koln": "133667",
  "heidenheim": "134420",
  "darmstadt": "134409",

  // Ligue 1
  "psg": "133718",
  "paris saint-germain": "133718",
  "paris sg": "133718",
  "paris": "133718",
  "marseille": "133719",
  "lyon": "133720",
  "monaco": "133721",
  "lille": "133716",
  "nice": "133715",
  "lens": "133713",
  "rennes": "133714",
  "strasbourg": "133717",
  "nantes": "133711",
  "reims": "133712",
  "toulouse": "133710",
  "montpellier": "133709",
  "brest": "134304",
  "lorient": "133708",
  "clermont": "134312",
  "metz": "133707",
  "le havre": "134421",

  // Turkish Super Lig
  "galatasaray": "133536",
  "fenerbahce": "133538",
  "besiktas": "133537",
  "trabzonspor": "133539",

  // Portuguese Liga
  "sporting cp": "133764",
  "sporting": "133764",
  "porto": "133763",
  "fc porto": "133763",
  "benfica": "133762",
  "sl benfica": "133762",
  "braga": "133765",

  // Dutch Eredivisie
  "ajax": "133686",
  "psv": "133687",
  "psv eindhoven": "133687",
  "feyenoord": "133688",
  "az alkmaar": "133689",
  "az": "133689",
  "twente": "133690",

  // Belgian Pro League
  "club brugge": "133680",
  "brugge": "133680",
  "anderlecht": "133681",
  "gent": "133682",

  // Austrian Bundesliga
  "red bull salzburg": "133645",
  "salzburg": "133645",
  "rapid vienna": "133646",
  "sturm graz": "133647",

  // Scottish Premiership
  "celtic": "133700",
  "rangers": "133699",

  // Ukrainian Premier League
  "shakhtar donetsk": "133531",
  "shakhtar": "133531",
  "dynamo kyiv": "133532",

  // Greek Super League
  "olympiakos": "133551",
  "panathinaikos": "133552",

  // Czech Liga
  "slavia prague": "133561",
  "sparta prague": "133562",

  // Danish Superliga
  "fc copenhagen": "133571",
  "copenhagen": "133571",

  // Swiss Super League
  "young boys": "133641",
  "bsc young boys": "133641",
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
