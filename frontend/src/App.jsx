import { useState, useEffect, useRef } from "react";
import "./style.css";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchScores, fetchYears, countyData as fallbackData } from "./data";
import CountyMap from "./components/CountyMap";

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY"
]);

const TIER_CONFIG = {
  HIGH:     { color: "#ef4444", bg: "rgba(239,68,68,0.12)",    border: "rgba(239,68,68,0.3)"    },
  ELEVATED: { color: "#f97316", bg: "rgba(249,115,22,0.12)",   border: "rgba(249,115,22,0.3)"   },
  MODERATE: { color: "#eab308", bg: "rgba(234,179,8,0.12)",    border: "rgba(234,179,8,0.3)"    },
  LOW:      { color: "#22c55e", bg: "rgba(34,197,94,0.12)",    border: "rgba(34,197,94,0.3)"    },
};

// Animated counter hook
function useCounter(target, duration = 1200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

function TierBadge({ tier }) {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.LOW;
  return (
    <span className="tier-badge" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {tier}
    </span>
  );
}

function ScoreBar({ value, max = 100, color }) {
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-bg">
        <div className="score-bar-fill" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 28, textAlign: "right" }}>{value.toFixed(0)}</span>
    </div>
  );
}

function KpiCard({ label, value, sub, accent = "#3b82f6", loading }) {
  const animated = useCounter(loading ? 0 : value);
  return (
    <div className="kpi-card" style={{ "--kpi-color": accent }}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${loading ? "loading" : ""}`}>
        {loading ? "—" : animated.toLocaleString()}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

const DarkTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: "#f0f4f8", marginBottom: 4 }}>{d?.county_name}, {d?.state_abbr}</div>
      <div style={{ color: "#7a8ba0" }}>Health: <span style={{ color: "#f0f4f8" }}>{d?.health_risk_score?.toFixed(1)}</span></div>
      <div style={{ color: "#7a8ba0" }}>Economic: <span style={{ color: "#f0f4f8" }}>{d?.economic_risk_score?.toFixed(1)}</span></div>
      <div style={{ color: "#7a8ba0", marginTop: 4 }}><TierBadge tier={d?.risk_tier} /></div>
    </div>
  );
};

export default function App() {
  const [countyData,     setCountyData]     = useState(fallbackData);
  const [availableYears, setAvailableYears] = useState([2023]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState("");
  const [stateFilter,    setStateFilter]    = useState("ALL");
  const [sortBy,         setSortBy]         = useState("priority_score");
  const [sortDir,        setSortDir]        = useState("desc");

  useEffect(() => {
    fetchYears().then(setAvailableYears).catch(() => {});
    fetchScores()
      .then(data => { setCountyData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const usData = countyData.filter(c => US_STATES.has(c.state_abbr));

  // KPIs
  const avgScore   = usData.length ? Math.round(usData.reduce((a, b) => a + b.priority_score, 0) / usData.length) : 0;
  const highRisk   = usData.filter(c => c.risk_tier === "HIGH").length;
  const stateCount = new Set(usData.map(c => c.state_abbr)).size;
  const countyCount = usData.length;

  // Tier distribution
  const tierCounts = { HIGH: 0, ELEVATED: 0, MODERATE: 0, LOW: 0 };
  usData.forEach(c => { if (tierCounts[c.risk_tier] !== undefined) tierCounts[c.risk_tier]++; });

  // Unique states for filter
  const stateOptions = ["ALL", ...Array.from(new Set(usData.map(c => c.state_abbr))).sort()];

  // Filtered + sorted table data
  const tableData = usData
    .filter(c => {
      const matchSearch = search === "" ||
        c.county_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.state_abbr?.toLowerCase().includes(search.toLowerCase());
      const matchState  = stateFilter === "ALL" || c.state_abbr === stateFilter;
      return matchSearch && matchState;
    })
    .sort((a, b) => {
      const mul = sortDir === "desc" ? -1 : 1;
      return (a[sortBy] - b[sortBy]) * mul;
    })
    .slice(0, 50);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const sortArrow = (col) => sortBy === col ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <div className="page">

      {/* ── Hero ── */}
      <header className="hero">
        <div>
          <div className="hero-eyebrow">Business Intelligence Portfolio · Public Health Analytics</div>
          <h1>Where should <span>public health</span><br />dollars go first?</h1>
          <p className="hero-sub">
            This dashboard combines CDC disease data, Census poverty estimates, and USDA food 
            access records to rank every US county by combined health risk — giving planners 
            a clear, data-driven answer to that question.
          </p>
          <div className="badges">
            <span className="badge">CDC PLACES 2023</span>
            <span className="badge">Census ACS 5-Year</span>
            <span className="badge">USDA Food Access 2019</span>
            <span className="badge">Live Neon Database</span>
            <span className="badge">Netlify Functions API</span>
          </div>
        </div>
        <div className="hero-meta">
          <div className="meta-item">
            <div className="meta-label">Scoring Model</div>
            <div className="meta-value">40% Health · 35% Economic · 25% Food Access</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Stack</div>
            <div className="meta-value">PostgreSQL · React · Leaflet · Netlify</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Data Coverage</div>
            <div className="meta-value">3,100+ counties · All 50 states + DC</div>
          </div>
        </div>
      </header>

      {/* ── KPI Cards ── */}
      <div className="kpi-grid">
        <KpiCard label="Counties Tracked"  value={countyCount} sub="Across all 50 states + DC" accent="#3b82f6" loading={loading} />
        <KpiCard label="High Risk Counties" value={highRisk}   sub="Priority score ≥ 50"       accent="#ef4444" loading={loading} />
        <KpiCard label="Avg Priority Score" value={avgScore}   sub="National average (0–100)"  accent="#f97316" loading={loading} />
        <KpiCard label="States Covered"     value={stateCount} sub="Including DC"               accent="#22c55e" loading={loading} />
      </div>

      {/* ── How to Read This ── */}
      <div className="card" style={{ marginBottom: 20, background: "rgba(59,130,246,0.05)", borderColor: "rgba(59,130,246,0.15)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24 }}>
          <div>
            <div className="card-eyebrow">How to read this dashboard</div>
            <h2 style={{ marginBottom: 8 }}>What the scores mean</h2>
            <p className="card-desc">
              Every US county gets a priority score from 0 to 100. Higher means more need. 
              No single factor decides it — a county scores high only when health outcomes, 
              economic hardship, and food access problems all point the same direction.
            </p>
          </div>
          {[
            { tier: "HIGH", color: "#ef4444", range: "Score ≥ 50", desc: "Faces serious challenges across multiple dimensions. These counties should be first in line for outreach, funding, and intervention programs." },
            { tier: "ELEVATED", color: "#f97316", range: "Score 35–49", desc: "Meaningful risk in at least one or two areas. Worth monitoring closely and including in regional planning conversations." },
            { tier: "MODERATE", color: "#eab308", range: "Score 20–34", desc: "Below the national average for combined risk. Some pockets of need may exist but the county is not a priority target." },
            { tier: "LOW", color: "#22c55e", range: "Score < 20", desc: "Relatively healthy, economically stable, and food-accessible compared to the rest of the country." },
          ].map(({ tier, color, range, desc }) => (
            <div key={tier} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color }}>{tier}</span>
                <span style={{ fontSize: 11, color: "var(--muted2)" }}>{range}</span>
              </div>
              <p className="card-desc" style={{ fontSize: 12 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Map ── */}
      <div className="card">
        <div className="card-header">
          <div className="card-eyebrow">Geographic Analysis</div>
          <h2>County Risk Map</h2>
          <p className="card-desc">
            Every US county colored by composite priority score. Red = highest need. 
            Hover any county to see its full breakdown. Use the metric selector to explore individual dimensions.
          </p>
        </div>
        <div style={{ height: 560 }}>
          <CountyMap
            countyData={countyData}
            availableYears={availableYears}
            onCountyClick={(fips, name) => console.log("Selected:", fips, name)}
          />
        </div>
      </div>

      {/* ── Table + Tier Distribution ── */}
      <div className="three-col">
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header">
            <div className="card-eyebrow">County Explorer</div>
            <h2>Search & Filter Counties</h2>
            <p className="card-desc">Showing top 50 results. Search by county or state name.</p>
          </div>
          <div className="table-controls">
            <input
              className="search-input"
              placeholder="Search county or state..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="filter-select" value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              {stateOptions.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
<th>County</th>
<th>St</th>
<th onClick={() => handleSort("priority_score")}>Score{sortArrow("priority_score")}</th>
<th onClick={() => handleSort("health_risk_score")}>Health{sortArrow("health_risk_score")}</th>
<th onClick={() => handleSort("economic_risk_score")}>Econ{sortArrow("economic_risk_score")}</th>
<th onClick={() => handleSort("food_access_burden")}>Food{sortArrow("food_access_burden")}</th>
<th>Tier</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--muted2)" }}>Loading data...</td></tr>
                ) : tableData.map((c, i) => (
                  <tr key={c.county_fips}>
                    <td><span className="rank-num">{i + 1}</span></td>
                    <td><span className="county-name">{c.county_name}</span></td>
                    <td style={{ color: "var(--muted2)", fontSize: 11 }}>{c.state_abbr}</td>
                    <td><span className="score-num">{c.priority_score}</span></td>
                    <td><ScoreBar value={c.health_risk_score}   color="#3b82f6" /></td>
<td><ScoreBar value={c.economic_risk_score} color="#f97316" /></td>
<td><ScoreBar value={c.food_access_burden}  color="#22c55e" /></td>
<td><TierBadge tier={c.risk_tier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Tier Distribution */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-header">
              <div className="card-eyebrow">Risk Distribution</div>
              <h2>Counties by Tier</h2>
            </div>
            <div className="tier-dist">
              {Object.entries(TIER_CONFIG).map(([tier, cfg]) => (
                <div key={tier} className="tier-dist-row">
                  <div className="tier-dist-label" style={{ color: cfg.color, fontSize: 11 }}>{tier}</div>
                  <div className="tier-dist-bar-bg">
                    <div
                      className="tier-dist-bar-fill"
                      style={{
                        width: `${countyCount ? (tierCounts[tier] / countyCount) * 100 : 0}%`,
                        background: cfg.color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <div className="tier-dist-count">{tierCounts[tier].toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Scatter Plot */}
          <div className="card" style={{ marginBottom: 0, flex: 1 }}>
            <div className="card-header">
              <div className="card-eyebrow">Risk Correlation</div>
              <h2>Economic vs Health Risk</h2>
              <p className="card-desc">Each dot is a US county. Counties toward the top-right face overlapping challenges.</p>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 16, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="economic_risk_score" name="Economic Risk" tick={{ fontSize: 9, fill: "#4a5a6a" }}
                  label={{ value: "Economic Risk →", position: "insideBottom", offset: -8, fontSize: 10, fill: "#4a5a6a" }} />
                <YAxis dataKey="health_risk_score" name="Health Risk" tick={{ fontSize: 9, fill: "#4a5a6a" }}
                  label={{ value: "Health Risk →", angle: -90, position: "insideLeft", fontSize: 10, fill: "#4a5a6a" }} />
                <Tooltip content={<DarkTooltip />} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
                <Scatter data={usData} fill="#3b82f6" fillOpacity={0.4} r={2} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Methodology ── */}
      <div className="card">
        <div className="card-header">
          <div className="card-eyebrow">How Scores Are Calculated</div>
          <h2>Scoring Methodology</h2>
          <p className="card-desc">
            Each county receives a score from 0–100 on three dimensions. Those scores are 
            normalized nationally (so the highest-risk county in each dimension always scores 100), 
            then weighted and combined into a single priority score.
          </p>
        </div>
        <div className="method-grid">
          <div className="method-pill">
            <div className="method-pct" style={{ color: "#3b82f6" }}>40%</div>
            <div className="method-name">Health Risk</div>
            <div className="method-desc">
              Average of 10 CDC chronic disease rates: diabetes, obesity, hypertension, 
              heart disease, COPD, cancer, asthma, stroke, poor mental & physical health days.
            </div>
          </div>
          <div className="method-pill">
            <div className="method-pct" style={{ color: "#f97316" }}>35%</div>
            <div className="method-name">Economic Vulnerability</div>
            <div className="method-desc">
              Weighted composite of poverty rate (50%), uninsured rate (30%), 
              and median household income — inverted so lower income = higher risk (20%).
            </div>
          </div>
          <div className="method-pill">
            <div className="method-pct" style={{ color: "#22c55e" }}>25%</div>
            <div className="method-name">Food Access Burden</div>
            <div className="method-desc">
              Share of the county population that is both low-income and lives more than 
              1 mile from a grocery store, per USDA Food Access Research Atlas.
            </div>
          </div>
        </div>
      </div>

      {/* ── SQL Skills ── */}
      <div className="card">
        <div className="card-header">
          <div className="card-eyebrow">Technical Portfolio</div>
          <h2>SQL & Analytics Techniques Demonstrated</h2>
        </div>
        <div className="skills-wrap">
          {[
            "Window Functions","CTEs","Min-Max Normalization","Multi-source Joins",
            "Stored Procedures","Materialized Views","Composite Indexing","KPI Modeling",
            "NULL-safe Arithmetic","Serverless API Design","ETL Pipeline","Time-series Schema"
          ].map(s => <span key={s} className="skill-tag">{s}</span>)}
        </div>
      </div>

      <footer className="footer">
        <p>
          Community Health Intelligence · Built by Ryan ·
          Data: CDC PLACES, US Census Bureau, USDA ERS · 2023
        </p>
      </footer>

    </div>
  );
}
