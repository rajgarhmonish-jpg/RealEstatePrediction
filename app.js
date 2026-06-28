/* ── app.js — India Housing Demand Forecast Dashboard ───────────────────────
   Loads data_output.json (produced from 4KotakHousingv5.xls via the GBM
   notebook pipeline), then renders an interactive Chart.js dashboard.
   ─────────────────────────────────────────────────────────────────────────── */

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  actual:    "#1d1d1f",
  fit:       "#0071e3",
  test:      "#30b0c7",
  baseline:  "#b0b0b8",
  forecast:  "#ff9500",
  shadeBg:   "rgba(255,149,0,0.04)",
  shadeLine: "rgba(255,149,0,0.30)",
};

// ── Slider metadata ───────────────────────────────────────────────────────────
const SLIDER_META = {
  "weighted_avg_absorbed_units": {
    label: "Weighted Avg Absorbed Price",
    sub:   "City-level weighted avg price per absorbed unit (6.7%)",
    pctMin: -30, pctMax: +30,
    fmt: v => Math.round(v).toLocaleString("en-IN"),
  },
  "Sensex_Growth": {
    label: "Sensex Growth (%)",
    sub:   "BSE Sensex quarterly growth — wealth effect proxy (0.8%)",
    pctMin: -60, pctMax: +60,
    fmt: v => v.toFixed(2) + "%",
  },
  "avg_L4_msf_comm": {
    label: "Avg Office Absorption L4Q (MSF)",
    sub:   "Rolling 4-quarter avg of commercial absorption (0.4%)",
    pctMin: -40, pctMax: +40,
    fmt: v => v.toFixed(3) + " msf",
  },
  "avg_Lag4_msf_comm": {
    label: "Commercial Absorption Lag 4Q (MSF)",
    sub:   "Office leasing 4 quarters ago — leading demand signal (0.3%)",
    pctMin: -40, pctMax: +40,
    fmt: v => v.toFixed(3) + " msf",
  },
  "Repo_Rate": {
    label: "Repo Rate (%)",
    sub:   "RBI Repo Rate — higher rate suppresses demand (0.3%)",
    pctMin: -30, pctMax: +30,
    fmt: v => v.toFixed(2) + "%",
  },
  "wpi_inflation_pct": {
    label: "WPI Inflation (%)",
    sub:   "Wholesale Price Index inflation rate (0.2%)",
    pctMin: -60, pctMax: +60,
    fmt: v => v.toFixed(2) + "%",
  },
  "Affordability Index": {
    label: "Affordability Index",
    sub:   "City affordability index — higher = more affordable (0.2%)",
    pctMin: -30, pctMax: +30,
    fmt: v => v.toFixed(2),
  },
  "msf_commercial_absorption": {
    label: "Commercial Absorption Current Q (MSF)",
    sub:   "Current quarter office space absorbed (0.2%)",
    pctMin: -50, pctMax: +50,
    fmt: v => v.toFixed(3) + " msf",
  },
  "gdp_real_usd_bn": {
    label: "Real GDP (USD bn)",
    sub:   "India real GDP — economy size proxy (0.2%)",
    pctMin: -20, pctMax: +20,
    fmt: v => v.toFixed(1) + " bn",
  },
};

