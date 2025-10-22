import sys
import json
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
import joblib
import os

def send_progress(step, progress_val, message=""):
    """Sends a JSON progress update to stdout for Node.js to capture."""
    progress = {"step": step, "progress": progress_val, "message": message}
    print(f"PROGRESS:{json.dumps(progress)}")
    sys.stdout.flush()

def main(csv_files):
    models_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    if not os.path.exists(models_dir):
        os.makedirs(models_dir)

    model_path = os.path.join(models_dir, 'waterborne_disease_model.pkl')
    scaler_path = os.path.join(models_dir, 'feature_scaler.pkl')

    try:
        send_progress('Loading Data', 10)
        df_list = [pd.read_csv(file) for file in csv_files]
        if not df_list: raise ValueError("No data files to process.")
        
        data = pd.concat(df_list, ignore_index=True)
        data.dropna(inplace=True)
        if data.empty: raise ValueError("CSV files are empty after cleaning.")

        send_progress('Preprocessing', 20)
        conditions = [
            (data['turbidity'] > 4.0) & (data['ph'] < 7.0),
            (data['tds'] > 600),
            (data['turbidity'] > 5.0)
        ]
        choices = ['Dysentery', 'Typhoid', 'Diarrheal']
        data['disease'] = np.select(conditions, choices, default='None')
        
        labeled_data = data[data['disease'] != 'None'].copy()

        MIN_DATA_THRESHOLD = 20 # Flexible threshold
        if len(labeled_data) < MIN_DATA_THRESHOLD:
            raise ValueError(f"Not enough training data found ({len(labeled_data)} out of {MIN_DATA_THRESHOLD} required).")
        if len(labeled_data['disease'].unique()) < 2:
            raise ValueError("Training requires at least two different types of labeled data.")

        send_progress('Feature Engineering', 40)
        features = ['tds', 'ph', 'turbidity']
        target_col = 'disease'
        X = labeled_data[features]
        y = labeled_data[target_col]

        should_stratify = all(y.value_counts() > 1)
        
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.25, random_state=42, stratify=y if should_stratify else None
        )
        
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        send_progress('Training Model', 70)
        model = RandomForestClassifier(n_estimators=100, random_state=42)
        model.fit(X_train_scaled, y_train)
        
        send_progress('Validating', 90)
        predictions = model.predict(X_test_scaled)
        accuracy = accuracy_score(y_test, predictions)
        
        send_progress('Saving Model', 98)
        joblib.dump(model, model_path)
        joblib.dump(scaler, scaler_path)
        
        result = {'accuracy': accuracy}
        print(f"RESULT:{json.dumps(result)}")

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        main(sys.argv[1:])
    else:
        print("ERROR: No CSV file paths were provided.", file=sys.stderr)
        sys.exit(1)

