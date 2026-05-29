import { useState, useEffect } from "react";
import "./style.css";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, CartesianGrid,
} from "recharts";
import { fetchScores, fetchYears, countyData as fallbackData } from "./data";
import CountyMap from "./components/CountyMap";

// Valid US states + DC (filters out territories)
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY"
]);

const TIER_COLORS = {
  HIGH:     "#dc2626",
  ELEVATED: "#ea580c",
  MODERATE: "#ca8a04",
  LOW:      "#16a34a",
};

function StatCard({ label, value, loading, accent }) {
  return (
    <div className="metric-card" style={{ "--accent-color": accent }}>
      <small>{label}</small>
      <h2 className={loading ? "loading-pulse" : ""}>{loading ? "—" : value}</h2>
    </div>
  );
}

function TierBadge({ tier }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: "20px",
      fontSize: "11px",
      fontWeight: 600,
      background: `${TIER_COLORS[tier]}18`,
      color: TIER_COLORS[tier],
      border: `1px solid ${TIER_COLORS[tier]}40`,
    }}>
      {tier}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #334155",
      borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e2e8f0"
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: "#94a3b8" }}>
          {p.name}: <span style={{ color: "#fff" }}>{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function App() {
  const [countyData,     setCountyData]     = useState(fallbackData);
  const [availableYears, setAvailableYears] = useState([2023]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);

  useEffect(() => {
    fetchYears()
      .then(years => setAvailableYears(years))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchScores()
      .then(data => { setCountyData(data); setLoading(false); })
      .catch(err  => { setError(err.message); setLoading(false); });
  }, []);

  // Filter to US states only
  const usData = countyData.filter(c => US_STATES.has(c.state_abbr));

  // KPIs
  const avgScore      = usData.length ? Math.round(usData.reduce((a, b) => a + b.priority_score, 0) / usData.length) : 0;
  const highRisk      = usData.filter(c => c.risk_tier === "HIGH").length;
  const stateCount    = new Set(usData.map(c => c.state_abbr)).size;
  const topCounties   = [...usData].sort((a, b) => b.priority_score - a.priority_score).slice(0, 10);

  return (
    <>
      {/* ── Hero ── */}
      <div className="hero-wrapper">
        <section className="hero">
          <div>
            <div className="eyebrow">Business Intelligence Portfolio Project</div>
            <h1>Community Health<br />Access Dashboard</h1>
            <p className="hero-text">
              Identifying counties where health risk, economic vulnerability, and
              food access barriers overlap — helping public health teams prioritize
              limited outreach resources across the United States.
            </p>
            <div className="source-badges">
              <span>CDC PLACES 2023</span>
              <span>Census ACS 5-Year</span>
              <span>USDA Food Access Atlas</span>
              <span>3,100+ Counties</span>
            </div>
          </div>
          <div className="summary-card">
            <h3>Tech Stack</h3>
            <p style={{ marginBottom: 16 }}>
              PostgreSQL · Neon · Netlify Functions · React · Recharts · Leaflet
            </p>
            <h3>Scoring Model</h3>
            <p>40% Health Risk · 35% Economic Vulnerability · 25% Food Access Burden</p>
          </div>
        </section>
      </div>

      <div className="container">

        {error && <div className="error-banner">⚠ API error: {error} — showing cached data.</div>}

        {/* ── KPI Cards ── */}
        <div className="metrics">
          <StatCard label="Avg Priority Score"  value={avgScore}                     loading={loading} />
          <StatCard label="High Risk Counties"  value={highRisk.toLocaleString()}    loading={loading} />
          <StatCard label="States Covered"      value={stateCount}                   loading={loading} />
        </div>

        {/* ── Map ── */}
        <section className="card" style={{ padding: "28px 28px 20px" }}>
          <div className="section-label">Geographic Risk Analysis</div>
          <h2 style={{ marginBottom: 4 }}>County Risk Map</h2>
          <p style={{ marginBottom: 20, fontSize: 13 }}>
            Counties colored by composite priority score. Hover for details, click to explore.
          </p>
          <div style={{ height: 560 }}>
            <CountyMap
              countyData={countyData}
              availableYears={availableYears}
              onCountyClick={(fips, name) => console.log("Selected:", fips, name)}
            />
          </div>
          <div className="tier-legend">
            {Object.entries(TIER_COLORS).map(([tier, color]) => (
              <div key={tier} className="tier-item">
                <div className="tier-dot" style={{ background: color }} />
                <span>{tier.charAt(0) + tier.slice(1).toLowerCase()} Risk</span>
              </div>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
              Score thresholds: HIGH ≥50 · ELEVATED ≥35 · MODERATE ≥20
            </span>
          </div>
        </section>

        {/* ── Charts ── */}
        <div className="charts">
          <div className="card">
            <div className="section-label">Priority Ranking</div>
            <h2>Top 10 Counties</h2>
            <p style={{ marginBottom: 20, fontSize: 13 }}>Highest composite risk scores nationally.</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topCounties} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                <XAxis
                  dataKey="county_name"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis domain={[0, 80]} tick={{ fontSize: 10, fill: "#64748b" }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="priority_score" fill="#2563eb" radius={[4, 4, 0, 0]} name="Priority Score" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="section-label">Risk Correlation</div>
            <h2>Economic vs Health Risk</h2>
            <p style={{ marginBottom: 20, fontSize: 13 }}>Each dot represents one county nationally.</p>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="economic_risk_score"
                  name="Economic Risk"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  label={{ value: "Economic Risk", position: "insideBottom", offset: -10, fontSize: 11, fill: "#94a3b8" }}
                />
                <YAxis
                  dataKey="health_risk_score"
                  name="Health Risk"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  label={{ value: "Health Risk", angle: -90, position: "insideLeft", fontSize: 11, fill: "#94a3b8" }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={usData} fill="#2563eb" fillOpacity={0.5} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Methodology + Stakeholders ── */}
        <div className="stakeholders">
          <div className="card">
            <div className="section-label">Business Context</div>
            <h2>The Problem</h2>
            <p style={{ marginBottom: 16 }}>
              Public health agencies operate with limited outreach budgets and fragmented
              data. A county may have high chronic disease rates, extreme poverty, and poor
              food access simultaneously — but no single dataset captures the full picture.
            </p>
            <p>
              This dashboard combines three federal datasets into a single composite priority
              score, giving planners a ranked list of where intervention dollars will have
              the most impact.
            </p>
          </div>

          <div className="card">
            <div className="section-label">Scoring Methodology</div>
            <h2>How It Works</h2>
            <p style={{ marginBottom: 16 }}>Priority Score = weighted composite of three normalized dimensions:</p>
            <ul>
              <li><strong>40% Health Risk</strong> — Average of 10 CDC chronic disease indicators</li>
              <li><strong>35% Economic Vulnerability</strong> — Poverty rate, uninsured rate, median income</li>
              <li><strong>25% Food Access Burden</strong> — USDA low income + low access population share</li>
            </ul>
            <div className="tier-legend" style={{ marginTop: 20, paddingTop: 16 }}>
              {Object.entries(TIER_COLORS).map(([tier, color]) => (
                <div key={tier} className="tier-item">
                  <div className="tier-dot" style={{ background: color }} />
                  <span style={{ fontSize: 12 }}>{tier}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Top Counties Table ── */}
        <section className="card">
          <div className="section-label">Highest Priority Counties</div>
          <h2 style={{ marginBottom: 20 }}>Top 10 by National Rank</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                {["Rank","County","State","Priority","Health","Economic","Food Access","Tier"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topCounties.map((c, i) => (
                <tr key={c.county_fips} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "#94a3b8" }}>#{i + 1}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 500 }}>{c.county_name}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>{c.state_abbr}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0f172a" }}>{c.priority_score}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>{c.health_risk_score.toFixed(1)}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>{c.economic_risk_score.toFixed(1)}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>{c.food_access_burden.toFixed(1)}</td>
                  <td style={{ padding: "10px 12px" }}><TierBadge tier={c.risk_tier} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── SQL Skills ── */}
        <section className="card">
          <div className="section-label">Technical Skills</div>
          <h2 style={{ marginBottom: 16 }}>SQL & Analytics Techniques</h2>
          <div className="skills-grid">
            {["Complex Joins","CTEs","Window Functions","Materialized Views","Indexes","Subqueries",
              "Performance Tuning","KPI Modeling","Normalization","Stored Procedures"].map(s => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </section>

        <footer className="footer">
          <p>
            Built by Ryan · Community Health Intelligence BI Dashboard ·
            Data: CDC PLACES, Census ACS, USDA Food Access Research Atlas · 2023
          </p>
        </footer>

      </div>
    </>
  );
}
