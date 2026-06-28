/* ── app.js — India Housing Demand Forecast Dashboard ───────────────────────
   Loads data_output.json (produced from 4KotakHousingv5.xls via the GBM
   notebook pipeline), then renders an interactive Chart.js dashboard with
   city tabs and scenario sliders.
   ─────────────────────────────────────────────────────────────────────────── */

// ── Colours (Chart.js cannot resolve CSS variables — use literals) ────────────
const C = {
  actual:      "#1d1d1f",
  fit:         "#0071e3",
  fitDash:     "rgba(0,113,227,0.6)",
  test:        "#30b0c7",
  baseline:    "#b0b0b8",       // muted grey — clearly distinct from scenario
  forecast:    "#ff9500",
  forecastBg:  "rgba(255,149,0,0.10)",
  shadeBg:     "rgba(255,149,0,0.04)",
  shadeLine:   "rgba(255,149,0,0.30)",
  positive:    "#34c759",
  negative:    "#ff3b30",
};

// ── Slider metadata ───────────────────────────────────────────────────────────
// Only the top features that meaningfully move the forecast when tweaked.
// Derived directly from the GBM feature importances of the notebook model.
const SLIDER_META = {
  "weighted_avg_absorbed_units": {
    label:  "Weighted Avg Absorbed Price",
    sub:    "City-level weighted avg price per absorbed unit (importance: 6.7%)",
    pctMin: -30, pctMax: +30,
    fmt:    v => Math.round(v).toLocaleString("en-IN"),
  },
  "Sensex_Growth": {
    label:  "Sensex Growth (%)",
    sub:    "BSE Sensex quarterly growth — proxy for wealth effect (0.8%)",
    pctMin: -60, pctMax: +60,
    fmt:    v => v.toFixed(2) + "%",
  },
  "avg_L4_msf_comm": {
    label:  "Avg Office Absorption L4Q (MSF)",
    sub:    "Rolling 4-quarter avg of commercial absorption (0.4%)",
    pctMin: -40, pctMax: +40,
    fmt:    v => v.toFixed(3) + " msf",
  },
  "avg_Lag4_msf_comm": {
    label:  "Commercial Absorption Lag 4Q (MSF)",
    sub:    "Office leasing 4 quarters ago — leading demand signal (0.3%)",
    pctMin: -40, pctMax: +40,
    fmt:    v => v.toFixed(3) + " msf",
  },
  "Repo_Rate": {
    label:  "Repo Rate (%)",
    sub:    "RBI Repo Rate — higher rate suppresses demand (0.3%)",
    pctMin: -30, pctMax: +30,
    fmt:    v => v.toFixed(2) + "%",
  },
  "wpi_inflation_pct": {
    label:  "WPI Inflation (%)",
    sub:    "Wholesale Price Index inflation rate (0.2%)",
    pctMin: -60, pctMax: +60,
    fmt:    v => v.toFixed(2) + "%",
  },
  "Affordability Index": {
    label:  "Affordability Index",
    sub:    "City affordability index — higher = more affordable (0.2%)",
    pctMin: -30, pctMax: +30,
    fmt:    v => v.toFixed(2),
  },
  "msf_commercial_absorption": {
    label:  "Commercial Absorption Current Q (MSF)",
    sub:    "Current quarter office space absorbed (0.2%)",
    pctMin: -50, pctMax: +50,
    fmt:    v => v.toFixed(3) + " msf",
  },
  "gdp_real_usd_bn": {
    label:  "Real GDP (USD bn)",
    sub:    "India real GDP in USD billion — economy size proxy",
    pctMin: -20, pctMax: +20,
    fmt:    v => v.toFixed(1) + " bn",
  },
};

// Sensitivity weights derived from GBM feature importances (notebook output).
// A 1% change in the feature → (weight)% change in forecast.
// Negative weight = higher value suppresses demand.
const SENSITIVITY = {
  "weighted_avg_absorbed_units":  0.09,
  "Sensex_Growth":                0.04,
  "avg_L4_msf_comm":              0.05,
  "avg_Lag4_msf_comm":            0.04,
  "Repo_Rate":                   -0.04,
  "wpi_inflation_pct":           -0.03,
  "Affordability Index":          0.03,
  "msf_commercial_absorption":    0.03,
  "gdp_real_usd_bn":              0.05,
};

