import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import zipfile
import xml.etree.ElementTree as ET
import re
import pickle
import warnings
warnings.filterwarnings('ignore')

st.set_page_config(page_title="Kotak Housing Analytics", layout="wide")

def col_letter_to_idx(col):
    idx = 0
    for c in col: idx = idx * 26 + (ord(c.upper()) - ord('A') + 1)
    return idx - 1

def period_key(p):
    try:
        q, yr = str(p).split('-')
        return int(yr) * 4 + int(q[1])
    except: return 0

def next_period(p):
    q, yr = str(p).split('-')
    q_num, yr_num = int(q[1]), int(yr)
    q_num += 1
    if q_num > 4: q_num, yr_num = 1, yr_num + 1
    return f'Q{q_num}-{yr_num}'

def extrapolate_linear(series, n_steps):
    x = np.arange(len(series))
    if len(series) >= 3:
        slope, intercept = np.polyfit(x, series, 1)
        fut_x = np.arange(len(series), len(series) + n_steps)
        projected = intercept + slope * fut_x
        last = series[-1]
        return np.clip(projected, last * 0.50, last * 1.50).tolist()
    return [series[-1]] * n_steps

@st.cache_resource
def load_model():
    with open('kotak_master_model.pkl', 'rb') as f:
        return pickle.load(f)

@st.cache_data
def load_data():
    df_hist_fit = pd.read_csv('kotak_historical_fit.csv')
    df_hist_fit['_sort'] = df_hist_fit['period'].map(period_key)
    df_hist_fit = df_hist_fit.dropna(subset=['period']).sort_values(['city', '_sort'])
    
    df_fc_base = pd.read_csv('kotak_forecast_2026_2028.csv')
    df_fc_base['_sort'] = df_fc_base['Period'].map(period_key)
    df_fc_base = df_fc_base.sort_values(['City', '_sort'])
    
    with zipfile.ZipFile('4KotakHousingv3.xlsx') as z:
        ss_xml = z.read('xl/sharedStrings.xml')
        ss_root = ET.fromstring(ss_xml)
        ns_ss = 'http://purl.oclc.org/ooxml/spreadsheetml/main'
        shared_strings = [''.join((t.text or '') for t in si.findall(f'.//{{{ns_ss}}}t')) for si in ss_root.findall(f'{{{ns_ss}}}si')]
        raw = z.read('xl/worksheets/sheet1.xml')
        root_el = ET.fromstring(raw)
        ns_ws = re.match(r'\{(.*?)\}', root_el.tag).group(1)
        
        rows_out = []
        for row_el in root_el.findall(f'.//{{{ns_ws}}}row'):
            row_data = {}
            for cell in row_el.findall(f'{{{ns_ws}}}c'):
                ref = cell.get('r', '')
                col_match = re.match(r'([A-Z]+)', ref)
                if col_match:
                    col_idx = col_letter_to_idx(col_match.group(1))
                    t = cell.get('t', '')
                    v_el = cell.find(f'{{{ns_ws}}}v')
                    val = None
                    if v_el is not None and v_el.text is not None:
                        if t == 's': val = shared_strings[int(v_el.text)]
                        elif t == 'str': val = v_el.text
                        else:
                            try: val = float(v_el.text)
                            except: val = v_el.text
                    row_data[col_idx] = val
            rows_out.append(row_data)

    CITY=1; PERIOD=2; REPO=4; SENSEX=5; POP=6; UNITS_ABS=13; MSF_COMM=24
    GDP_REAL=27; GDP_REAL_YOY=30; WPI_PCT=31; IIP_YOY=33; CRUDE_YOY=35
    
    parsed_data = []
    for rd in rows_out[1:]:
        if rd.get(CITY) and rd.get(PERIOD):
            parsed_data.append({
                'city': rd.get(CITY), 'period': rd.get(PERIOD),
                'units_total_absorption': float(rd.get(UNITS_ABS) or 0),
                'msf_commercial_absorption': float(rd.get(MSF_COMM) or 0),
                'Repo_Rate': float(rd.get(REPO) or 0),
                'Population': float(rd.get(POP) or 0),
                'gdp_real_usd_bn': float(rd.get(GDP_REAL) or 0),
                'gdp_real_yoy_pct': float(rd.get(GDP_REAL_YOY) or 0),
                'wpi_inflation_pct': float(rd.get(WPI_PCT) or 0),
                'iip_yoy_pct': float(rd.get(IIP_YOY) or 0),
                'crude_yoy_pct': float(rd.get(CRUDE_YOY) or 0),
                'Sensex_Growth': float(rd.get(SENSEX) or 0)
            })
            
    df_raw = pd.DataFrame(parsed_data)
    df_raw['_sort'] = df_raw['period'].map(period_key)
    df_raw = df_raw.sort_values(['city', '_sort']).reset_index(drop=True)
    df_raw['time_index'] = df_raw.groupby('city').cumcount()
    return df_hist_fit, df_fc_base, df_raw

