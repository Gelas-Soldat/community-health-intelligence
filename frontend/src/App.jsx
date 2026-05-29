import { useState, useEffect } from "react";
import "./style.css";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ScatterChart, Scatter, CartesianGrid, ResponsiveContainer
} from "recharts";

import { fetchScores, fetchYears, countyData as fallbackData } from "./data";
import CountyMap from "./components/CountyMap";

export default function App() {
  const [countyData,     setCountyData]     = useState(fallbackData);
  const [availableYears, setAvailableYears] = useState([2023]);
  const [selectedYear,   setSelectedYear]   = useState(2023);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);

  // Load available years on mount
  useEffect(() => {
    fetchYears()
      .then(years => {
        setAvailableYears(years);
        setSelectedYear(years.at(-1));
      })
      .catch(err => {
        console.warn("Could not fetch years, using fallback:", err.message);
      });
  }, []);

  // Load county scores whenever year changes
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchScores(selectedYear)
      .then(data => {
        setCountyData(data);
        setLoading(false);
      })
      .catch(err => {
        console.warn("Could not fetch scores, using fallback:", err.message);
        setError(err.message);
        setLoading(false);
      });
  }, [selectedYear]);

  // KPI calculations
  const avgScore = countyData.length
    ? Math.round(countyData.reduce((a, b) => a + b.priority_score, 0) / countyData.length)
    : 0;

  const highRiskCounties = countyData.filter(x => x.risk_tier === "HIGH").length;
  const states = [...new Set(countyData.map(x => x.state_abbr))].length;

  // Top 10 counties for bar chart
  const topCounties = [...countyData]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 10);

  return (
    <div className="container">

      <section className="hero">
        <div>
          <div className="eyebrow">BUSINESS INTELLIGENCE PORTFOLIO PROJECT</div>
          <h1>Community Health Access Dashboard</h1>
          <p className="hero-text">
            Built to identify counties where health risk, economic vulnerability,
            and access barriers overlap, helping public health teams prioritize
            limited intervention resources.
          </p>
          <div className="source-badges">
            <span>CDC PLACES</span>
            <span>Census ACS</span>
            <span>USDA Food Access Atlas</span>
          </div>
        </div>

        <div className="card summary-card">
          <h3>PostgreSQL + CDC + Census + USDA</h3>
          <p>Built for county prioritization, executive reporting, and public health planning.</p>
        </div>
      </section>

      <section className="card">
        <h2>Business Problem</h2>
        <p>
          Public health agencies often operate with limited outreach resources
          and fragmented datasets. This dashboard combines health, economic,
          and food access indicators into a ranked county prioritization framework.
        </p>
      </section>

      <section className="stakeholders">
        <div className="card">
          <h3>Primary Stakeholders</h3>
          <ul>
            <li>Public Health Agencies</li>
            <li>County Leadership Teams</li>
            <li>Policy Analysts</li>
            <li>Community Outreach Teams</li>
          </ul>
        </div>

        <div className="card">
          <h3>Scoring Methodology</h3>
          <p>Priority Score calculation:</p>
          <ul>
            <li>40% Health Risk</li>
            <li>35% Economic Vulnerability</li>
            <li>25% Food Access Burden</li>
          </ul>
        </div>
      </section>

      <section className="metrics">
        <div className="metric-card">
          <small>Avg Priority Score</small>
          <h2>{loading ? "—" : avgScore}</h2>
        </div>
        <div className="metric-card">
          <small>High Risk Counties</small>
          <h2>{loading ? "—" : highRiskCounties.toLocaleString()}</h2>
        </div>
        <div className="metric-card">
          <small>States Covered</small>
          <h2>{loading ? "—" : states}</h2>
        </div>
      </section>

      {error && (
        <div className="card" style={{ color: "#c0392b", fontSize: "13px" }}>
          ⚠ API error: {error}. Showing fallback data.
        </div>
      )}

      <section className="card">
        <h2>County Risk Map</h2>
        <div style={{ height: "600px" }}>
          <CountyMap
            countyData={countyData}
            availableYears={availableYears}
            onCountyClick={(fips, name) => console.log("Selected:", fips, name)}
          />
        </div>
      </section>

      <section className="charts">
        <div className="card">
          <h2>Top 10 Counties by Priority Score</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCounties}>
              <XAxis dataKey="county_name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip
                formatter={(val, name) => [val, "Priority Score"]}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="priority_score" fill="#c0392b" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Poverty vs Health Risk</h2>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart>
              <CartesianGrid />
              <XAxis
                dataKey="economic_risk_score"
                name="Economic Risk"
                label={{ value: "Economic Risk", position: "insideBottom", offset: -5 }}
              />
              <YAxis
                dataKey="health_risk_score"
                name="Health Risk"
                label={{ value: "Health Risk", angle: -90, position: "insideLeft" }}
              />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={countyData} fill="#e67e22" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card">
        <h2>SQL Techniques Demonstrated</h2>
        <div className="skills-grid">
          <span>Complex Joins</span>
          <span>CTEs</span>
          <span>Window Functions</span>
          <span>Views</span>
          <span>Indexes</span>
          <span>Subqueries</span>
          <span>Performance Optimization</span>
          <span>KPI Modeling</span>
        </div>
      </section>

      <section className="card">
        <h2>Analyst Interpretation</h2>
        <p>
          Counties with overlapping health, economic, and food access risks
          represent stronger candidates for targeted outreach, intervention
          planning, and funding prioritization.
        </p>
      </section>

      <footer className="footer">
        <p>
          Built by Ryan as a Business Intelligence portfolio project using
          SQL, public datasets, and dashboard reporting.
        </p>
      </footer>

    </div>
  );
}