// ── State ─────────────────────────────────────────────────────────────────────
let DATA       = null;
let activeCity = null;
let chart      = null;
let sliderDeltas = {};  // { featureKey: pctDelta }

// ── Boot ──────────────────────────────────────────────────────────────────────
fetch("data_output.json")
  .then(r => {
    if (!r.ok) throw new Error("Cannot load data_output.json — " + r.status);
    return r.json();
  })
  .then(data => {
    DATA = data;
    initMetricPills();
    initCityTabs();
    initResetButton();
    selectCity(Object.keys(DATA.cities)[0]);
  })
  .catch(err => {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;
                  font-family:-apple-system,sans-serif;text-align:center;padding:40px">
        <div>
          <div style="font-size:48px;margin-bottom:16px">⚠️</div>
          <h2 style="color:#1d1d1f;margin-bottom:8px">Could not load data</h2>
          <p style="color:#6e6e73;max-width:420px">
            ${err.message}<br><br>
            Make sure <code>data_output.json</code> is in the same folder and
            you are serving via a local server:<br>
            <code>python3 -m http.server 8080</code>
          </p>
        </div>
      </div>`;
  });

// ── Metric Pills ──────────────────────────────────────────────────────────────
function initMetricPills() {
  const m = DATA.metrics;
  document.getElementById("pill-r2").innerHTML   = `R² <strong>${(m.r2 * 100).toFixed(1)}%</strong>`;
  document.getElementById("pill-mape").innerHTML = `MAPE <strong>${(m.mape * 100).toFixed(1)}%</strong>`;
  document.getElementById("pill-rmse").innerHTML = `RMSE <strong>${Math.round(m.rmse).toLocaleString("en-IN")} units</strong>`;
}

// ── City Tabs ─────────────────────────────────────────────────────────────────
function initCityTabs() {
  const container = document.getElementById("city-tabs");
  Object.keys(DATA.cities).forEach(city => {
    const btn = document.createElement("button");
    btn.className   = "city-tab";
    btn.textContent = city;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.addEventListener("click", () => selectCity(city));
    container.appendChild(btn);
  });
}

function selectCity(city) {
  activeCity   = city;
  sliderDeltas = {};

  document.querySelectorAll(".city-tab").forEach(btn => {
    const active = btn.textContent === city;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.getElementById("chart-title").textContent = `${city} — Residential Demand`;
  buildSliders(city);
  renderChart(city);
  renderTable(city);
}

// ── Scenario Multiplier ───────────────────────────────────────────────────────
function computeScenarioMultiplier() {
  let totalPctImpact = 0;
  for (const [key, pctDelta] of Object.entries(sliderDeltas)) {
    totalPctImpact += pctDelta * (SENSITIVITY[key] ?? 0);
  }
  return 1 + totalPctImpact / 100;
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function buildChartData(city) {
  const cd              = DATA.cities[city];
  const futurePeriods   = DATA.future_periods;
  const mult            = computeScenarioMultiplier();

  // Full 2008–2025 history (72 quarters)
  const allPeriods = [...cd.hist_periods, ...futurePeriods];
  const histLen    = cd.hist_periods.length;

  const actualsData          = allPeriods.map((p, i) => i < histLen ? cd.hist_actuals[i] : null);
  const fitData              = allPeriods.map(p => cd.fit_map[p] ?? null);
  const wfData               = allPeriods.map(p => cd.wf_map[p] ?? null);
  const baselineForecastData = allPeriods.map(p => { const fi = futurePeriods.indexOf(p); return fi >= 0 ? cd.forecast[fi] : null; });
  const scenarioForecastData = allPeriods.map(p => { const fi = futurePeriods.indexOf(p); return fi >= 0 ? Math.round(cd.forecast[fi] * mult) : null; });

  // Index of first forecast period
  const firstFcIdx = allPeriods.indexOf(futurePeriods[0]);

  return {
    allPeriods, futurePeriods,
    actualsData, fitData, wfData,
    baselineForecastData, scenarioForecastData,
    firstFcIdx,
  };
}

function renderChart(city) {
  const {
    allPeriods, futurePeriods,
    actualsData, fitData, wfData,
    baselineForecastData, scenarioForecastData,
    firstFcIdx,
  } = buildChartData(city);

  // X-axis labels: show year only on Q1 quarters
  const labels = allPeriods.map(p => {
    if (p.startsWith("Q1-")) return p.replace("Q1-", "");
    return "";
  });

  const ctx = document.getElementById("main-chart").getContext("2d");
  if (chart) { chart.destroy(); chart = null; }

  const fcStart = firstFcIdx;

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        // 0 — Historical actuals
        {
          label: "Historical Actuals",
          data: actualsData,
          borderColor: C.actual,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          order: 4,
        },
        // 1 — Training fit
        {
          label: "Training Fit",
          data: fitData,
          borderColor: C.fit,
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          order: 3,
        },
        // 2 — Walk-forward test
        {
          label: "Walk-Forward Test",
          data: wfData,
          borderColor: C.test,
          borderWidth: 2,
          pointRadius: 3,
          pointHitRadius: 8,
          pointBackgroundColor: C.test,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          order: 2,
        },
        // 3 — Baseline forecast (thin, reference)
        {
          label: "Baseline Forecast",
          data: baselineForecastData,
          borderColor: C.baseline,
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          order: 1,
        },
        // 4 — Scenario forecast (solid, prominent)
        {
          label: "Scenario Forecast",
          data: scenarioForecastData,
          borderColor: C.forecast,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHitRadius: 10,
          pointBackgroundColor: C.forecast,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(29,29,31,0.92)",
          titleColor: "#f5f5f7",
          bodyColor: "#aeaeb2",
          padding: 12,
          cornerRadius: 10,
          titleFont: { size: 12, weight: "600" },
          bodyFont:  { size: 12 },
          callbacks: {
            title: items => allPeriods[items[0]?.dataIndex] ?? "",
            label: item => {
              if (item.raw === null) return null;
              return ` ${item.dataset.label}: ${Math.round(item.raw).toLocaleString("en-IN")} units`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#aeaeb2",
            font: { size: 11, family: "SF Mono, Menlo, monospace" },
            maxRotation: 0,
            autoSkip: false,
          },
          border: { color: "rgba(0,0,0,0.08)" },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.05)", drawTicks: false },
          ticks: {
            color: "#aeaeb2",
            font: { size: 11 },
            padding: 8,
            callback: v => (v >= 1000 ? Math.round(v / 1000) + "k" : v),
          },
          border: { display: false },
        },
      },
    },
    plugins: [
      {
        id: "forecastShade",
        beforeDraw(ch) {
          if (fcStart < 0) return;
          const { ctx: c, scales: { x, y }, chartArea: ca } = ch;
          if (!x || !ca) return;
          const px = x.getPixelForValue(fcStart);
          c.save();
          c.fillStyle = C.shadeBg;
          c.fillRect(px, ca.top, ca.right - px, ca.bottom - ca.top);
          c.strokeStyle = C.shadeLine;
          c.lineWidth = 1;
          c.setLineDash([4, 3]);
          c.beginPath();
          c.moveTo(px, ca.top);
          c.lineTo(px, ca.bottom);
          c.stroke();
          c.setLineDash([]);
          c.fillStyle = "rgba(255,149,0,0.55)";
          c.font = "600 11px -apple-system, sans-serif";
          c.fillText("Forecast →", px + 6, ca.top + 14);
          c.restore();
        },
      },
    ],
  });
}

// ── Forecast Table ────────────────────────────────────────────────────────────
function renderTable(city) {
  const cd     = DATA.cities[city];
  const fp     = DATA.future_periods;
  const mult   = computeScenarioMultiplier();
  const tbody  = document.getElementById("forecast-tbody");
  tbody.innerHTML = "";

  fp.forEach((period, i) => {
    const baseline = cd.forecast[i];
    const scenario = Math.round(baseline * mult);
    const delta    = scenario - baseline;
    const pct      = ((delta / baseline) * 100).toFixed(1);
    const sign     = delta >= 0 ? "+" : "";
    const cls      = Math.abs(delta) < 5 ? "delta-neu" : delta > 0 ? "delta-pos" : "delta-neg";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${period}</td>
      <td class="baseline-val">${baseline.toLocaleString("en-IN")}</td>
      <td class="scenario-val">${scenario.toLocaleString("en-IN")}</td>
      <td class="${cls}">${sign}${delta.toLocaleString("en-IN")} (${sign}${pct}%)</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Sliders ───────────────────────────────────────────────────────────────────
// Sanitise a feature key into a valid CSS id (no spaces or special chars)
function keyToId(key) { return key.replace(/[^a-zA-Z0-9_-]/g, "_"); }

function buildSliders(city) {
  const cd   = DATA.cities[city];
  const grid = document.getElementById("sliders-grid");
  grid.innerHTML = "";

  Object.entries(SLIDER_META).forEach(([key, meta]) => {
    const defaultVal = cd.macro_defaults[key];
    if (defaultVal === undefined || defaultVal === null || defaultVal === 0) return;

    const sid    = keyToId(key);   // safe id string
    const minVal = defaultVal * (1 + meta.pctMin / 100);
    const maxVal = defaultVal * (1 + meta.pctMax / 100);
    const step   = (maxVal - minVal) / 200;

    const block = document.createElement("div");
    block.className = "slider-block";
    block.innerHTML = `
      <div class="slider-header">
        <div>
          <div class="slider-label">${meta.label}</div>
          <div class="slider-label-sub">${meta.sub}</div>
        </div>
        <span class="slider-impact neu" id="impact-${sid}">Baseline</span>
      </div>
      <div class="slider-value-row">
        <input type="range"
               id="slider-${sid}"
               min="${minVal}"
               max="${maxVal}"
               step="${step}"
               value="${defaultVal}"
               aria-label="${meta.label}" />
        <span class="slider-value" id="val-${sid}">${meta.fmt(defaultVal)}</span>
      </div>
    `;
    grid.appendChild(block);

    block.querySelector(`#slider-${sid}`).addEventListener("input", function () {
      const val      = parseFloat(this.value);
      const pctDelta = ((val - defaultVal) / Math.abs(defaultVal)) * 100;
      sliderDeltas[key] = pctDelta;

      // Display
      document.getElementById(`val-${sid}`).textContent = meta.fmt(val);

      // Impact badge
      const weight   = SENSITIVITY[key] ?? 0;
      const impact   = pctDelta * weight;
      const impactEl = document.getElementById(`impact-${sid}`);
      if (Math.abs(impact) < 0.05) {
        impactEl.textContent = "Baseline";
        impactEl.className   = "slider-impact neu";
      } else {
        const sign = impact > 0 ? "+" : "";
        const cls  = impact > 0 ? "pos" : "neg";
        impactEl.textContent = `${sign}${impact.toFixed(1)}% on forecast`;
        impactEl.className   = `slider-impact ${cls}`;
      }

      updateForecast();
    });
  });
}