try:
    model_data = load_model()
    df_hist_fit, df_fc_base, df_raw = load_data()
except Exception as e:
    st.error(f"Error loading data: {e}")
    st.stop()

st.title("📈 Kotak Housing Analytics — Forecast Dashboard")
st.markdown("Visualizing the master ML pipeline with interactive Scenario Planning.")

cities = df_hist_fit['city'].unique().tolist()
selected_city = st.sidebar.selectbox("🌆 Select City", cities)

city_hist_fit = df_hist_fit[df_hist_fit['city'] == selected_city].copy()
city_fc_base = df_fc_base[df_fc_base['City'] == selected_city].copy()
city_raw = df_raw[df_raw['city'] == selected_city].copy()

# ── LOGIC SETUP ──────────────────────────────────────
macro_cols_to_edit = ['Repo_Rate', 'gdp_real_yoy_pct', 'msf_commercial_absorption', 'wpi_inflation_pct', 'iip_yoy_pct', 'crude_yoy_pct']
N_QUARTERS = 12

# Create initial scenario state based on the selected city
scenario_key = f"scenario_{selected_city}"

if scenario_key not in st.session_state:
    scenario_dict = {'Period': []}
    for col in macro_cols_to_edit:
        scenario_dict[col] = [round(x, 2) for x in extrapolate_linear(city_raw[col].tolist(), N_QUARTERS)]
    cur_p = city_raw['period'].iloc[-1]
    for _ in range(N_QUARTERS):
        cur_p = next_period(cur_p)
        scenario_dict['Period'].append(cur_p)
    st.session_state[scenario_key] = pd.DataFrame(scenario_dict)

def run_scenario_forecast(edited_df):
    model = model_data['model']
    features = model_data['features']
    hist_abs = city_raw['units_total_absorption'].tolist()
    msf_hist = city_raw['msf_commercial_absorption'].tolist()
    last_time_idx = city_raw['time_index'].iloc[-1]
    
    unedit_proj = {}
    for col in ['Population', 'gdp_real_usd_bn', 'Sensex_Growth']:
        unedit_proj[col] = extrapolate_linear(city_raw[col].tolist(), N_QUARTERS)
        
    preds = []
    for i, row in edited_df.iterrows():
        q_num = int(row['Period'].split('-')[0][1])
        feat_dict = {}
        for c in macro_cols_to_edit: feat_dict[c] = float(row[c])
        for c in ['Population', 'gdp_real_usd_bn', 'Sensex_Growth']: feat_dict[c] = unedit_proj[c][i]
        
        feat_dict['msf_comm_lag1'] = msf_hist[-1]
        feat_dict['msf_comm_lag2'] = msf_hist[-2] if len(msf_hist)>=2 else msf_hist[-1]
        feat_dict['msf_comm_lag4'] = msf_hist[-4] if len(msf_hist)>=4 else msf_hist[-1]
        msf_hist.append(feat_dict['msf_commercial_absorption'])
        
        feat_dict['absorption_lag1'] = hist_abs[-1]
        feat_dict['absorption_lag2'] = hist_abs[-2] if len(hist_abs)>=2 else hist_abs[-1]
        feat_dict['absorption_lag4'] = hist_abs[-4] if len(hist_abs)>=4 else hist_abs[-1]
        feat_dict['absorption_roll4'] = np.mean(hist_abs[-4:])
        feat_dict['absorption_yoy_growth'] = (hist_abs[-1]/hist_abs[-4] - 1) if len(hist_abs)>=4 and hist_abs[-4]>0 else 0
        
        feat_dict['time_index'] = last_time_idx + i + 1
        feat_dict['quarter_sin'] = np.sin(2 * np.pi * q_num / 4)
        feat_dict['quarter_cos'] = np.cos(2 * np.pi * q_num / 4)
        
        for flag in ['flag_GFC', 'flag_DeMo', 'flag_RERA', 'flag_NBFC_Crisis', 'flag_COVID_Wave1', 'flag_COVID_Wave2']:
            feat_dict[flag] = 0
            
        for col in features:
            if col.startswith('city_'):
                feat_dict[col] = 1 if col == f'city_{selected_city}' else 0
                
        df_pred = pd.DataFrame([feat_dict]).reindex(columns=features, fill_value=0)
        pred = float(model.predict(df_pred)[0])
        preds.append(round(pred))
        hist_abs.append(pred)
    return preds

