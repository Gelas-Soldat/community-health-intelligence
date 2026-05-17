import "./style.css";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ScatterChart,
  Scatter,
  CartesianGrid,
  ResponsiveContainer
} from "recharts";

import { countyData } from "./data";

export default function App() {
  const avgScore = Math.round(
    countyData.reduce((a, b) => a + b.priority, 0) /
      countyData.length
  );

  const criticalCounties = countyData.filter(
    x => x.tier === "Critical"
  ).length;

  const states = [...new Set(countyData.map(x => x.state))];

  return (
    <div className="container">

      <section className="hero">

        <div>

          <div className="eyebrow">
            BUSINESS INTELLIGENCE PORTFOLIO PROJECT
          </div>

          <h1>
            Community Health Access Dashboard
          </h1>

          <p className="hero-text">
            Built to identify counties where health risk,
            economic vulnerability, and access barriers
            overlap, helping public health teams prioritize
            limited intervention resources.
          </p>

          <div className="source-badges">
            <span>CDC PLACES</span>
            <span>Census ACS</span>
            <span>USDA Food Access Atlas</span>
          </div>

        </div>

        <div className="card summary-card">

          <h3>
            PostgreSQL + CDC + Census + USDA
          </h3>

          <p>
            Built for county prioritization,
            executive reporting, and public
            health planning.
          </p>

        </div>

      </section>


      <section className="card">

        <h2>Business Problem</h2>

        <p>
          Public health agencies often operate with limited
          outreach resources and fragmented datasets.
          This dashboard combines health, economic,
          and food access indicators into a ranked
          county prioritization framework.
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

          <p>
            Priority Score calculation:
          </p>

          <ul>
            <li>40% Health Risk</li>
            <li>35% Economic Vulnerability</li>
            <li>25% Food Access Burden</li>
          </ul>

        </div>

      </section>


      <section className="metrics">

        <div className="metric-card">
          <small>High Risk Index</small>
          <h2>{avgScore}</h2>
        </div>

        <div className="metric-card">
          <small>Priority Counties</small>
          <h2>{criticalCounties}</h2>
        </div>

        <div className="metric-card">
          <small>Coverage Area</small>
          <h2>{states.length}</h2>
        </div>

      </section>


      <section className="charts">

        <div className="card">

          <h2>
            Top Counties by Priority Score
          </h2>

          <ResponsiveContainer
            width="100%"
            height={300}
          >
            <BarChart data={countyData}>
              <XAxis dataKey="county"/>
              <YAxis/>
              <Tooltip/>
              <Bar dataKey="priority"/>
            </BarChart>
          </ResponsiveContainer>

        </div>

        <div className="card">

          <h2>
            Poverty vs Health Risk
          </h2>

          <ResponsiveContainer
            width="100%"
            height={300}
          >
            <ScatterChart>
              <CartesianGrid />
              <XAxis dataKey="economic"/>
              <YAxis dataKey="health"/>
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={countyData}/>
            </ScatterChart>
          </ResponsiveContainer>

        </div>

      </section>


      <section className="card">

        <h2>
          SQL Techniques Demonstrated
        </h2>

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

        <h2>
          Analyst Interpretation
        </h2>

        <p>
          Counties with overlapping health,
          economic, and food access risks
          represent stronger candidates for
          targeted outreach, intervention
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