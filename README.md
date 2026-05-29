# Community Health Intelligence Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live_Demo-community--health--intelligence.netlify.app-2563EB?style=for-the-badge)](https://community-health-intelligence.netlify.app)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ryancreates-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/ryancreates)

A full-stack business intelligence project identifying US counties where health risk, economic vulnerability, and food access barriers overlap. Built with CDC, Census, and USDA public data, served via a live Neon PostgreSQL database and Netlify serverless functions.

---

## Live Dashboard

**[community-health-intelligence.netlify.app](https://community-health-intelligence.netlify.app)**

- Interactive choropleth map of all 3,100+ US counties
- Real-time scores computed from a live cloud database
- Year selector, metric switcher, hover tooltips
- Top 10 county rankings with full KPI breakdown

---

## Screenshots

### Full Dashboard
![Dashboard Overview](docs/screenshots/dashboard-overview.png)

### County Risk Map
![Map View](docs/screenshots/kpi-and-charts.png)

---

## Business Problem

Public health agencies often work with fragmented datasets and limited outreach budgets. A county may have high chronic disease rates, extreme poverty, and poor food access — but no single tool captures all three at once.

This dashboard answers one practical question: **Which counties should be prioritized for public health outreach based on combined health, economic, and food access risk?**

---

## Data Sources

| Source | Dataset | Coverage | Purpose |
|---|---|---|---|
| CDC | PLACES County Data 2023 | 3,145 counties | Chronic disease outcomes and preventive care rates |
| Census Bureau | ACS 5-Year Estimates 2023 | 3,144 counties | Poverty, uninsured rate, median income |
| USDA ERS | Food Access Research Atlas 2019 | 72,531 census tracts | Low income + low access population share |

---

## Scoring Model

Priority Score = **40% Health Risk + 35% Economic Vulnerability + 25% Food Access Burden**

Each dimension is min-max normalized to 0–100 across all counties using PostgreSQL window functions, then weighted into a composite priority score.

| Tier | Score | Description |
|---|---|---|
| HIGH | ≥ 50 | Immediate intervention priority |
| ELEVATED | ≥ 35 | Strong candidate for outreach |
| MODERATE | ≥ 20 | Monitor and assess |
| LOW | < 20 | Below average combined risk |

### Health Risk Measures (CDC PLACES)
Diabetes · Obesity · Hypertension · Coronary Heart Disease · COPD · Cancer · Asthma · Stroke · Poor Mental Health · Poor Physical Health

### Preventive Care Gap (CDC PLACES, inverted)
Annual Checkup · Dental Visit · Mammography · Cervical Screening · Cholesterol Screening

### Economic Vulnerability (Census ACS)
Poverty Rate (50%) · Uninsured Rate (30%) · Median Household Income, inverted (20%)

### Food Access Burden (USDA)
Low income + low access population as share of county population

---

## Tech Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 17 on Neon (serverless) |
| ETL | Python — pandas, psycopg2, requests, tenacity |
| API | Netlify Functions (Node.js + pg) |
| Frontend | React + Vite |
| Map | Leaflet + react-leaflet |
| Charts | Recharts |
| Deployment | Netlify (CD from GitHub) |

---

## Project Structure

```
community-health-intelligence/
├── database/
│   ├── schema.sql                    # Core table definitions
│   ├── indexes.sql                   # Performance indexes
│   ├── views.sql                     # Reporting views
│   ├── stored_procedures.sql         # Scoring procedures
│   └── migrations/
│       └── 001_add_time_series.sql   # Time-series support, trend views
├── etl/
│   ├── run_pipeline.py               # National ETL orchestrator (all 50 states)
│   ├── load_cdc_places.py            # CDC PLACES loader
│   ├── load_census_acs.py            # Census ACS loader
│   ├── load_food_access.py           # USDA Food Access loader
│   └── clean_transform.py            # Data cleaning utilities
├── netlify/
│   └── functions/
│       ├── scores.js                 # County scores API endpoint
│       └── years.js                  # Available years endpoint
├── frontend/
│   └── src/
│       ├── App.jsx                   # Main dashboard
│       ├── data.js                   # API fetch layer
│       ├── style.css                 # Dashboard styles
│       └── components/
│           └── CountyMap.jsx         # Leaflet choropleth map
├── sql/
│   ├── beginner_queries.sql
│   ├── intermediate_queries.sql
│   ├── advanced_queries.sql
│   └── performance_tuning.sql
└── docs/
    ├── INTEGRATION.md                # Step-by-step setup guide
    ├── data_dictionary.md
    └── interview_talking_points.md
```

---

## Running the ETL Pipeline

### Prerequisites
- Python 3.10+
- PostgreSQL 17 client (`psql`)
- Neon account (or any PostgreSQL instance)
- Census API key: [api.census.gov/data/key_signup.html](https://api.census.gov/data/key_signup.html)

### Setup

```bash
pip install pandas psycopg2-binary requests python-dotenv tqdm tenacity openpyxl
```

Create `.env` in repo root:
```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
DB_HOST=your-host
DB_PORT=5432
DB_NAME=your-db
DB_USER=your-user
DB_PASSWORD=your-password
CENSUS_API_KEY=your-key
```

Run schema migrations:
```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/migrations/001_add_time_series.sql
```

Download USDA Food Access Atlas (2019) and save to `data/raw/food_access_atlas_2019.xlsx`:
[ers.usda.gov/data-products/food-access-research-atlas](https://www.ers.usda.gov/data-products/food-access-research-atlas/download-the-data/)

Run the pipeline:
```bash
# Test with a few states first
python etl/run_pipeline.py --year 2023 --states TN TX FL

# Full national load
python etl/run_pipeline.py --year 2023
```

The pipeline is resumable — if interrupted, re-run the same command and it skips already-loaded states.

---

## SQL Techniques Demonstrated

- Multi-source joins across CDC, Census, and USDA datasets
- Window functions for national and state-level ranking
- CTEs with layered normalization logic
- Min-max scoring with NULL-safe division
- Materialized views for dashboard performance
- Stored procedures for annual score refresh
- Indexing strategy for county + year composite keys
- Time-series schema supporting multi-year trend analysis

---

## API Endpoints

Served via Netlify Functions:

| Endpoint | Description |
|---|---|
| `GET /.netlify/functions/scores` | All county scores (latest year) |
| `GET /.netlify/functions/scores?year=2023` | County scores for a specific year |
| `GET /.netlify/functions/years` | Available data years |

---

## Target Users

| User | Decision |
|---|---|
| Public health program manager | Which counties need intervention first? |
| Grant analyst | Where should funding be directed? |
| Community outreach team | Which locations need screenings or campaigns? |
| Executive stakeholder | What are the top risk areas and why? |

---

## About

Built by Ryan as a Business Intelligence portfolio project demonstrating SQL analytics, KPI modeling, ETL pipeline development, and full-stack dashboard deployment with live public health data.