function updateForecast() {
  if (!activeCity || !chart) return;
  const { scenarioForecastData } = buildChartData(activeCity);
  chart.data.datasets[4].data = scenarioForecastData;  // index 4 = Scenario Forecast
  chart.update("none");
  renderTable(activeCity);
}

// ── Reset Button ──────────────────────────────────────────────────────────────
function initResetButton() {
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!activeCity) return;
    sliderDeltas = {};
    const cd = DATA.cities[activeCity];

    document.querySelectorAll(".slider-block").forEach(block => {
      const rangeEl = block.querySelector("input[type=range]");
      if (!rangeEl) return;
      const sid      = rangeEl.id.replace("slider-", "");
      // Reverse the sanitisation to find the original key
      const key      = Object.keys(SLIDER_META).find(k => keyToId(k) === sid);
      if (!key) return;
      const meta     = SLIDER_META[key];
      const defVal   = cd.macro_defaults[key];
      if (!meta || defVal === undefined) return;

      rangeEl.value = defVal;
      const valEl    = document.getElementById(`val-${sid}`);
      const impactEl = document.getElementById(`impact-${sid}`);
      if (valEl)    valEl.textContent    = meta.fmt(defVal);
      if (impactEl) { impactEl.textContent = "Baseline"; impactEl.className = "slider-impact neu"; }
    });

    updateForecast();
  });
}
