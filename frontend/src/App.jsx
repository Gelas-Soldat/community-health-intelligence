import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ScatterChart, Scatter, CartesianGrid } from 'recharts';
import { Activity, Database, MapPinned, TrendingUp } from 'lucide-react';
import { counties, driverData } from './data.js';

export default function App() {
  const [stateFilter, setStateFilter] = useState('All');
  const states = ['All', ...new Set(counties.map((d) => d.state))];
  const filtered = useMemo(() => stateFilter === 'All' ? counties : counties.filter((d) => d.state === stateFilter), [stateFilter]);
  const avgPriority = Math.round(filtered.reduce((sum, d) => sum + d.priority, 0) / filtered.length);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Business Intelligence Portfolio Project</p>
          <h1>Community Health Access Dashboard</h1>
          <p className="lede">A stakeholder focused BI dashboard that identifies counties where health risk, poverty, uninsured rates, and food access barriers overlap.</p>
        </div>
        <div className="heroCard">
          <Database size={28} />
          <strong>PostgreSQL + CDC + Census + USDA</strong>
          <span>Built for county level prioritization and executive reporting.</span>
        </div>
      </section>

      <section className="problem">
        <h2>Business Problem</h2>
        <p>Public health teams need a practical way to decide where limited outreach dollars should go first. This dashboard turns scattered public datasets into a ranked, evidence based county priority list.</p>
      </section>

      <section className="cards">
        <Metric icon={<TrendingUp />} label="Avg Priority Score" value={avgPriority} />
        <Metric icon={<Activity />} label="Critical Counties" value={filtered.filter((d) => d.tier === 'Critical').length} />
        <Metric icon={<MapPinned />} label="States in Scope" value={new Set(filtered.map((d) => d.state)).size} />
      </section>

      <section className="toolbar">
        <label>Filter by state</label>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
          {states.map((s) => <option key={s}>{s}</option>)}
        </select>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Top Counties by Priority Score</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={filtered}>
              <XAxis dataKey="county" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="priority" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h2>Poverty vs Health Risk</h2>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart>
              <CartesianGrid />
              <XAxis dataKey="poverty" name="Poverty" />
              <YAxis dataKey="health" name="Health Risk" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={filtered} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>County Priority Table</h2>
        <table>
          <thead>
            <tr><th>County</th><th>State</th><th>Priority</th><th>Health</th><th>Economic</th><th>Food</th><th>Tier</th></tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.county}-${row.state}`}>
                <td>{row.county}</td><td>{row.state}</td><td>{row.priority}</td><td>{row.health}</td><td>{row.economic}</td><td>{row.food}</td><td><span className="pill">{row.tier}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel note">
        <h2>Analyst Interpretation</h2>
        <p>The counties at the top of the list are not simply places with one bad metric. They show multiple overlapping risk drivers, which makes them stronger candidates for targeted outreach, grant review, and community planning.</p>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }) {
  return <div className="metric"><div>{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}