scenario_predictions = run_scenario_forecast(st.session_state[scenario_key])

# ── VISUALIZATION ───────────────────────────────────────────────
st.subheader(f"📊 Forecasting Timeline — {selected_city}")

city_hist_fit['year'] = city_hist_fit['period'].apply(lambda x: int(str(x).split('-')[1]) if '-' in str(x) else 0)
train_df = city_hist_fit[city_hist_fit['year'] <= 2022]
test_df = city_hist_fit[(city_hist_fit['year'] >= 2023) & (city_hist_fit['year'] <= 2025)]

fig = go.Figure()

# Plot logic
fig.add_trace(go.Scatter(x=train_df['period'], y=train_df['units_total_absorption'], mode='lines', name='Actual (Train)', line=dict(color='#1a73e8', width=2), fill='tozeroy', fillcolor='rgba(26, 115, 232, 0.1)'))
train_fit = train_df.dropna(subset=['fitted_units'])
fig.add_trace(go.Scatter(x=train_fit['period'], y=train_fit['fitted_units'], mode='lines', name='Model Fit (Train)', line=dict(color='#ea4335', width=1.5, dash='dot')))
fig.add_trace(go.Scatter(x=test_df['period'], y=test_df['units_total_absorption'], mode='lines+markers', name='Actual (Test)', line=dict(color='#0d47a1', width=3), marker=dict(size=8)))
test_fit = test_df.dropna(subset=['fitted_units'])
fig.add_trace(go.Scatter(x=test_fit['period'], y=test_fit['fitted_units'], mode='lines+markers', name='Model Predicted (Test)', line=dict(color='#ff6d00', width=2, dash='dash'), marker=dict(size=8, symbol='square')))
fig.add_trace(go.Scatter(x=city_fc_base['Period'], y=city_fc_base['Forecast_Units'], mode='lines+markers', name='Baseline Forecast', line=dict(color='#2e7d32', width=3), marker=dict(size=8, symbol='diamond')))
fig.add_trace(go.Scatter(x=st.session_state[scenario_key]['Period'], y=scenario_predictions, mode='lines+markers', name='★ Custom Scenario Forecast', line=dict(color='#8e24aa', width=3, dash='dashdot'), marker=dict(size=9, symbol='star')))

if not test_df.empty and not city_fc_base.empty:
    fig.add_vline(x=test_df['period'].iloc[-1], line_width=2, line_dash="dash", line_color="gray")

fig.update_layout(xaxis_title="Quarter", yaxis_title="Units Absorbed", hovermode='x unified', height=550, legend=dict(orientation="h", yanchor="bottom", y=-0.25, xanchor="center", x=0.5))
st.plotly_chart(fig, use_container_width=True)

# ── SCENARIO PLANNER UI ─────────────────────────────────────────
st.subheader("🎛️ Scenario Planner")
st.markdown("Edit the macroeconomic projections below. The graph and table will automatically recalculate the **★ Custom Scenario Forecast** based on your inputs.")

# Update the state based on editor
edited_df = st.data_editor(st.session_state[scenario_key], hide_index=True, use_container_width=True)

# If changes were made, update the session state and rerun the script
if not edited_df.equals(st.session_state[scenario_key]):
    st.session_state[scenario_key] = edited_df
    st.rerun()

st.write("### Scenario vs Baseline Summary")
comparison_df = pd.DataFrame({
    'Quarter': edited_df['Period'],
    'Baseline Forecast': city_fc_base['Forecast_Units'].values,
    'Custom Scenario': scenario_predictions,
})
comparison_df['Difference'] = comparison_df['Custom Scenario'] - comparison_df['Baseline Forecast']
st.dataframe(comparison_df)
