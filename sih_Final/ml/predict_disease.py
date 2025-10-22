import sys
import json
import pandas as pd
import joblib
import os
import numpy as np

def main(sensor_data_json):
    models_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    model_path = os.path.join(models_dir, 'waterborne_disease_model.pkl')
    scaler_path = os.path.join(models_dir, 'feature_scaler.pkl')
    
    all_diseases = ['Cholera', 'Typhoid', 'Hepatitis A', 'Dysentery', 'Diarrheal']
    default_predictions = {disease: {'probability': 0.01, 'risk_level': 'low'} for disease in all_diseases}
    default_predictions['System Message'] = {'probability': 0, 'risk_level': 'No Model'}

    if not os.path.exists(model_path) or not os.path.exists(scaler_path):
        print(json.dumps(default_predictions))
        return

    try:
        model = joblib.load(model_path)
        scaler = joblib.load(scaler_path)
        sensor_data = json.loads(sensor_data_json)
        
        features_df = pd.DataFrame([{'tds': sensor_data.get('tds', 0), 'ph': sensor_data.get('ph', 0), 'turbidity': sensor_data.get('turbidity', 0)}])
        
        features_scaled = scaler.transform(features_df)
        probabilities = model.predict_proba(features_scaled)[0]
        classes = model.classes_
        
        predictions = {disease: {'probability': 0.01, 'risk_level': 'low'} for disease in all_diseases}

        for i, disease in enumerate(classes):
            prob = probabilities[i]
            risk_level = 'low'
            if prob > 0.6: risk_level = 'high'
            elif prob > 0.3: risk_level = 'medium'
            predictions[disease] = {'probability': prob, 'risk_level': risk_level}
        
        print(json.dumps(predictions))

    except Exception:
        print(json.dumps(default_predictions))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        main(sys.argv[1])
    else:
        main('{}')

