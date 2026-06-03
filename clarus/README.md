# ◆ Clarus

**Clarity for your organization.** Connect GitHub, Jira, Slack and GitLab, ingest
your activity, and Clarus builds an **org knowledge graph** with **AI-generated
contributor profiles** — so anyone can instantly find who knows what and ask
natural-language questions about the codebase.

Powered by Google **Gemini** (via the OpenAI-compatible API).

---

## ✨ What it does

- **Connect your tools** with OAuth (GitHub, GitLab, Jira, Slack).
- **Ingest** repositories, contributors, commits, issues and pull/merge requests.
- **AI profiles** — Gemini summarizes each contributor's expertise and each repo.
- **Org Lens** — a live network graph of who builds what.
- **Ask Clarus** — chat grounded in your org's data, with citations to the right
  experts.
- **Multi-tenant** — users, organizations and memberships; all data is scoped per org.

## 🏗 Architecture

```
clarus/
├── backend/                 # Django + DRF (JWT auth, multi-tenant)
│   ├── accounts/            # User, Organization, Membership  (tenancy + auth)
│   ├── integrations/        # Connection model + OAuth flow
│   │   └── providers/       # Adapter per provider (base, github, gitlab, jira, slack)
│   ├── orgdata/             # Provider-agnostic Repository/Contributor/Work/Commit/Issue
│   ├── ingestion/           # IngestionRun, DBSink normalizer, orchestration, CLI
│   └── insights/            # Gemini profile generation + org-scoped chat
└── frontend/                # React 19 + Vite + Tailwind v4
    └── src/
        ├── api/             # axios client (JWT + X-Org-Slug), token refresh
        ├── context/         # AuthContext
        ├── components/      # Layout, Chat (streaming), OrgGraph
        └── pages/           # Login, Register, Dashboard, Integrations,
                             #   Contributors, ContributorDetail, Repositories
```

**Design principles**

- *Provider adapters* implement one interface (`Provider`): OAuth (`authorize_url`,
  `exchange_code`) + `ingest(connection, sink)`. Adding a source = adding one class.
- *Normalization*: every adapter streams data into a `DBSink` that writes the same
  org-scoped `orgdata` models, so the lens/profiles/chat are source-agnostic.
- *Tenancy*: the active org is selected per request via the `X-Org-Slug` header;
  every query is filtered by organization.

## 🚀 Quickstart (local)

### 1. Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then edit (see below)
python manage.py migrate
python manage.py runserver    # http://localhost:8000
```

Minimum `.env` to get the AI working:

```
GEMINI_API_KEY=your_gemini_key      # https://aistudio.google.com/apikey
SECRET_KEY=some-long-random-string
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env          # VITE_API_URL=http://localhost:8000
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173, create an account (this also creates your first
organization), then go to **Integrations**.

## 🔌 Connecting a source

### Option A — OAuth (the product flow)

Register an OAuth app with the provider and put the credentials in `backend/.env`:

| Provider | Register at | Callback / Redirect URL |
|----------|-------------|--------------------------|
| GitHub | https://github.com/settings/developers | `http://localhost:8000/api/integrations/github/callback/` |
| GitLab | https://gitlab.com/-/profile/applications | `http://localhost:8000/api/integrations/gitlab/callback/` |
| Jira (Atlassian 3LO) | https://developer.atlassian.com/console/myapps/ | `http://localhost:8000/api/integrations/jira/callback/` |
| Slack | https://api.slack.com/apps | `http://localhost:8000/api/integrations/slack/callback/` |

Then set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, etc. The provider card on the
Integrations page becomes **Connect** → ingest.

### Option B — Personal Access Token (fastest for testing GitHub)

No OAuth app needed:

```bash
cd backend && source venv/bin/activate
python manage.py connect_token --org <your-org-slug> --provider github \
    --token ghp_xxx --login <your-gh-login> --targets owner/repo anotherorg
python manage.py ingest --org <your-org-slug> --provider github
```

`--targets` accepts `owner` (a user/org — all their repos) or `owner/repo`. Omit
it to ingest repos the token can access. Profiles are generated automatically
(needs `GEMINI_API_KEY`).

## 🔎 Key API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register/` · `/api/auth/login/` | Auth (JWT) |
| GET | `/api/auth/me/` | User + organizations |
| GET | `/api/integrations/providers/` | Providers + connection status |
| POST | `/api/integrations/<provider>/connect/` | Start OAuth (returns authorize URL) |
| GET | `/api/integrations/<provider>/callback/` | OAuth redirect target |
| POST | `/api/ingestion/<provider>/run/` | Trigger ingestion |
| GET | `/api/ingestion/runs/` | Run history + live status |
| GET | `/api/data/` | Full org lens payload |
| POST | `/api/insights/chat/` | Streaming org chat |

All authenticated requests send `Authorization: Bearer <jwt>` and `X-Org-Slug: <org>`.

## 🧱 Status & roadmap

| Capability | Status |
|------------|--------|
| Multi-tenant auth (users / orgs / memberships, JWT) | ✅ Done |
| OAuth connect flow (all 4 providers) | ✅ Done (needs provider app creds) |
| **GitHub** ingestion (repos, contributors, commits, issues/PRs) | ✅ Done |
| AI contributor profiles + repo summaries (Gemini) | ✅ Done |
| Org graph + streaming chat with expert citations | ✅ Done |
| GitLab / Jira / Slack **ingestion** | 🟡 Adapter scaffolded (OAuth done, `ingest()` TODO) |
| Background job queue (Celery/Redis) | 🟡 Currently a daemon thread; interface ready |
| Token encryption at rest, webhooks for incremental sync | ⬜ Planned |

Each scaffolded adapter (`backend/integrations/providers/{gitlab,jira,slack}.py`)
has its OAuth implemented and a documented `ingest()` stub to mirror `github.py`.

## 🔐 Production notes

- Encrypt `Connection.access_token` / `refresh_token` at rest (e.g. KMS / Fernet).
- Move ingestion to Celery/RQ; `run_ingestion(run)` is already a pure function.
- Set `DEBUG=False`, a real `DATABASE_URL` (Postgres), and proper `ALLOWED_HOSTS`.

## License

MIT