// Sensitivity: 1% change in feature → (weight)% change in forecast
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
let DATA             = null;
let activeCity       = null;
let chart            = null;
let sliderDeltas     = {};   // macro:   { featureKey: pctDelta }
let qtrSliderDeltas  = {};   // quarter: { "Q1-2026": { featureKey: pctDelta } }

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
    initScenarioTabs();
    initResetAll();
    initImportanceDrawer();
    renderImportanceChart();
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
            Serve via a local server:<br>
            <code>python3 -m http.server 8080</code>
          </p>
        </div>
      </div>`;
  });

// ── Feature Importance Chart ──────────────────────────────────────────────────
// Features that are exposed in the scenario controls
const CONTROLLABLE_KEYS = new Set(Object.keys(SLIDER_META));

// Human-readable labels for raw feature names
const FEAT_LABELS = {
  "units_total_absorption":      "Current Quarter Sales (lag)",
  "absorption_roll6":            "6-Quarter Rolling Avg (lag)",
  "weighted_avg_absorbed_units": "Weighted Avg Absorbed Price",
  "absorption_lag1":             "Previous Quarter Sales (lag)",
  "Population":                  "Population",
  "Sensex_Growth":               "Sensex Growth (%)",
  "quarter_sin":                 "Seasonality — Q sin",
  "city_MMR":                    "City: MMR (dummy)",
  "absorption_yoy_growth":       "YoY Sales Growth (lag)",
  "avg_L4_msf_comm":             "Avg Office Absorption L4Q",
  "avg_Lag4_msf_comm":           "Commercial Absorption Lag 4Q",
  "Repo_Rate":                   "Repo Rate (%)",
  "wpi_inflation_pct":           "WPI Inflation (%)",
  "Affordability Index":         "Affordability Index",
  "msf_commercial_absorption":   "Commercial Absorption (current)",
  "gdp_real_usd_bn":             "Real GDP (USD bn)",
};

// Tooltip feature display config: key → { label, unit, fmt }
const TOOLTIP_FEAT_META = {
  "Repo_Rate":                   { label: "Repo Rate",             fmt: v => v.toFixed(2) + "%" },
  "Sensex_Growth":               { label: "Sensex Growth",         fmt: v => (v >= 0 ? "+" : "") + v.toFixed(1) + "%" },
  "gdp_real_usd_bn":             { label: "Real GDP",              fmt: v => "$" + v.toFixed(0) + " bn" },
  "wpi_inflation_pct":           { label: "WPI Inflation",         fmt: v => v.toFixed(1) + "%" },
  "weighted_avg_absorbed_units": { label: "Avg Absorbed Price",    fmt: v => "₹" + Math.round(v).toLocaleString("en-IN") },
  "avg_L4_msf_comm":             { label: "Office Abs L4Q",        fmt: v => v.toFixed(2) + " msf" },
  "avg_Lag4_msf_comm":           { label: "Office Abs Lag4Q",      fmt: v => v.toFixed(2) + " msf" },
  "msf_commercial_absorption":   { label: "Commercial Abs",        fmt: v => v.toFixed(2) + " msf" },
  "Affordability Index":         { label: "Affordability Idx",     fmt: v => v.toFixed(1) },
};


function initImportanceDrawer() {
  const drawer  = document.getElementById("importance-drawer");
  const overlay = document.getElementById("drawer-overlay");
  const btnOpen = document.getElementById("btn-importance");
  const btnClose= document.getElementById("drawer-close");

  function openDrawer() {
    drawer.classList.add("open");
    overlay.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }

  btnOpen.addEventListener("click", openDrawer);
  btnClose.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
}


function renderImportanceChart() {
  const container = document.getElementById("importance-bars");
  if (!container || !DATA?.feature_importances) return;

  container.innerHTML = "";

  const entries   = Object.entries(DATA.feature_importances)
                          .sort((a, b) => b[1] - a[1]);
  const maxVal    = entries[0]?.[1] ?? 1;

  entries.forEach(([key, val]) => {
    const isCtrl  = CONTROLLABLE_KEYS.has(key);
    const type    = isCtrl ? "controllable" : "autoregressive";
    const label   = FEAT_LABELS[key] ?? key;
    const pct     = (val * 100).toFixed(2) + "%";
    const barPct  = ((val / maxVal) * 100).toFixed(1);

    const row = document.createElement("div");
    row.className = "imp-row";
    row.innerHTML = `
      <div class="imp-label" title="${key}">
        <span>${label}</span>
        ${isCtrl ? '<span class="imp-ctrl-badge">Controls ✓</span>' : ""}
      </div>
      <div class="imp-bar-track">
        <div class="imp-bar-fill ${type}" style="width:${barPct}%"></div>
      </div>
      <span class="imp-pct">${pct}</span>
    `;
    container.appendChild(row);
  });
}


function initMetricPills() {
  const m = DATA.metrics;
  document.getElementById("pill-r2").innerHTML   = `R² <strong>${(m.r2*100).toFixed(1)}%</strong>`;
  document.getElementById("pill-mape").innerHTML = `MAPE <strong>${(m.mape*100).toFixed(1)}%</strong>`;
  document.getElementById("pill-rmse").innerHTML = `RMSE <strong>${Math.round(m.rmse).toLocaleString("en-IN")} units</strong>`;
}

// ── City Tabs ─────────────────────────────────────────────────────────────────
function initCityTabs() {
  const container = document.getElementById("city-tabs");
  Object.keys(DATA.cities).forEach(city => {
    const btn = document.createElement("button");
    btn.className = "city-tab";
    btn.textContent = city;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.addEventListener("click", () => selectCity(city));
    container.appendChild(btn);
  });
}

function selectCity(city) {
  activeCity      = city;
  sliderDeltas    = {};
  qtrSliderDeltas = {};

  document.querySelectorAll(".city-tab").forEach(btn => {
    const active = btn.textContent === city;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.getElementById("chart-title").textContent = `${city} — Residential Demand`;
  buildMacroSliders(city);
  buildQuarterAccordion(city);
  renderChart(city);
  renderTable(city);
}

// ── Scenario Tabs ─────────────────────────────────────────────────────────────
function initScenarioTabs() {
  document.getElementById("tab-macro").addEventListener("click", () => switchTab("macro"));
  document.getElementById("tab-quarterly").addEventListener("click", () => switchTab("quarterly"));
}

function switchTab(tab) {
  document.getElementById("tab-macro").classList.toggle("active", tab === "macro");
  document.getElementById("tab-quarterly").classList.toggle("active", tab === "quarterly");
  document.getElementById("panel-macro").classList.toggle("hidden", tab !== "macro");
  document.getElementById("panel-quarterly").classList.toggle("hidden", tab !== "quarterly");
}

// ── Scenario value for a period (macro + quarter-specific contributions) ──────
function computeScenarioValue(period, baseline) {
  let totalImpact = 0;

  // Macro sliders
  for (const [key, pct] of Object.entries(sliderDeltas)) {
    totalImpact += pct * (SENSITIVITY[key] ?? 0);
  }

  // Quarter-specific sliders
  const qDeltas = qtrSliderDeltas[period] ?? {};
  for (const [key, pct] of Object.entries(qDeltas)) {
    totalImpact += pct * (SENSITIVITY[key] ?? 0);
  }

  return Math.round(baseline * (1 + totalImpact / 100));
}

// Macro-only multiplier (used for impact badge display)
function computeMacroMultiplier() {
  let total = 0;
  for (const [key, pct] of Object.entries(sliderDeltas)) {
    total += pct * (SENSITIVITY[key] ?? 0);
  }
  return 1 + total / 100;
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function buildChartData(city) {
  const cd            = DATA.cities[city];
  const futurePeriods = DATA.future_periods;
  const allPeriods    = [...cd.hist_periods, ...futurePeriods];
  const histLen       = cd.hist_periods.length;

  const actualsData          = allPeriods.map((p, i) => i < histLen ? cd.hist_actuals[i] : null);
  const fitData              = allPeriods.map(p => cd.fit_map[p] ?? null);
  const wfData               = allPeriods.map(p => cd.wf_map[p]  ?? null);
  const baselineForecastData = allPeriods.map(p => { const fi = futurePeriods.indexOf(p); return fi >= 0 ? cd.forecast[fi] : null; });
  const scenarioForecastData = allPeriods.map(p => {
    const fi = futurePeriods.indexOf(p);
    if (fi < 0) return null;
    return computeScenarioValue(p, cd.forecast[fi]);
  });

  const firstFcIdx = allPeriods.indexOf(futurePeriods[0]);

  return { allPeriods, futurePeriods, actualsData, fitData, wfData,
           baselineForecastData, scenarioForecastData, firstFcIdx };
}

function renderChart(city) {
  const { allPeriods, futurePeriods, actualsData, fitData, wfData,
          baselineForecastData, scenarioForecastData, firstFcIdx } = buildChartData(city);

  const labels = allPeriods.map(p => p.startsWith("Q1-") ? p.replace("Q1-", "") : "");
  const ctx = document.getElementById("main-chart").getContext("2d");
  if (chart) { chart.destroy(); chart = null; }
  const fcStart = firstFcIdx;

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Historical Actuals", data: actualsData, borderColor: C.actual,   borderWidth: 2,   pointRadius: 0, pointHitRadius: 8, tension: 0.3, fill: false, spanGaps: false, order: 4 },
        { label: "Training Fit",       data: fitData,     borderColor: C.fit,      borderWidth: 1.5, pointRadius: 0, pointHitRadius: 8, tension: 0.3, fill: false, spanGaps: false, order: 3, borderDash: [4,3] },
        { label: "Walk-Forward Test",  data: wfData,      borderColor: C.test,     borderWidth: 2,   pointRadius: 3, pointHitRadius: 8, pointBackgroundColor: C.test, tension: 0.3, fill: false, spanGaps: false, order: 2 },
        { label: "Baseline Forecast",  data: baselineForecastData, borderColor: C.baseline, borderWidth: 1.5, borderDash: [3,3], pointRadius: 0, tension: 0.3, fill: false, spanGaps: false, order: 1 },
        { label: "Scenario Forecast",  data: scenarioForecastData, borderColor: C.forecast, borderWidth: 2.5, pointRadius: 4, pointHitRadius: 10, pointBackgroundColor: C.forecast, tension: 0.3, fill: false, spanGaps: false, order: 0 },
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
          backgroundColor: "rgba(29,29,31,0.94)", titleColor: "#f5f5f7", bodyColor: "#aeaeb2",
          padding: 14, cornerRadius: 10,
          titleFont: { size: 12, weight: "600" }, bodyFont: { size: 12 },
          afterBodyColor: "#6e6e73",
          afterBodyFont: { size: 11 },
          callbacks: {
            title: items => allPeriods[items[0]?.dataIndex] ?? "",
            label: item => item.raw === null ? null
              : ` ${item.dataset.label}: ${Math.round(item.raw).toLocaleString("en-IN")} units`,
            afterBody: items => {
              const period = allPeriods[items[0]?.dataIndex];
              if (!period || !activeCity) return [];
              const cd = DATA.cities[activeCity];
              const feats = cd?.period_features?.[period];
              if (!feats) return [];
              const lines = ["", "── Key Drivers ──────────────"];
              for (const [key, meta] of Object.entries(TOOLTIP_FEAT_META)) {
                if (feats[key] != null) {
                  lines.push(` ${meta.label}: ${meta.fmt(feats[key])}`);
                }
              }
              return lines;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#aeaeb2", font: { size: 11, family: "SF Mono, Menlo, monospace" }, maxRotation: 0, autoSkip: false }, border: { color: "rgba(0,0,0,0.08)" } },
        y: { grid: { color: "rgba(0,0,0,0.05)", drawTicks: false }, ticks: { color: "#aeaeb2", font: { size: 11 }, padding: 8, callback: v => v >= 1000 ? Math.round(v/1000)+"k" : v }, border: { display: false } },
      },
    },
    plugins: [{
      id: "forecastShade",
      beforeDraw(ch) {
        if (fcStart < 0) return;
        const { ctx: c, scales: { x }, chartArea: ca } = ch;
        if (!x || !ca) return;
        const px = x.getPixelForValue(fcStart);
        c.save();
        c.fillStyle = C.shadeBg;
        c.fillRect(px, ca.top, ca.right - px, ca.bottom - ca.top);
        c.strokeStyle = C.shadeLine; c.lineWidth = 1; c.setLineDash([4, 3]);
        c.beginPath(); c.moveTo(px, ca.top); c.lineTo(px, ca.bottom); c.stroke();
        c.setLineDash([]); c.fillStyle = "rgba(255,149,0,0.55)";
        c.font = "600 11px -apple-system, sans-serif";
        c.fillText("Forecast →", px + 6, ca.top + 14);
        c.restore();
      },
    }],
  });
}

// ── Forecast Table ────────────────────────────────────────────────────────────
function renderTable(city) {
  const cd    = DATA.cities[city];
  const fp    = DATA.future_periods;
  const tbody = document.getElementById("forecast-tbody");
  tbody.innerHTML = "";

  fp.forEach((period, i) => {
    const baseline = cd.forecast[i];
    const scenario = computeScenarioValue(period, baseline);
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

// ── Update forecast live ──────────────────────────────────────────────────────
function updateForecast() {
  if (!activeCity || !chart) return;
  const { scenarioForecastData } = buildChartData(activeCity);
  chart.data.datasets[4].data = scenarioForecastData;
  chart.update("none");
  renderTable(activeCity);
  // Refresh any open accordion header values
  refreshAccordionHeaders(activeCity);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function keyToId(key) { return key.replace(/[^a-zA-Z0-9_-]/g, "_"); }

function makeSliders(containerEl, city, period, deltaStore) {
  // period = null for macro (global), or "Q1-2026" for quarter-specific
  const cd = DATA.cities[city];
  containerEl.innerHTML = "";

  Object.entries(SLIDER_META).forEach(([key, meta]) => {
    const defaultVal = cd.macro_defaults[key];
    if (defaultVal === undefined || defaultVal === null || defaultVal === 0) return;

    const ns     = period ? `${keyToId(period)}_${keyToId(key)}` : keyToId(key); // unique namespace
    const prefix = period ? "qs" : "ms"; // quarter-slider vs macro-slider
    const sid    = `${prefix}-${ns}`;

    const minVal = defaultVal * (1 + meta.pctMin / 100);
    const maxVal = defaultVal * (1 + meta.pctMax / 100);
    const step   = (maxVal - minVal) / 200;
    const curVal = defaultVal; // always starts at default

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
        <input type="range" id="slider-${sid}"
               min="${minVal}" max="${maxVal}" step="${step}" value="${curVal}"
               aria-label="${meta.label}" />
        <span class="slider-value" id="val-${sid}">${meta.fmt(curVal)}</span>
      </div>
    `;
    containerEl.appendChild(block);

    block.querySelector(`#slider-${sid}`).addEventListener("input", function () {
      const val      = parseFloat(this.value);
      const pctDelta = ((val - defaultVal) / Math.abs(defaultVal)) * 100;

      // Write into the correct delta store
      if (period) {
        if (!deltaStore[period]) deltaStore[period] = {};
        deltaStore[period][key] = pctDelta;
      } else {
        deltaStore[key] = pctDelta;
      }

      // Value display
      document.getElementById(`val-${sid}`).textContent = meta.fmt(val);

      // Impact badge
      const weight   = SENSITIVITY[key] ?? 0;
      const impact   = pctDelta * weight;
      const impactEl = document.getElementById(`impact-${sid}`);
      if (Math.abs(impact) < 0.05) {
        impactEl.textContent = "Baseline"; impactEl.className = "slider-impact neu";
      } else {
        impactEl.textContent = `${impact > 0 ? "+" : ""}${impact.toFixed(1)}% on forecast`;
        impactEl.className   = `slider-impact ${impact > 0 ? "pos" : "neg"}`;
      }

      updateForecast();
    });
  });
}

