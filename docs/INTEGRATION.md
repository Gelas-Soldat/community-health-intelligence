# Integration Guide
## Map Layer · Time-Series Schema · National Data Load

This doc walks through exactly how to drop these three pieces into
your existing project. Do them in order — the schema migration has
to come first.

---

## Step 1: Run the Schema Migration

```bash
psql -d your_db_name -f database/migrations/001_add_time_series.sql
```

**What it does:**
- Adds `data_year SMALLINT` to `cdc_health_data`, `census_acs_data`, and `food_access_data`
- Rebuilds primary keys as composite `(county_fips, data_year)`
- Drops and recreates `county_scores` with year support
- Creates `county_score_trends` for pre-computed YoY deltas
- Adds `data_loads` tracking table
- Creates four new views: `v_latest_scores`, `v_score_history`, `v_county_trends`, `v_state_risk_summary`
- Adds a `compute_trends(year)` stored procedure

**Existing data:**
Your existing rows get `data_year = 2022` (or 2019 for food access). Nothing is deleted.

**Your `score_counties()` stored procedure** needs one small update — add a `p_year` parameter
and filter on `data_year = p_year` everywhere it references the fact tables. The pattern:

```sql
-- Before
CREATE OR REPLACE PROCEDURE score_counties() ...
    FROM cdc_health_data c
    JOIN census_acs_data a USING (county_fips)

-- After
CREATE OR REPLACE PROCEDURE score_counties(p_year SMALLINT) ...
    FROM cdc_health_data c
    JOIN census_acs_data a USING (county_fips)
    WHERE c.data_year = p_year
      AND a.data_year = p_year
```

---

## Step 2: Update Your ETL Loaders

Replace your existing three ETL files with the updated versions:
```
etl/load_cdc_places.py   ← updated (year param + upsert logic)
etl/load_census_acs.py   ← updated (year param + all 50 states)
etl/load_food_access.py  ← updated (atlas_year vs data_year split)
```

Add the new orchestrator:
```
etl/run_pipeline.py      ← new (coordinates all three loaders)
```

Update `requirements.txt`:
```
tqdm>=4.66
tenacity>=8.2
```

---

## Step 3: Run the National Load

**First time — load all historical years you have data for:**

```bash
# 2020 data
python etl/run_pipeline.py --year 2020

# 2021 data
python etl/run_pipeline.py --year 2021

# 2022 data (your original 5-state load)
python etl/run_pipeline.py --year 2022

# 2023 data (current)
python etl/run_pipeline.py --year 2023
```

**Test with a subset first:**

```bash
python etl/run_pipeline.py --year 2023 --states TN TX FL CA NY
```

**The pipeline is resumable.** If it dies mid-run on Census (the slowest part
because it hits the API per state), just re-run the same command. It checks
`data_loads` and skips states already done.

**After each year loads, trigger scoring:**

```bash
psql -d your_db_name -c "CALL score_counties(2023); CALL compute_trends(2023);"
```

**Expected timing:**
- CDC PLACES: ~30 seconds (one national file)
- Census ACS: ~15-25 minutes for all 50 states (API rate limits)
- Food Access: ~2 minutes (one national file, tract → county aggregation)

---

## Step 4: Update Your Frontend Data Layer

### If you're using a static `data.js` file:

Replace the hardcoded array with a fetch that hits your Postgres views via
whatever backend you have (or a serverless function):

```js
// data.js
export async function fetchCountyData(year = null) {
  const url = year
    ? `/api/scores?year=${year}`
    : `/api/scores`;           // returns latest year
  const resp = await fetch(url);
  return resp.json();
}

export async function fetchAvailableYears() {
  const resp = await fetch("/api/years");
  return resp.json();
}
```

The API should return rows from `v_latest_scores` (for current) or
`v_score_history` (for all years). The `CountyMap` component expects
objects shaped like:

```js
{
  county_fips:         "47065",
  county_name:         "Hamilton",
  state_abbr:          "TN",
  data_year:           2023,
  priority_score:      78.4,
  health_risk_score:   71.2,
  economic_risk_score: 65.8,
  food_access_burden:  55.1,
  preventive_care_gap: 48.3,
  risk_tier:           "HIGH",
  // optional — from county_score_trends join
  priority_score_delta: 3.2   // positive = worsening
}
```

### If you don't have a backend yet (static Netlify deploy):

Export the data as JSON from Postgres at build time:

```bash
# Export to a static JSON file
psql -d your_db_name -t -A -F"," -c "
  SELECT row_to_json(v) FROM v_score_history v
" | python -c "
import sys, json
rows = [json.loads(line) for line in sys.stdin if line.strip()]
print(json.dumps(rows))
" > frontend/public/county-scores.json
```

Then in your app:
```js
const data = await fetch("/county-scores.json").then(r => r.json());
```

---

## Step 5: Add the Map to Your Dashboard

```jsx
// In your App.jsx or Dashboard.jsx

import CountyMap from "./components/CountyMap";

// Install deps first:
// npm install leaflet react-leaflet

function Dashboard() {
  const [countyData, setCountyData] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);

  useEffect(() => {
    // Fetch all years for the map's year selector
    fetchCountyData().then(setCountyData);
    fetchAvailableYears().then(setAvailableYears);
  }, []);

  const handleCountyClick = (fips, name) => {
    // Open your existing county drilldown sidebar
    setSelectedCounty(fips);
  };

  return (
    <div style={{ height: "600px" }}>
      <CountyMap
        countyData={countyData}
        availableYears={availableYears}
        onCountyClick={handleCountyClick}
      />
    </div>
  );
}
```

**The map needs an explicit height on its container.** Leaflet doesn't
render correctly without a defined height on the parent element.

---

## Ongoing: Annual Data Refresh

Every year when CDC/Census release new data, just run:

```bash
python etl/run_pipeline.py --year 2024
psql -d your_db_name -c "CALL score_counties(2024); CALL compute_trends(2024);"
```

The dashboard picks up the new year automatically via `v_latest_scores`
and the year selector in `CountyMap` will have the new option once
`fetchAvailableYears()` queries distinct `data_year` values from
`county_scores`.

---

## Troubleshooting

**Census API returns 404 for some variables:**
Some ACS variables aren't available in every year. The loader silently
skips missing columns rather than crashing. Check the log output for
`WARNING` lines identifying affected states/years.

**GeoJSON doesn't load in the map:**
The component fetches county boundaries from Plotly's public dataset.
If that URL changes, replace the `url` constant in `CountyMap.jsx`
with a locally hosted copy in `frontend/public/`.

**`compute_trends` shows 0 rows:**
You need at least 2 years of data in `county_scores`. Load a second year
and re-run the procedure.

**Scoring stored procedure errors after migration:**
Make sure you updated `score_counties()` to accept and filter on the
`p_year` parameter (see Step 1 above).
