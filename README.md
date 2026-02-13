# State Legislative Tracker

Tracks state tax and benefit legislation relevant to [PolicyEngine](https://policyengine.org), scores bills for modelability, and computes fiscal impacts using microsimulation.

**Live app:** [state-legislative-tracker.modal.run](https://policengine--state-legislative-tracker.modal.run)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Data Pipeline                               │
│                                                                     │
│  legiscan_monitor.py  →  /triage-bills  →  /encode-bill            │
│  (find new bills)        (score bills)     (compute impacts)        │
│                                                                     │
│  Runs in CI/cron         Human-in-loop     Human-triggered          │
│  Saves to Supabase       Writes scores     Runs microsimulation     │
│  Creates GitHub issue    Creates GH issue  Creates review PR        │
└─────────────────────────────────────────────────────────────────────┘
         │                       │                     │
         ▼                       ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Supabase                                   │
│  processed_bills  │  research  │  reform_impacts                    │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     React Frontend (Modal)                           │
│  Dashboard showing scored bills, impact analyses, district maps     │
└─────────────────────────────────────────────────────────────────────┘
```

## Workflow

### 1. Find bills — `legiscan_monitor.py`

Searches LegiScan for tax/benefit bills across all 50 states. Filters by relevance keywords, saves to Supabase (unscored), and creates a GitHub digest issue.

```bash
# Monitor specific states (uses dataset mode — 1 API call per state)
python scripts/legiscan_monitor.py --states GA,NY,UT

# Dry run
python scripts/legiscan_monitor.py --states GA --dry-run

# Single query (search mode)
python scripts/legiscan_monitor.py --query "income tax rate" --states GA
```

### 2. Score bills — `/triage-bills`

Claude Code scores unscored bills for PolicyEngine modelability (0-100). Presents proposed scores for human review before writing to Supabase and creating a GitHub issue.

```
/triage-bills           # Score all unscored bills
/triage-bills GA        # Score only Georgia bills
/triage-bills --limit 5 # Score up to 5 bills
```

**Scoring rubric:**
| Score | Type | Meaning |
|-------|------|---------|
| 80-100 | Parametric | Maps to existing PE parameter (e.g., flat tax rate change) |
| 50-79 | Structural | Modelable but may need new parameters or minor code |
| 20-49 | Structural | Needs significant new code in policyengine-us |
| 0-19 | Not modelable | Administrative/procedural — permanently skipped |

### 3. Encode bills — `/encode-bill`

Full encoding pipeline: researches bill text, maps to PolicyEngine parameters, computes microsimulation impacts (budgetary, poverty, winners/losers, district-level), and creates a review PR.

```
/encode-bill GA SB168
/encode-bill UT SB60
```

Bills start as `in_review` (hidden from dashboard). Merging the PR triggers a GitHub Action that sets status to `published`.

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- [PolicyEngine-US](https://github.com/PolicyEngine/policyengine-us) installed locally

### Environment

Create `.env` with:

```
SUPABASE_URL=<your-supabase-url>
SUPABASE_KEY=<your-service-key>
SUPABASE_ANON_KEY=<your-anon-key>
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_POSTHOG_KEY=<your-posthog-key>
LEGISCAN_API_KEY=<your-legiscan-key>
```

### Development

```bash
make install   # Install npm + pip dependencies
make dev       # Start local dev server
make build     # Build for production
```

### Database Migrations

Run SQL migrations in order via Supabase Dashboard:

```
scripts/sql/001_create_tables.sql
scripts/sql/002_add_provisions.sql
scripts/sql/003_add_dataset_hashes.sql
scripts/sql/005_add_reform_type.sql
```

## Deployment

- **Frontend**: Modal (auto-deploys from `main` via GitHub Actions)
- **Database**: Supabase (PostgreSQL with RLS)
- **Bill monitor**: Run locally or in CI with `python scripts/legiscan_monitor.py`

## Claude Code Commands

| Command | Purpose |
|---------|---------|
| `/triage-bills` | Score unscored bills with human review |
| `/encode-bill STATE BILL` | Full encoding pipeline for a specific bill |
| `/score-bill STATE BILL` | Quick score without database writes |
| `/browse-parameters` | Browse PolicyEngine parameter tree |

## Project Structure

```
├── src/                    # React frontend
├── scripts/
│   ├── compute_impacts.py  # Microsimulation + database writes
│   ├── legiscan_monitor.py # LegiScan bill discovery pipeline
│   ├── db_schema.py        # Schema formatting utilities
│   └── sql/                # Database migrations
├── .claude/
│   ├── commands/           # Claude Code slash commands
│   └── agents/             # Specialized sub-agents
├── modal_app.py            # Modal deployment config
└── .github/workflows/
    ├── deploy.yml          # Auto-deploy frontend on push to main
    └── publish-bill.yml    # Publish bill on PR merge
```