// ── Macro Sliders ─────────────────────────────────────────────────────────────
function buildMacroSliders(city) {
  makeSliders(document.getElementById("sliders-grid"), city, null, sliderDeltas);
}

// ── Quarter Accordion ─────────────────────────────────────────────────────────
function buildQuarterAccordion(city) {
  const cd   = DATA.cities[city];
  const fp   = DATA.future_periods;
  const acc  = document.getElementById("qtr-accordion");
  acc.innerHTML = "";
  qtrSliderDeltas = {};

  fp.forEach((period, i) => {
    const baseline = cd.forecast[i];
    const item     = document.createElement("div");
    item.className = "qtr-acc-item";
    item.id        = `qtr-item-${period}`;

    item.innerHTML = `
      <button class="qtr-acc-header" aria-expanded="false">
        <span class="qtr-acc-period">${period}</span>
        <span class="qtr-acc-baseline">Base: ${baseline.toLocaleString("en-IN")}</span>
        <span class="qtr-acc-scenario" id="qacc-val-${period}">${baseline.toLocaleString("en-IN")}</span>
        <span class="qtr-acc-badge neu" id="qacc-badge-${period}">No change</span>
        <span class="qtr-acc-chevron">›</span>
      </button>
      <div class="qtr-acc-body hidden" id="qacc-body-${period}">
        <div class="qtr-acc-sliders" id="qacc-sliders-${period}"></div>
      </div>
    `;
    acc.appendChild(item);

    // Toggle open/close
    item.querySelector(".qtr-acc-header").addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      item.classList.toggle("open", !isOpen);
      item.querySelector(".qtr-acc-header").setAttribute("aria-expanded", !isOpen);
      item.querySelector(`#qacc-body-${period}`).classList.toggle("hidden", isOpen);

      // Lazy-build sliders on first open
      const sliderContainer = document.getElementById(`qacc-sliders-${period}`);
      if (!isOpen && sliderContainer.children.length === 0) {
        makeSliders(sliderContainer, city, period, qtrSliderDeltas);
      }
    });
  });
}

