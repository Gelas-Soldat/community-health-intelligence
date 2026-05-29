/**
 * CountyMap.jsx — Choropleth Risk Map
 *
 * Renders all US counties colored by priority score.
 * Supports year selection, metric switching, and click-to-drill-down.
 *
 * Dependencies to add to package.json:
 *   "leaflet": "^1.9.4",
 *   "react-leaflet": "^4.2.1"
 *
 * Install:
 *   npm install leaflet react-leaflet
 *
 * The GeoJSON for US county boundaries is ~8MB. We load it once and cache
 * it in module scope so switching years doesn't re-download it.
 *
 * GeoJSON source (free, public domain):
 *   https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json
 *
 * Props:
 *   countyData   — array of county score objects from your data.js or API
 *   availableYears — array of ints e.g. [2020, 2021, 2022, 2023]
 *   onCountyClick  — callback(countyFips, countyName) for sidebar drilldown
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ---------------------------------------------------------------------------
// Color scale — matches your existing risk tier branding
// ---------------------------------------------------------------------------
const TIER_COLORS = {
  HIGH:     "#c0392b",
  ELEVATED: "#e67e22",
  MODERATE: "#f1c40f",
  LOW:      "#27ae60",
  UNKNOWN:  "#bdc3c7",
};

// Continuous scale from score 0–100
function scoreToColor(score) {
  if (score === null || score === undefined) return TIER_COLORS.UNKNOWN;
  if (score >= 75) return TIER_COLORS.HIGH;
  if (score >= 50) return TIER_COLORS.ELEVATED;
  if (score >= 25) return TIER_COLORS.MODERATE;
  return TIER_COLORS.LOW;
}

// Linear interpolation between two hex colors
function interpolateColor(color1, color2, t) {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);
  const r = Math.round(((c1 >> 16) & 0xff) + t * (((c2 >> 16) & 0xff) - ((c1 >> 16) & 0xff)));
  const g = Math.round(((c1 >>  8) & 0xff) + t * (((c2 >>  8) & 0xff) - ((c1 >>  8) & 0xff)));
  const b = Math.round(( c1        & 0xff) + t * (( c2        & 0xff) - ( c1        & 0xff)));
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

function continuousColor(score) {
  if (score === null || score === undefined) return TIER_COLORS.UNKNOWN;
  const s = Math.max(0, Math.min(100, score));
  if (s >= 75) return interpolateColor(TIER_COLORS.ELEVATED, TIER_COLORS.HIGH,     (s - 75) / 25);
  if (s >= 50) return interpolateColor(TIER_COLORS.MODERATE, TIER_COLORS.ELEVATED, (s - 50) / 25);
  if (s >= 25) return interpolateColor(TIER_COLORS.LOW,      TIER_COLORS.MODERATE, (s - 25) / 25);
  return TIER_COLORS.LOW;
}

// ---------------------------------------------------------------------------
// Metric options
// ---------------------------------------------------------------------------
const METRICS = [
  { key: "priority_score",       label: "Priority Score",      range: [0, 100] },
  { key: "health_risk_score",    label: "Health Risk",         range: [0, 100] },
  { key: "economic_risk_score",  label: "Economic Risk",       range: [0, 100] },
  { key: "food_access_burden",   label: "Food Access Burden",  range: [0, 100] },
  { key: "preventive_care_gap",  label: "Preventive Care Gap", range: [0, 100] },
];

// Trend arrow helper
function trendArrow(delta) {
  if (delta === null || delta === undefined) return "";
  if (delta >  2) return " ▲";
  if (delta < -2) return " ▼";
  return " ●";
}

function trendColor(delta) {
  if (delta === null || delta === undefined) return "#888";
  if (delta >  2) return "#c0392b";
  if (delta < -2) return "#27ae60";
  return "#888";
}

// ---------------------------------------------------------------------------
// GeoJSON county boundary cache
// ---------------------------------------------------------------------------
let geoJsonCache = null;

async function loadCountyGeoJson() {
  if (geoJsonCache) return geoJsonCache;
  const url =
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load county GeoJSON: ${resp.status}`);
  geoJsonCache = await resp.json();
  return geoJsonCache;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function CountyMap({
  countyData       = [],
  availableYears   = [2022],
  onCountyClick    = () => {},
}) {
  const mapRef         = useRef(null);   // Leaflet map instance
  const geoLayerRef    = useRef(null);   // GeoJSON layer
  const containerRef   = useRef(null);   // DOM div

  const [selectedYear,   setSelectedYear]   = useState(availableYears.at(-1));
  const [selectedMetric, setSelectedMetric] = useState(METRICS[0]);
  const [geoJson,        setGeoJson]        = useState(null);
  const [geoError,       setGeoError]       = useState(null);
  const [hoveredCounty,  setHoveredCounty]  = useState(null);
  const [loading,        setLoading]        = useState(true);

  // Build lookup: county_fips → row (for the selected year)
  const dataByFips = useMemo(() => {
    const map = {};
    for (const row of countyData) {
      if (row.data_year === selectedYear) {
        map[row.county_fips] = row;
      }
    }
    return map;
  }, [countyData, selectedYear]);

  // ------------------------------------------------------------------
  // Load GeoJSON once
  // ------------------------------------------------------------------
  useEffect(() => {
    setLoading(true);
    loadCountyGeoJson()
      .then(data => { setGeoJson(data); setLoading(false); })
      .catch(err  => { setGeoError(err.message); setLoading(false); });
  }, []);

  // ------------------------------------------------------------------
  // Initialize Leaflet map once
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, {
      center:          [38.5, -96],
      zoom:            4,
      minZoom:         3,
      maxZoom:         10,
      zoomControl:     true,
      attributionControl: true,
    });
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '© <a href="https://carto.com/">CARTO</a> | ' +
          'County data: CDC, Census, USDA',
        subdomains: "abcd",
        maxZoom:    19,
      }
    ).addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------------
  // Re-render GeoJSON layer whenever data, year, or metric changes
  // ------------------------------------------------------------------
  const getFeatureStyle = useCallback((feature) => {
    const fips = feature.id || feature.properties?.FIPS;
    const row  = dataByFips[fips];
    const val  = row ? row[selectedMetric.key] : null;
    return {
      fillColor:   continuousColor(val),
      weight:       0.4,
      opacity:      0.7,
      color:        "#1a1a2e",
      fillOpacity:  val != null ? 0.82 : 0.2,
    };
  }, [dataByFips, selectedMetric]);

  useEffect(() => {
    if (!mapRef.current || !geoJson) return;

    // Remove old layer
    if (geoLayerRef.current) {
      geoLayerRef.current.removeFrom(mapRef.current);
    }

    geoLayerRef.current = L.geoJSON(geoJson, {
      style: getFeatureStyle,

      onEachFeature: (feature, layer) => {
        const fips  = feature.id || feature.properties?.FIPS;
        const row   = dataByFips[fips];
        const name  = row?.county_name
                        ? `${row.county_name}, ${row.state_abbr}`
                        : feature.properties?.NAME ?? fips;

        layer.on({
          mouseover: (e) => {
            e.target.setStyle({ weight: 2, color: "#fff", fillOpacity: 1 });
            e.target.bringToFront();
            setHoveredCounty(row ? { ...row, displayName: name } : { displayName: name, county_fips: fips });
          },
          mouseout: (e) => {
            geoLayerRef.current?.resetStyle(e.target);
            setHoveredCounty(null);
          },
          click: () => onCountyClick(fips, name),
        });
      },
    }).addTo(mapRef.current);
  }, [geoJson, getFeatureStyle, dataByFips, onCountyClick]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const tooltip = hoveredCounty;

  return (
    <div style={styles.wrapper}>
      {/* Controls bar */}
      <div style={styles.controls}>
        <div style={styles.controlGroup}>
          <label style={styles.controlLabel}>YEAR</label>
          <select
            style={styles.select}
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
          >
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div style={styles.controlGroup}>
          <label style={styles.controlLabel}>METRIC</label>
          <select
            style={styles.select}
            value={selectedMetric.key}
            onChange={e => setSelectedMetric(METRICS.find(m => m.key === e.target.value))}
          >
            {METRICS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>

        <div style={styles.legend}>
          {["LOW", "MODERATE", "ELEVATED", "HIGH"].map(tier => (
            <div key={tier} style={styles.legendItem}>
              <div style={{ ...styles.legendDot, background: TIER_COLORS[tier] }} />
              <span style={styles.legendLabel}>{tier}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Map container */}
      <div style={styles.mapOuter}>
        {loading && (
          <div style={styles.loadingOverlay}>
            <div style={styles.loadingText}>Loading county boundaries…</div>
          </div>
        )}
        {geoError && (
          <div style={styles.errorOverlay}>
            <div style={styles.errorText}>⚠ {geoError}</div>
          </div>
        )}
        <div ref={containerRef} style={styles.map} />

        {/* Hover tooltip */}
        {tooltip && (
          <div style={styles.tooltip}>
            <div style={styles.tooltipName}>{tooltip.displayName}</div>
            {tooltip.priority_score != null && (
              <>
                <div style={styles.tooltipRow}>
                  <span>Priority Score</span>
                  <span style={{ color: continuousColor(tooltip.priority_score), fontWeight: 700 }}>
                    {tooltip.priority_score?.toFixed(1)}
                  </span>
                </div>
                <div style={styles.tooltipRow}>
                  <span>Tier</span>
                  <span style={{ color: TIER_COLORS[tooltip.risk_tier] ?? "#ccc" }}>
                    {tooltip.risk_tier ?? "—"}
                  </span>
                </div>
                {tooltip.priority_score_delta != null && (
                  <div style={{ ...styles.tooltipRow, color: trendColor(tooltip.priority_score_delta) }}>
                    <span>YoY Change</span>
                    <span>{trendArrow(tooltip.priority_score_delta)} {tooltip.priority_score_delta?.toFixed(1)}</span>
                  </div>
                )}
                <div style={styles.tooltipDivider} />
                <div style={styles.tooltipRow}>
                  <span>Health Risk</span>
                  <span>{tooltip.health_risk_score?.toFixed(1) ?? "—"}</span>
                </div>
                <div style={styles.tooltipRow}>
                  <span>Economic Risk</span>
                  <span>{tooltip.economic_risk_score?.toFixed(1) ?? "—"}</span>
                </div>
                <div style={styles.tooltipRow}>
                  <span>Food Burden</span>
                  <span>{tooltip.food_access_burden?.toFixed(1) ?? "—"}</span>
                </div>
                <div style={styles.tooltipFooter}>Click to drill down →</div>
              </>
            )}
            {tooltip.priority_score == null && (
              <div style={styles.tooltipRow}>
                <span style={{ color: "#888" }}>No data for {selectedYear}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Coverage stats */}
      <div style={styles.statsBar}>
        <span>
          {Object.keys(dataByFips).length.toLocaleString()} counties with data
          &nbsp;·&nbsp;
          {Object.values(dataByFips).filter(r => r.risk_tier === "HIGH").length.toLocaleString()} high risk
          &nbsp;·&nbsp;
          Year: {selectedYear}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = {
  wrapper: {
    display:       "flex",
    flexDirection: "column",
    height:        "100%",
    background:    "#0d0f1a",
    fontFamily:    "'IBM Plex Mono', 'Fira Code', monospace",
    color:         "#e0e6f0",
    borderRadius:  "8px",
    overflow:      "hidden",
  },
  controls: {
    display:        "flex",
    alignItems:     "center",
    gap:            "24px",
    padding:        "12px 20px",
    background:     "#131627",
    borderBottom:   "1px solid #1e2340",
    flexWrap:       "wrap",
  },
  controlGroup: {
    display:       "flex",
    flexDirection: "column",
    gap:           "4px",
  },
  controlLabel: {
    fontSize:      "9px",
    letterSpacing: "0.12em",
    color:         "#556080",
    fontWeight:    600,
  },
  select: {
    background:   "#1c2035",
    border:       "1px solid #2a3050",
    color:        "#c0cce8",
    padding:      "5px 10px",
    borderRadius: "4px",
    fontSize:     "12px",
    cursor:       "pointer",
    outline:      "none",
  },
  legend: {
    display:    "flex",
    gap:        "14px",
    marginLeft: "auto",
    alignItems: "center",
  },
  legendItem: {
    display:    "flex",
    alignItems: "center",
    gap:        "5px",
  },
  legendDot: {
    width:        "10px",
    height:       "10px",
    borderRadius: "50%",
  },
  legendLabel: {
    fontSize: "10px",
    color:    "#8899bb",
  },
  mapOuter: {
    flex:     1,
    position: "relative",
    minHeight: "480px",
  },
  map: {
    width:    "100%",
    height:   "100%",
    position: "absolute",
    inset:    0,
  },
  loadingOverlay: {
    position:       "absolute",
    inset:          0,
    background:     "rgba(13,15,26,0.85)",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    zIndex:         1000,
  },
  loadingText: {
    fontSize:   "13px",
    color:      "#667799",
    letterSpacing: "0.08em",
  },
  errorOverlay: {
    position:       "absolute",
    inset:          0,
    background:     "rgba(13,15,26,0.9)",
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    zIndex:         1000,
  },
  errorText: {
    color:    "#c0392b",
    fontSize: "13px",
  },
  tooltip: {
    position:     "absolute",
    bottom:       "24px",
    left:         "20px",
    background:   "rgba(13,15,26,0.95)",
    border:       "1px solid #2a3050",
    borderRadius: "6px",
    padding:      "14px 16px",
    zIndex:       500,
    minWidth:     "200px",
    maxWidth:     "260px",
    backdropFilter: "blur(6px)",
    boxShadow:    "0 4px 24px rgba(0,0,0,0.5)",
  },
  tooltipName: {
    fontSize:      "13px",
    fontWeight:    700,
    color:         "#d4e0f7",
    marginBottom:  "10px",
    letterSpacing: "0.02em",
  },
  tooltipRow: {
    display:         "flex",
    justifyContent:  "space-between",
    fontSize:        "11px",
    color:           "#8899bb",
    marginBottom:    "5px",
    gap:             "16px",
  },
  tooltipDivider: {
    borderTop:   "1px solid #1e2340",
    margin:      "8px 0",
  },
  tooltipFooter: {
    fontSize:     "10px",
    color:        "#445566",
    marginTop:    "8px",
    textAlign:    "right",
    letterSpacing: "0.04em",
  },
  statsBar: {
    padding:    "8px 20px",
    background: "#0a0c16",
    fontSize:   "10px",
    color:      "#334455",
    letterSpacing: "0.06em",
    borderTop:  "1px solid #1a1f35",
  },
};
