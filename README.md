# footymate-api

Node.js/Express middleware API that wraps the RapidAPI Live Football Data service into clean, chatbot-friendly JSON — works in both Thai and English.

---

## Setup

```bash
cd footymate-api
npm install
cp .env.example .env   # then fill in your key
npm run dev            # or: npm start
```

The server runs on **http://localhost:3000** by default.

---

## Environment Variables

| Variable | Description |
|---|---|
| `RAPIDAPI_KEY` | Your RapidAPI key |
| `RAPIDAPI_HOST` | `free-api-live-football-data.p.rapidapi.com` |
| `BASE_URL` | `https://free-api-live-football-data.p.rapidapi.com` |
| `PORT` | Port to listen on (default: 3000) |

---

## Endpoints

### `GET /fixtures?team={teamName}`
Next 3 upcoming matches for a team.

```
GET /fixtures?team=Manchester United
```
```json
{
  "ok": true,
  "team": "Manchester United",
  "upcoming": [
    {
      "date": "2024-05-10T19:00:00Z",
      "home": "Manchester United",
      "away": "Arsenal",
      "competition": "Premier League",
      "venue": "Old Trafford",
      "status": "NS"
    }
  ]
}
```

---

### `GET /results?team={teamName}`
Last 3 results for a team.

```
GET /results?team=Barcelona
```
```json
{
  "ok": true,
  "team": "Barcelona",
  "recent": [
    {
      "date": "2024-05-05T19:00:00Z",
      "home": "Barcelona",
      "away": "Real Madrid",
      "score": { "halftime": "1-0", "fulltime": "3-2" },
      "competition": "La Liga",
      "winner": true
    }
  ]
}
```

---

### `GET /player?name={playerName}`
Current-season stats for a player.

```
GET /player?name=Erling Haaland
```
```json
{
  "ok": true,
  "player": {
    "name": "Erling Haaland",
    "nationality": "Norwegian",
    "position": "Attacker",
    "age": 23,
    "club": "Manchester City",
    "season": 2023,
    "appearances": 31,
    "goals": 27,
    "assists": 5,
    "rating": "7.8",
    "yellowCards": 1,
    "redCards": 0
  }
}
```

---

### `GET /standings?league={leagueName}`
Full standings table for any league.

```
GET /standings?league=Premier League
```
```json
{
  "ok": true,
  "league": "Premier League",
  "season": 2023,
  "standings": [
    {
      "position": 1,
      "team": "Manchester City",
      "played": 36,
      "won": 25,
      "drawn": 7,
      "lost": 4,
      "points": 82,
      "goalDiff": 52
    }
  ]
}
```

---

### `GET /live`
All live matches right now across all leagues. **Cached for 60 seconds only** (not 12 hours).

```
GET /live
```
```json
{
  "ok": true,
  "count": 4,
  "matches": [
    {
      "home": "PSG",
      "away": "Lyon",
      "score": "2-1",
      "minute": 67,
      "competition": "Ligue 1",
      "status": "2H"
    }
  ]
}
```

---

## Caching

All responses are cached for **12 hours** using in-memory cache (`node-cache`). Live matches are cached for **60 seconds**. This drastically reduces RapidAPI calls.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel login

# Add your env vars in the Vercel dashboard or via CLI:
vercel env add RAPIDAPI_KEY
vercel env add RAPIDAPI_HOST
vercel env add BASE_URL

vercel --prod
```

Vercel is configured via `vercel.json` — all routes are handled by `index.js`.

> **Note:** Vercel serverless functions are stateless, so the in-memory cache resets between cold starts. For persistent caching across instances, swap `node-cache` for Upstash Redis (free tier available).

---

## Error Responses

All errors return:
```json
{
  "ok": false,
  "error": "Team not found: Liverpool FC"
}
```

---

## Chatbot Usage Tips

- Names are flexible: `"Man United"`, `"Manchester United"`, `"Man Utd"` all work (resolved via search).
- Responses are intentionally flat and label-rich so an AI can summarize them in any language.
- All dates are ISO 8601 UTC — convert to local time as needed.
