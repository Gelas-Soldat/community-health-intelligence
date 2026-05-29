import { useState, useEffect } from "react";
import "./style.css";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar
} from "recharts";
import { fetchScores, fetchYears, countyData as fallbackData } from "./data";
import CountyMap from "./components/CountyMap";

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY"
]);

const TIER_CONFIG = {
  HIGH:     { color: "#ef4444", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)"  },
  ELEVATED: { color: "#f97316", bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.3)" },
  MODERATE: { color: "#eab308", bg: "rgba(234,179,8,0.12)",  border: "rgba(234,179,8,0.3)"  },
  LOW:      { color: "#22c55e", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.3)"  },
};

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

function ScoreBar({ value, color }) {
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-bg">
        <div className="score-bar-fill" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
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

const LinkCard = ({ name, desc, url }) => (
  <a href={url} target="_blank" rel="noopener noreferrer"
    style={{ display: "block", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", textDecoration: "none", transition: "border-color 0.2s" }}
    onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)"}
    onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"}
  >
    <div style={{ fontSize: 12, fontWeight: 600, color: "#3b82f6", marginBottom: 3 }}>{name} →</div>
    <div style={{ fontSize: 11, color: "var(--muted2)" }}>{desc}</div>
  </a>
);

const COMMUNITY_META = [
  { label: "Who is this for?",    value: "Residents, advocates, health planners & policymakers" },
  { label: "What can I do here?", value: "Search your county, explore risk factors, find contacts" },
  { label: "Data Coverage",       value: "3,100+ counties · All 50 states + DC" },
];

const TECHNICAL_META = [
  { label: "Scoring Model",  value: "40% Health · 35% Economic · 25% Food Access" },
  { label: "Stack",          value: "PostgreSQL · React · Leaflet · Netlify Functions" },
  { label: "Data Coverage",  value: "3,100+ counties · 126K+ rows across 3 sources" },
];

export default function App() {
  const [countyData,     setCountyData]     = useState(fallbackData);
  const [availableYears, setAvailableYears] = useState([2023]);
  const [loading,        setLoading]        = useState(true);
  const [activeTab,      setActiveTab]      = useState("community");
  const [search,         setSearch]         = useState("");
  const [stateFilter,    setStateFilter]    = useState("ALL");
  const [sortBy,         setSortBy]         = useState("priority_score");
  const [sortDir,        setSortDir]        = useState("desc");
  const [showAll,        setShowAll]        = useState(false);

  useEffect(() => {
    fetchYears().then(setAvailableYears).catch(() => {});
    fetchScores()
      .then(data => { setCountyData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Reset show-all when search/filter changes
  useEffect(() => { setShowAll(false); }, [search, stateFilter]);

  const usData = countyData.filter(c => US_STATES.has(c.state_abbr));
  const avgScore    = usData.length ? Math.round(usData.reduce((a, b) => a + b.priority_score, 0) / usData.length) : 0;
  const highRisk    = usData.filter(c => c.risk_tier === "HIGH").length;
  const stateCount  = new Set(usData.map(c => c.state_abbr)).size;
  const countyCount = usData.length;

  const tierCounts = { HIGH: 0, ELEVATED: 0, MODERATE: 0, LOW: 0 };
  usData.forEach(c => { if (tierCounts[c.risk_tier] !== undefined) tierCounts[c.risk_tier]++; });

  const stateOptions = ["ALL", ...Array.from(new Set(usData.map(c => c.state_abbr))).sort()];

  const filteredData = usData
    .filter(c => {
      const matchSearch = search === "" ||
        c.county_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.state_abbr?.toLowerCase().includes(search.toLowerCase());
      const matchState = stateFilter === "ALL" || c.state_abbr === stateFilter;
      return matchSearch && matchState;
    })
    .sort((a, b) => (a[sortBy] - b[sortBy]) * (sortDir === "desc" ? -1 : 1));

  const tableData   = filteredData.slice(0, showAll ? 100 : 25);
  const hasMore     = filteredData.length > tableData.length;

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };
  const sortArrow = (col) => sortBy === col ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  const topCounties = [...usData].sort((a, b) => b.priority_score - a.priority_score).slice(0, 10);
  const heroMeta    = activeTab === "community" ? COMMUNITY_META : TECHNICAL_META;

  const tabs = [
    { id: "community", label: "🗺  Community View",  desc: "For residents, advocates & planners" },
    { id: "technical", label: "⚙  Technical View",   desc: "For hiring managers & developers"   },
  ];

  return (
    <div className="page">

      {/* ── Hero ── */}
      <header className="hero">
        <div>
          <div className="hero-eyebrow">Public Health Analytics · Business Intelligence Portfolio</div>
          <h1>Where should <span>public health</span><br />dollars go first?</h1>
          <p className="hero-sub">
            This dashboard combines CDC disease data, Census poverty estimates, and USDA food
            access records to rank every US county by combined health risk — giving planners
            a clear, data-driven answer to that question.
          </p>
          <div className="badges">
            {activeTab === "community" ? (
              <>
                <span className="badge">CDC PLACES 2023</span>
                <span className="badge">Census ACS 5-Year</span>
                <span className="badge">USDA Food Access 2019</span>
                <span className="badge">3,100+ Counties</span>
                <span className="badge">Updated Annually</span>
              </>
            ) : (
              <>
                <span className="badge">CDC PLACES 2023</span>
                <span className="badge">Census ACS 5-Year</span>
                <span className="badge">USDA Food Access 2019</span>
                <span className="badge">Live Neon Database</span>
                <span className="badge">Netlify Functions API</span>
              </>
            )}
          </div>
        </div>
        <div className="hero-meta">
          {heroMeta.map(({ label, value }) => (
            <div key={label} className="meta-item">
              <div className="meta-label">{label}</div>
              <div className="meta-value">{value}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── Tab Switcher ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 32, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none", border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #3b82f6" : "2px solid transparent",
              color: activeTab === tab.id ? "#f0f4f8" : "var(--muted)",
              padding: "12px 4px 14px", cursor: "pointer",
              fontSize: 14, fontWeight: activeTab === tab.id ? 600 : 400,
              fontFamily: "inherit", marginBottom: -1, transition: "all 0.15s",
            }}>
            {tab.label}
            <span style={{ display: "block", fontSize: 11, color: "var(--muted2)", fontWeight: 400, marginTop: 2 }}>{tab.desc}</span>
          </button>
        ))}
      </div>

      {/* ── KPI Cards (both tabs) ── */}
      <div className="kpi-grid">
        <KpiCard label="Counties Tracked"   value={countyCount} sub="Across all 50 states + DC"  accent="#3b82f6" loading={loading} />
        <KpiCard label="High Risk Counties" value={highRisk}    sub="Priority score ≥ 50"         accent="#ef4444" loading={loading} />
        <KpiCard label="Avg Priority Score" value={avgScore}    sub="National average (0–100)"    accent="#f97316" loading={loading} />
        <KpiCard label="States Covered"     value={stateCount}  sub="Including DC"                accent="#22c55e" loading={loading} />
      </div>

      {/* ══════════════════════════════════════
          COMMUNITY TAB
      ══════════════════════════════════════ */}
      {activeTab === "community" && (
        <>
          {/* Tier explainer */}
          <div className="card" style={{ marginBottom: 20, background: "rgba(59,130,246,0.04)", borderColor: "rgba(59,130,246,0.15)" }}>
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
                { tier: "HIGH",     color: "#ef4444", range: "Score ≥ 50", desc: "Faces serious challenges across multiple dimensions. These counties should be first in line for outreach, funding, and intervention programs." },
                { tier: "ELEVATED", color: "#f97316", range: "Score 35–49", desc: "Meaningful risk in at least one or two areas. Worth monitoring closely and including in regional planning conversations." },
                { tier: "MODERATE", color: "#eab308", range: "Score 20–34", desc: "Below the national average for combined risk. Some pockets of need may exist but the county is not a priority target." },
                { tier: "LOW",      color: "#22c55e", range: "Score < 20",  desc: "Relatively healthy, economically stable, and food-accessible compared to the rest of the country." },
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

          {/* Map */}
          <div className="card">
            <div className="card-header">
              <div className="card-eyebrow">Geographic Analysis</div>
              <h2>County Risk Map</h2>
              <p className="card-desc">
                Every US county colored by composite priority score. Red = highest need.
                Hover any county to see its full breakdown. Use the metric selector to explore individual dimensions.
              </p>
            </div>
            <div style={{ height: 520 }}>
              <CountyMap countyData={countyData} availableYears={availableYears} onCountyClick={() => {}} />
            </div>
          </div>

          {/* County Explorer + sidebar */}
          <div className="three-col">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header">
                <div className="card-eyebrow">County Explorer</div>
                <h2>Search & Filter Counties</h2>
                <p className="card-desc">
                  {loading ? "Loading..." : `Showing ${tableData.length} of ${filteredData.length.toLocaleString()} counties. Click column headers to sort.`}
                </p>
              </div>
              <div className="table-controls">
                <input className="search-input" placeholder="Search county or state..." value={search} onChange={e => setSearch(e.target.value)} />
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
                      <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--muted2)" }}>Loading county data...</td></tr>
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
              {hasMore && (
                <button onClick={() => setShowAll(true)}
                  style={{ width: "100%", marginTop: 16, padding: "10px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  Show more ({filteredData.length - tableData.length} remaining)
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                        <div className="tier-dist-bar-fill" style={{ width: `${countyCount ? (tierCounts[tier] / countyCount) * 100 : 0}%`, background: cfg.color, opacity: 0.7 }} />
                      </div>
                      <div className="tier-dist-count">{tierCounts[tier].toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 0, flex: 1 }}>
                <div className="card-header">
                  <div className="card-eyebrow">Risk Correlation</div>
                  <h2>Economic vs Health Risk</h2>
                  <p className="card-desc">Each dot is one US county.</p>
                </div>
                <ResponsiveContainer width="100%" height={200}>
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

          {/* Closing message */}
          <div className="card" style={{ textAlign: "center", borderColor: "rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.04)", marginBottom: 20 }}>
            <p style={{ fontSize: 15, color: "var(--text)", marginBottom: 8, fontWeight: 500 }}>
              If this data helped you make a better decision, pointed you somewhere useful, or gave your community a voice it didn't have before — that's exactly why it was built.
            </p>
            <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: 640, margin: "0 auto 20px" }}>
              This dashboard is a starting point, not a final answer. If something here concerns you or your area, these are the right people to contact:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, maxWidth: 700, margin: "0 auto", textAlign: "left" }}>
              <LinkCard name="CDC PLACES"            desc="Health outcomes & chronic disease data"  url="https://www.cdc.gov/places" />
              <LinkCard name="Census Bureau"          desc="Economic & demographic questions"        url="https://www.census.gov/about/contact-us.html" />
              <LinkCard name="USDA ERS"               desc="Food access & rural concerns"            url="https://www.ers.usda.gov/contact-us" />
              <LinkCard name="County Health Rankings" desc="Local health improvement resources"      url="https://www.countyhealthrankings.org" />
              <LinkCard name="HRSA"                   desc="Healthcare access & shortage areas"      url="https://www.hrsa.gov/about/contact" />
              <LinkCard name="Local Health Dept"      desc="Community-level action & programs"       url="https://www.naccho.org/membership/lhd-directory" />
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════
          TECHNICAL TAB
      ══════════════════════════════════════ */}
      {activeTab === "technical" && (
        <>
          {/* Architecture */}
          <div className="card">
            <div className="card-header">
              <div className="card-eyebrow">System Architecture</div>
              <h2>How It's Built</h2>
              <p className="card-desc">A full-stack BI pipeline from raw federal data to live interactive dashboard — built entirely on free-tier infrastructure.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              {[
                { step: "01", label: "Data Ingestion",  color: "#3b82f6", items: ["CDC PLACES national CSV","Census ACS API (51 states)","USDA Food Access Atlas XLSX","Python ETL — pandas + psycopg2","Resumable pipeline with load tracking"] },
                { step: "02", label: "Database Layer",  color: "#8b5cf6", items: ["PostgreSQL 17 on Neon (serverless)","Star schema — dim + fact tables","72,531 food access tracts","50,847 health measure rows","Time-series schema for multi-year"] },
                { step: "03", label: "Scoring Engine",  color: "#f97316", items: ["Scores pre-computed & cached in DB","Min-max normalization via window functions","40% health · 35% economic · 25% food","NULL-safe arithmetic throughout","State & national ranking via RANK()"] },
                { step: "04", label: "API + Frontend",  color: "#22c55e", items: ["Netlify Functions (Node.js + pg)","1hr CDN cache on scores endpoint","React + Vite frontend","Leaflet choropleth map","Auto-deploy from GitHub via Netlify CI"] },
              ].map(({ step, label, color, items }) => (
                <div key={step} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.1em", marginBottom: 6 }}>STEP {step}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 14 }}>{label}</div>
                  <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
                    {items.map(item => (
                      <li key={item} style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 14, position: "relative" }}>
                        <span style={{ position: "absolute", left: 0, color }}>›</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Data Coverage + Scoring */}
          <div className="two-col">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header">
                <div className="card-eyebrow">Data Sources</div>
                <h2>Coverage & Volume</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Dataset</th>
                    <th>Year</th>
                    <th>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { source: "CDC PLACES",  dataset: "County Health Measures",     year: "2023", rows: "50,847" },
                    { source: "Census ACS",  dataset: "5-Year Economic Estimates",  year: "2023", rows: "3,144"  },
                    { source: "USDA ERS",    dataset: "Food Access Atlas (tracts)",  year: "2019", rows: "72,531" },
                  ].map(r => (
                    <tr key={r.source}>
                      <td style={{ fontWeight: 600, color: "var(--text)" }}>{r.source}</td>
                      <td>{r.dataset}</td>
                      <td style={{ color: "var(--muted2)" }}>{r.year}</td>
                      <td style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, color: "#3b82f6" }}>{r.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header">
                <div className="card-eyebrow">Scoring Detail</div>
                <h2>Methodology Breakdown</h2>
              </div>
              {[
                { label: "Health Risk (40%)",                 color: "#3b82f6", measures: "Diabetes, Obesity, Hypertension, CHD, COPD, Cancer, Asthma, Stroke, Poor Mental Health, Poor Physical Health — averaged via CDC crude prevalence rates." },
                { label: "Economic Vulnerability (35%)",       color: "#f97316", measures: "Poverty rate (50% weight) + Uninsured rate (30%) + Median household income inverted (20%) — all from Census ACS 5-Year estimates." },
                { label: "Food Access Burden (25%)",           color: "#22c55e", measures: "Low-income + low-access population as share of county total — aggregated from 72,531 USDA census tracts to county level." },
                { label: "Preventive Care Gap (display only)", color: "#8b5cf6", measures: "Annual checkup, dental, mammography, cervical screening, cholesterol screening rates — inverted so lower care = higher gap score." },
              ].map(({ label, color, measures }) => (
                <div key={label} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14, marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{measures}</div>
                </div>
              ))}
            </div>
          </div>

          {/* SQL + Top Counties */}
          <div className="two-col">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header">
                <div className="card-eyebrow">Technical Portfolio</div>
                <h2>SQL & Analytics Techniques</h2>
              </div>
              <div className="skills-wrap">
                {["Window Functions","CTEs","Min-Max Normalization","Multi-source Joins","Stored Procedures","Materialized Views","Composite Indexing","KPI Modeling","NULL-safe Arithmetic","Serverless API Design","National ETL Pipeline","Time-series Schema","Resumable Pipeline","Star Schema Design"].map(s => (
                  <span key={s} className="skill-tag">{s}</span>
                ))}
              </div>
              <div style={{ marginTop: 24 }}>
                <div className="card-eyebrow" style={{ marginBottom: 12 }}>Key SQL Pattern — Scoring Query</div>
                <pre style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, fontSize: 11, color: "#94a3b8", overflowX: "auto", lineHeight: 1.7 }}>
{`WITH health_outcome AS (
  SELECT county_fips,
    AVG(value)::numeric AS outcome_avg
  FROM fact_health_measures
  WHERE year = 2023
    AND measure_id IN ('DIABETES','OBESITY',...)
  GROUP BY county_fips
),
health_scored AS (
  SELECT county_fips,
    100::numeric
      * (outcome_avg - MIN(outcome_avg) OVER ())
      / NULLIF(MAX(outcome_avg) OVER ()
           - MIN(outcome_avg) OVER (), 0)
    AS health_risk_score
  FROM health_outcome
)
-- + econ_scored, food_scored CTEs...
SELECT d.county_fips,
  COALESCE(hs.health_risk_score, 0)::float,
  COALESCE(es.economic_risk_score, 0)::float,
  COALESCE(fs.food_access_score, 0)::float
FROM dim_county d
LEFT JOIN health_scored hs USING (county_fips)
LEFT JOIN econ_scored   es USING (county_fips)
LEFT JOIN food_scored   fs USING (county_fips)`}
                </pre>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-header">
                <div className="card-eyebrow">Priority Ranking</div>
                <h2>Top 10 Counties by Score</h2>
                <p className="card-desc">Highest composite risk scores nationally — 2023 data.</p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topCounties} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 80 }}>
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#4a5a6a" }} />
                  <YAxis type="category" dataKey="county_name" tick={{ fontSize: 11, fill: "#7a8ba0" }} width={80} />
                  <Tooltip formatter={(val) => [`${val}`, "Priority Score"]}
                    contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="priority_score" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <div style={{ marginTop: 20 }}>
                <div className="card-eyebrow" style={{ marginBottom: 12 }}>API Endpoints</div>
                {[
                  { method: "GET", path: "/.netlify/functions/scores",           desc: "All county scores, latest year" },
                  { method: "GET", path: "/.netlify/functions/scores?year=2023", desc: "Scores for specific year"       },
                  { method: "GET", path: "/.netlify/functions/years",            desc: "Available data years"           },
                ].map(e => (
                  <div key={e.path} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                    <span style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap", marginTop: 1 }}>{e.method}</span>
                    <div>
                      <div style={{ fontSize: 11, fontFamily: "monospace", color: "#94a3b8" }}>{e.path}</div>
                      <div style={{ fontSize: 11, color: "var(--muted2)" }}>{e.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Project Links */}
          <div className="card">
            <div className="card-header">
              <div className="card-eyebrow">Project Links</div>
              <h2>Source & Documentation</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <LinkCard name="GitHub Repository"     desc="Full source code, ETL scripts, SQL"   url="https://github.com/Gelas-Soldat/community-health-intelligence" />
              <LinkCard name="CDC PLACES Data"       desc="Source health outcomes dataset"        url="https://www.cdc.gov/places" />
              <LinkCard name="Census ACS API"        desc="Economic & demographic source"         url="https://www.census.gov/data/developers/data-sets/acs-5year.html" />
              <LinkCard name="USDA Food Atlas"       desc="Food access source data"               url="https://www.ers.usda.gov/data-products/food-access-research-atlas" />
              <LinkCard name="Neon Database"         desc="Serverless Postgres hosting"           url="https://neon.tech" />
              <LinkCard name="Netlify Functions"     desc="Serverless API documentation"          url="https://docs.netlify.com/functions/overview" />
            </div>
          </div>
        </>
      )}

      {/* ── Footer ── */}
      <footer className="footer">
        <p>
          Community Health Intelligence · Built by{" "}
          <a href="https://github.com/Gelas-Soldat" target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>Ryan</a>
          {" "}· Data: CDC PLACES, US Census Bureau, USDA ERS · 2023
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <a href="https://buymeacoffee.com/ryancreates" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFDD00", color: "#000", fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 20, textDecoration: "none" }}>
            ☕ Buy Me a Coffee
          </a>
          <a href="https://ko-fi.com/gelassoldat" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FF5E5B", color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 20, textDecoration: "none" }}>
            ❤️ Ko-fi
          </a>
          <a href="https://github.com/Gelas-Soldat" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#24292e", color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 20, textDecoration: "none" }}>
            ⭐ GitHub
          </a>
        </div>
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "var(--muted2)", lineHeight: 1.8, maxWidth: 720, margin: "24px auto 0" }}>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--muted)" }}>Disclaimer:</strong> This dashboard is for informational purposes only. 
            Data is sourced from CDC PLACES, the US Census Bureau, and the USDA Economic Research Service — all publicly available federal datasets. 
            Scores and rankings are analytical interpretations and should not be used as the sole basis for medical, policy, or funding decisions. 
            Always consult official sources and qualified professionals.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong style={{ color: "var(--muted)" }}>Privacy:</strong> This site uses Simple Analytics, a privacy-first analytics tool. 
            No cookies are set, no personal data is collected, and no data is sold to third parties. 
            Your visit is counted but never tracked.
          </p>
          <p>
            <strong style={{ color: "var(--muted)" }}>Copyright:</strong> © {new Date().getFullYear()} Ryan (Gelas-Soldat). 
            The dashboard design, scoring methodology, and source code are original works licensed under MIT. 
            Underlying data belongs to their respective federal agencies.
          </p>
        </div>
      </footer>

    </div>
  );
}
