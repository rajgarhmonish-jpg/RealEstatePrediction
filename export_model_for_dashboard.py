"""
Export trained model data and predictions for dashboard visualization.
Saves model as JSON-serializable format for JavaScript frontend.
"""

import pandas as pd
import numpy as np
import json
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import r2_score, mean_absolute_percentage_error
import warnings
warnings.filterwarnings('ignore')

# ============================================================================
# STEP 1: Load and prepare data (identical to notebook)
# ============================================================================
file_path = '/Users/manish/Downloads/KotakHousingData/Project/4KotakHousingv3.xls'
df_raw = pd.read_excel(file_path, index_col=0)

columns_to_keep = [
    'city', 'period', 'GDP_Growth_Rate', 'Repo_Rate', 'Sensex_Growth',
    'Population', 'WPI', 'IIP', 'Crude', 'units_total_absorption',
    'msf_commercial_absorption', 'gdp_nominal_usd_bn', 'gdp_real_usd_bn',
    'pop_change_pct', 'gdp_nominal_yoy_pct', 'gdp_real_yoy_pct',
    'wpi_inflation_pct', 'iip_index', 'iip_yoy_pct', 'brent_crude_usd_bbl', 'crude_yoy_pct'
]
df = df_raw[columns_to_keep].copy()

# ============================================================================
# STEP 2: Feature engineering
# ============================================================================
df['msf_comm_lag1'] = df.groupby('city')['msf_commercial_absorption'].shift(1)
df['msf_comm_lag2'] = df.groupby('city')['msf_commercial_absorption'].shift(2)
df['msf_comm_lag4'] = df.groupby('city')['msf_commercial_absorption'].shift(4)

# Event flags
gfc_quarters = ['Q3-2008', 'Q4-2008', 'Q1-2009', 'Q2-2009']
demo_quarters = ['Q4-2016', 'Q1-2017']
rera_quarters = ['Q2-2017', 'Q3-2017', 'Q4-2017']
nbfc_quarters = ['Q3-2018', 'Q4-2018', 'Q1-2019']
covid1_quarters = ['Q1-2020', 'Q2-2020', 'Q3-2020']
covid2_quarters = ['Q2-2021', 'Q3-2021']

df['flag_GFC'] = df['period'].isin(gfc_quarters).astype(int)
df['flag_DeMo'] = df['period'].isin(demo_quarters).astype(int)
df['flag_RERA'] = df['period'].isin(rera_quarters).astype(int)
df['flag_NBFC_Crisis'] = df['period'].isin(nbfc_quarters).astype(int)
df['flag_COVID_Wave1'] = df['period'].isin(covid1_quarters).astype(int)
df['flag_COVID_Wave2'] = df['period'].isin(covid2_quarters).astype(int)

features_base = [
    'Population', 'msf_commercial_absorption', 'msf_comm_lag1', 'msf_comm_lag2', 'msf_comm_lag4',
    'gdp_real_usd_bn', 'gdp_real_yoy_pct', 'Repo_Rate', 'Sensex_Growth',
    'wpi_inflation_pct', 'iip_yoy_pct', 'crude_yoy_pct',
    'flag_GFC', 'flag_DeMo', 'flag_RERA', 'flag_NBFC_Crisis', 'flag_COVID_Wave1', 'flag_COVID_Wave2'
]
target_variable = 'units_total_absorption'
df_clean = df[['city', 'period', target_variable] + features_base].dropna()

# Sort by chronological quarter order, not lexicographic string order
period_parts = df_clean['period'].str.extract(r'Q(\d+)-(\d{4})')
df_clean['quarter'] = period_parts[0].astype(int)
df_clean['year'] = period_parts[1].astype(int)
df_clean = df_clean.sort_values(['year', 'quarter', 'city']).reset_index(drop=True)

# ============================================================================
# STEP 3: Train master model
# ============================================================================
train_set = df_clean[df_clean['year'] <= 2022]
test_set = df_clean[df_clean['year'] >= 2023]

# Prepare data with one-hot encoding
X_train_global = pd.get_dummies(train_set[features_base + ['city']], columns=['city'], drop_first=True)
y_train_global = train_set[target_variable]
X_test_global = pd.get_dummies(test_set[features_base + ['city']], columns=['city'], drop_first=True)
y_test_global = test_set[target_variable]

X_train_global, X_test_global = X_train_global.align(X_test_global, join='left', axis=1, fill_value=0)

# Train model
master_model = GradientBoostingRegressor(n_estimators=100, learning_rate=0.06, max_depth=4, random_state=42)
master_model.fit(X_train_global, y_train_global)

# Get predictions
global_preds_train = master_model.predict(X_train_global)
global_preds_test = master_model.predict(X_test_global)

print("✓ Model trained successfully")
print(f"  Train R²: {r2_score(y_train_global, global_preds_train):.4f}")
print(f"  Test R²: {r2_score(y_test_global, global_preds_test):.4f}")

# ============================================================================
# STEP 4: Prepare data for each city
# ============================================================================
cities = df_clean['city'].unique()
dashboard_data = {}