function refreshAccordionHeaders(city) {
  const cd = DATA.cities[city];
  const fp = DATA.future_periods;
  fp.forEach((period, i) => {
    const baseline  = cd.forecast[i];
    const scenario  = computeScenarioValue(period, baseline);
    const delta     = scenario - baseline;
    const pct       = ((delta / baseline) * 100).toFixed(1);
    const sign      = delta >= 0 ? "+" : "";
    const cls       = Math.abs(delta) < 2 ? "neu" : delta > 0 ? "pos" : "neg";
    const valEl     = document.getElementById(`qacc-val-${period}`);
    const badgeEl   = document.getElementById(`qacc-badge-${period}`);
    const itemEl    = document.getElementById(`qtr-item-${period}`);
    if (valEl)   valEl.textContent  = scenario.toLocaleString("en-IN");
    if (badgeEl) {
      const hasQtr = Object.keys(qtrSliderDeltas[period] ?? {}).some(k => (qtrSliderDeltas[period][k] ?? 0) !== 0);
      badgeEl.textContent = Math.abs(delta) < 2 && !hasQtr ? "No change" : `${sign}${pct}%`;
      badgeEl.className   = `qtr-acc-badge ${cls}`;
    }
    if (itemEl) itemEl.classList.toggle("dirty", Math.abs(delta) >= 2);
  });
}

// ── Reset All ─────────────────────────────────────────────────────────────────
function initResetAll() {
  document.getElementById("btn-reset-all").addEventListener("click", () => {
    if (!activeCity) return;
    sliderDeltas    = {};
    qtrSliderDeltas = {};

    // Reset all range inputs on the page (macro + any open quarter accordions)
    document.querySelectorAll("input[type=range]").forEach(el => {
      // Reset to middle (default) by setting value to the midpoint of min/max
      const mid = (parseFloat(el.min) + parseFloat(el.max)) / 2;
      // For our sliders, default is the original feature value which IS the midpoint
      el.value = mid;
    });

    // Rebuild macro sliders fresh (simplest reset approach)
    buildMacroSliders(activeCity);
    buildQuarterAccordion(activeCity);
    updateForecast();
  });
}
