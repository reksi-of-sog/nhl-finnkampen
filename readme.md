# 🇫🇮 vs 🇸🇪 NHL Bot

A hobby project that tracks Finnish and Swedish players in the NHL.  
The bot posts **nightly summaries** (goals, assists, points, goalie stats) to X/Twitter and keeps season totals.  
Later phases will add **interactive Q&A**, stat cards, and fun extras.

---

## 🌟 Vision
Celebrate the classic Finland–Sweden hockey rivalry by making it easy for fans to follow their favorite players’ nightly performances in the NHL.

---

## 🎯 Goals
- **MVP**: Automatically post nightly summaries (FIN vs SWE) + season totals.
- **Phase 2**: Fans can ask about any NHL player and get a concise report.
- **Phase 3**: Visual stat cards, milestones, trivia, admin dashboard.

---

## 📌 User Stories
### MVP
- As a fan, I want a nightly FIN vs SWE summary so I can follow the rivalry.
- As a fan, I want to see season totals for context.
- As the operator, I want to test outputs before posting.

### Phase 2
- As a fan, I can ask “How is Player X doing this season?” and get a reply.
- As a fan, I see top Finnish/Swedish performers each night.
- As the operator, I get error alerts when posting fails.

### Phase 3
- As a fan, I enjoy stat graphics and trivia posts.
- As the operator, I can manage posts and backfills in a simple admin UI.

---

## 🛠️ Architecture (MVP)
1. **Ingest Worker** → Pulls game boxscores from NHL Stats API → stores in Postgres.
2. **Aggregator** → Computes nightly + season aggregates.
3. **Formatter** → Generates summary text.
4. **Poster** → Posts to X/Twitter via API.
5. **Scheduler** → Runs after games finish.

Later:
- **Q&A Bot** → Listens to mentions → resolves player → generates report with LLM.
- **Admin UI** → Manual re-post, logs, overrides.

---

## 📊 Data Model (simplified)
- `players`: id, name, birthCountry, position
- `games`: id, date, teams
- `player_game_stats`: goals, assists, points, goalie stats
- `nightly_nation_agg`: stats per nation per date
- `season_nation_agg`: cumulative stats
- `posts`: posted messages
- `mentions`: fan queries + replies

---

## 📝 Example Nightly Tweet
🇫🇮 vs 🇸🇪 in the NHL tonight:
FIN — 3 G / 4 A
SWE — 2 G / 6 A

Season totals:
FIN: 88 G / 123 A
SWE: 95 G / 119 A

Top 🇫🇮: Laine 2G
Top 🇸🇪: Nylander 1G 2A
#NHL #Leijonat #TreKronor


---

## ⚙️ Tech Stack
- **Backend:** Node.js (TypeScript)
- **DB:** Postgres (Supabase/Neon)
- **Scheduler:** Cron (Supabase functions, GitHub Actions, or server cron)
- **LLM (Phase 2):** OpenAI GPT for player reports
- **Monitoring:** Basic logging → optional Sentry/Discord alerts

---

## 🚀 Roadmap
### Milestone A (MVP)
- [ ] Repo & schema
- [ ] Ingest script → pulls daily stats
- [ ] Aggregator → nightly + season totals
- [ ] Formatter → generates tweet text
- [ ] Poster → publishes nightly summary
- [ ] Scheduler → automated nightly job

### Milestone B (Phase 2)
- [ ] Q&A bot with LLM reports
- [ ] Error logging & notifications
- [ ] Include top players of the night

### Milestone C (Phase 3)
- [ ] Visual stat cards (images)
- [ ] Milestone & trivia posts
- [ ] Admin dashboard for manual control

---

## ⚠️ Notes
- Uses **unofficial NHL Stats API** (endpoints may change).
- Limited by **X/Twitter API quotas** (free tier = 1 post/day; interactive Q&A will require Basic tier).
- Nationality detection is based on player birthCountry and may need overrides for dual nationals.

---

## 📄 License
MIT (hobby project, no warranty).

---