for city_name in cities:
    city_df = df_clean[df_clean['city'] == city_name].sort_values(['year', 'quarter'])
    city_train = train_set[train_set['city'] == city_name].sort_values(['year', 'quarter'])
    city_test = test_set[test_set['city'] == city_name].sort_values(['year', 'quarter'])
    
    # Get predictions for this city's test set - need to map indices properly
    city_test_indices = [i for i, idx in enumerate(test_set.index) if idx in city_test.index]
    city_test_pred = global_preds_test[city_test_indices] if city_test_indices else []
    
    # Historical data (training)
    city_train_indices = [i for i, idx in enumerate(train_set.index) if idx in city_train.index]
    historical_actual = city_train[target_variable].values.tolist()
    historical_predicted = global_preds_train[city_train_indices].tolist() if city_train_indices else []
    historical_periods = city_train['period'].tolist()
    
    # Test data (validation)
    test_actual = city_test[target_variable].values.tolist()
    test_predicted = city_test_pred.tolist()
    test_periods = city_test['period'].tolist()
    
    # Extract macro data for last row (for predictions)
    last_row = city_df.iloc[-1]
    macro_data = {
        'gdp_growth': float(last_row['gdp_real_yoy_pct']) if not pd.isna(last_row['gdp_real_yoy_pct']) else 6.5,
        'crude': float(last_row['crude_yoy_pct']) if not pd.isna(last_row['crude_yoy_pct']) else 10.0,
        'wpi': float(last_row['wpi_inflation_pct']) if not pd.isna(last_row['wpi_inflation_pct']) else 4.0,
        'iip': float(last_row['iip_yoy_pct']) if not pd.isna(last_row['iip_yoy_pct']) else 5.0,
        'pop': float(last_row['Population']) if not pd.isna(last_row['Population']) else 10000000,
    }
    
    market_data = {
        'launches': float(last_row['msf_commercial_absorption']) if not pd.isna(last_row['msf_commercial_absorption']) else 1000,
        'prices_by_q': [float(last_row['Repo_Rate'])] * 12,  # Placeholder for 12 quarters
    }
    
    # Build time index
    time_idx = len(historical_periods) + len(test_periods) - 1
    
    dashboard_data[city_name] = {
        'historical': {
            'periods': historical_periods,
            'actual': historical_actual,
            'predicted': historical_predicted,
        },
        'test': {
            'periods': test_periods,
            'actual': test_actual,
            'predicted': test_predicted,
        },
        'macro': macro_data,
        'market': market_data,
        'time_idx': time_idx,
        'model': {
            'means': X_train_global.mean().values.tolist(),
            'scales': X_train_global.std().values.tolist(),
            'intercept': 0,  # For linear model reference
            'coefs': master_model.feature_importances_.tolist(),
            'feature_names': X_train_global.columns.tolist(),
            'type': 'gb',
            'init': float(np.mean(y_train_global)),
            'lr': 0.06,
            'n_trees': 100,
        }
    }

# ============================================================================
# STEP 5: Extract feature importance
# ============================================================================
importance_weights = master_model.feature_importances_
feature_importance = {
    name: float(weight) 
    for name, weight in zip(X_train_global.columns, importance_weights)
}

# ============================================================================
# STEP 6: Event quarters mapping
# ============================================================================
events_map = {
    'GFC': {
        'name': 'Global Financial Crisis',
        'color': '#dc3545',
        'quarters': gfc_quarters,
    },
    'DeMo': {
        'name': 'Demonetization',
        'color': '#fd7e14',
        'quarters': demo_quarters,
    },
    'RERA': {
        'name': 'RERA Implementation',
        'color': '#ffc107',
        'quarters': rera_quarters,
    },
    'NBFC': {
        'name': 'NBFC Crisis',
        'color': '#e83e8c',
        'quarters': nbfc_quarters,
    },
    'COVID1': {
        'name': 'COVID-19 Wave 1',
        'color': '#6f42c1',
        'quarters': covid1_quarters,
    },
    'COVID2': {
        'name': 'COVID-19 Wave 2',
        'color': '#6c757d',
        'quarters': covid2_quarters,
    },
}

# ============================================================================
# STEP 7: Export to JSON
# ============================================================================
export_data = {
    'cities': list(cities),
    'dashboard_data': dashboard_data,
    'feature_importance': importance_weights.tolist(),
    'feature_names': X_train_global.columns.tolist(),
    'events': events_map,
    'model_stats': {
        'train_r2': float(r2_score(y_train_global, global_preds_train)),
        'test_r2': float(r2_score(y_test_global, global_preds_test)),
        'train_mape': float(mean_absolute_percentage_error(y_train_global, global_preds_train)),
        'test_mape': float(mean_absolute_percentage_error(y_test_global, global_preds_test)),
    }
}

# Save to file
output_path = '/Users/manish/Downloads/KotakHousingData/Project/dashboard_model_data.json'
with open(output_path, 'w') as f:
    json.dump(export_data, f, indent=2)

print(f"✓ Model data exported to: {output_path}")
print(f"  Cities: {', '.join(cities)}")
print(f"  File size: {len(json.dumps(export_data)) / 1024:.1f} KB")
