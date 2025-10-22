void setup() {
  Serial.begin(9600);
  randomSeed(analogRead(0));
}

void loop() {
  // Generate realistic test data
  float tdsValue = generateRealisticTDS();
  float phValue = generateRealisticPH();
  float turbidityValue = generateRealisticTurbidity();

  // Send data in the same format as production code
  Serial.print("tds:");
  Serial.print(tdsValue);
  Serial.print(",ph:");
  Serial.print(phValue);
  Serial.print(",turbidity:");
  Serial.println(turbidityValue);
  
  delay(5000); // Send data every 5 seconds
}

float generateRealisticTDS() {
  // 90% chance of normal TDS, 10% chance of a spike
  if (random(100) < 90) {
    return random(200, 500); // Normal range
  } else {
    return random(501, 1200); // Contaminated range
  }
}

float generateRealisticPH() {
  // 90% chance of normal pH, 10% chance of anomaly
  if (random(100) < 90) {
    return random(65, 85) / 10.0; // Normal range 6.5 - 8.5
  } else {
    return random(50, 95) / 10.0; // Anomaly range 5.0 - 9.5
  }
}

float generateRealisticTurbidity() {
  // 90% chance of clear water, 10% chance of high turbidity
  if (random(100) < 90) {
    return random(0, 40) / 10.0; // Normal range 0.0 - 4.0
  } else {
    return random(41, 200) / 10.0; // Contaminated range 4.1 - 20.0
  }
}

