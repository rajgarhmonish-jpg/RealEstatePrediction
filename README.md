# India Residential Demand Forecast Dashboard

**Macro-Regional GBM Pipeline · 2026–2028**

An institutional-grade, fully static web dashboard for visualising residential housing demand forecasts across India's 7 top metropolitan markets. Built from `4KotakHousingv5.xls` using a Gradient Boosting (GBM) 1-step-ahead recursive forecasting engine.

---

## Live Demo

> Hosted on GitHub Pages — no backend required.

---

## Features

| Feature | Description |
|---------|-------------|
| **Three-zone chart** | Historical actuals · Training fit (in-sample) · Walk-forward test (2023–2025) · 3-year forecast (2026–2028) |
| **City tabs** | Bengaluru · Chennai · Hyderabad · Kolkata · MMR · NCR · Pune |
| **Scenario controls** | Live sliders for the 7 most impactful tweakable features |
| **Forecast table** | Quarterly baseline vs. scenario, with Δ units and Δ% |
| **Model metrics** | R² · MAPE · RMSE from walk-forward validation |

---

## Model Performance

| Metric | Value |
|--------|-------|
| Walk-forward R² | **93.7%** |
| MAPE | **12.0%** |
| RMSE | **~3,000 units** |

---

## Files

```
housing-forecast-dashboard/
├── index.html          ← Dashboard shell
├── style.css           ← Apple-level design system
├── app.js              ← Chart.js logic + scenario engine
├── data_output.json    ← Pre-computed model outputs (from 4KotakHousingv5.xls)
└── README.md           ← This file
```

---

## Hosting on GitHub Pages

### Option A — Deploy from repository root

1. Push this folder (or its contents) to a GitHub repository.
2. Go to **Settings → Pages → Source → Deploy from a branch**.
3. Select `main` branch, `/ (root)` folder → **Save**.
4. Your dashboard will be live at `https://<username>.github.io/<repo>/`.

### Option B — Deploy from `/docs` subfolder

1. Rename this folder to `docs` and place it at the root of your repo.
2. Go to **Settings → Pages → Source → Deploy from a branch**.
3. Select `main` branch, `/docs` folder → **Save**.

### Option C — GitHub Actions (recommended for CI)

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: housing-forecast-dashboard
      - uses: actions/deploy-pages@v4
```

---

## Running Locally

```bash
cd housing-forecast-dashboard
python3 -m http.server 8080
# Open http://localhost:8080
```

> **Note:** The dashboard must be served via HTTP (not opened as a local file) because it fetches `data_output.json` via `fetch()`.

---

## Regenerating `data_output.json`

If you update the source Excel file, re-run the Python pipeline from `16v3_Final.ipynb` or the extraction script. The JSON includes:

- Per-city historical actuals (Q1-2008 → Q4-2025)
- Training fit predictions (in-sample, pre-2023)
- Walk-forward test predictions (2023–2025)
- 12-quarter recursive forecast (Q1-2026 → Q4-2028)
- Macro feature defaults for each city (last known values)
- Global model metrics

---

## Data Source

**4KotakHousingv5.xls** — 504 quarterly observations across 7 Indian cities (2008–2025). Features include GDP Growth Rate, Repo Rate, Sensex Growth, WPI, IIP, Crude Oil Price, commercial absorption, residential supply/demand metrics, and population.

---

*Prepared for Real Estate Investment & Fund Management Review.*
