require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { createObjectCsvWriter } = require('csv-writer');
const csv = require('csv-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const { finished } = require('stream/promises');
// MONGO: Import the MongoClient
const { MongoClient, ServerApiVersion } = require('mongodb');
// CORS: Require the cors package
const cors = require('cors');


// Try to load nodemailer, but don't crash if it's not installed
let nodemailer = null;
let emailEnabled = false;
try {
    nodemailer = require('nodemailer');
    emailEnabled = true;
    console.log('✅ Email functionality enabled (nodemailer found)');
} catch (error) {
    console.log('⚠️  Email functionality disabled (nodemailer not installed)');
    console.log('   Run "npm install nodemailer" in the backend folder to enable email alerts');
}

const app = express();

// CORS: Use the cors middleware to allow requests from your separate frontend
app.use(cors());

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; script-src-elem 'self' https://cdn.jsdelivr.net;"
  );
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 8080;
const BAUD_RATE = 9600;
const TRAINING_INTERVAL = 30 * 60 * 1000;
const SCAN_INTERVAL = 3000;

// --- STATE MANAGEMENT ---
let latestModelAccuracy = 0.0;
let isTraining = false;
let lastTrainingDuration = 30000;
let activePort = null;
let connectionStatus = { status: 'disconnected', port: null };
let isConnecting = false; // Connection lock


// --- MONGO: MongoDB Configuration ---
const mongoUri = process.env.MONGO_URI;
let db;
let sensorCollection;
const mongoClient = new MongoClient(mongoUri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function connectToMongo() {
    if (!mongoUri) {
        console.error("❌ MONGO_URI not found in .env file. MongoDB integration is disabled.");
        return;
    }
    try {
        await mongoClient.connect();
        db = mongoClient.db("HealthSurveillanceDB"); // You can change this database name
        sensorCollection = db.collection("sensor_readings"); // You can change this collection name
        console.log("✅ Successfully connected to MongoDB!");
    } catch (error) {
        console.error("❌ Could not connect to MongoDB. Please check your MONGO_URI.", error);
        process.exit(1); // Exit if DB connection fails, as it's a critical part
    }
}


// --- EMAIL CONFIGURATION ---
const MAINTENANCE_EMAILS = [
    process.env.MAINTENANCE_EMAIL_1 || 'arishvanth.10@gmail.com',
    process.env.MAINTENANCE_EMAIL_2 || 'sugunaraj106@gmail.com', 
    process.env.MAINTENANCE_EMAIL_3 || 'antosalinas354@gmail.com'
];

const HEALTH_ALERT_EMAILS = [
    process.env.HEALTH_EMAIL_1 || 'snofa2005@gmail.com',
    process.env.HEALTH_EMAIL_2 || 'subhashinikiruthikas@gmail.com',
    process.env.HEALTH_EMAIL_3 || 'antonyalex847@gmail.com'
];

// Email transporter configuration (only if nodemailer is available)
let emailTransporter = null;
if (emailEnabled && nodemailer) {
    try {
        emailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER || 'your-email@gmail.com', // Set via environment variable
                pass: process.env.EMAIL_PASS || 'your-app-password'     // Set via environment variable
            }
        });
        console.log('📧 Email transporter configured');
    } catch (error) {
        console.log('⚠️  Email transporter configuration failed:', error.message);
        emailEnabled = false;
    }
}

// Email tracking to prevent spam - 1 minute per parameter
let lastMaintenanceAlert = {};
let lastHealthAlert = {};
const EMAIL_COOLDOWN = 1 * 60 * 1000; // 1 minute cooldown per parameter

// Specific parameter tracking for maintenance alerts
const MAINTENANCE_PARAMETERS = ['TDS', 'pH', 'Turbidity'];
// Specific disease tracking for health alerts  
const HEALTH_DISEASES = ['Cholera', 'Typhoid', 'Hepatitis A', 'Dysentery', 'Diarrheal'];

// --- FILE PATHS ---
const frontendPath = path.join(__dirname, '..', 'frontend');
const dataPath = path.join(__dirname, '..', 'data');
const mlPath = path.join(__dirname, '..', 'ml');

if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath);

// --- SERVE FRONTEND & API ---
app.use(express.static(frontendPath));
app.use(express.json()); // Add JSON parsing middleware

// Legacy endpoint for fetching from CSV files
app.get('/api/history', async (req, res) => {
    const results = [];
    const files = fs.readdirSync(dataPath).filter(file => file.startsWith('surveillance_log_')).map(file => path.join(dataPath, file));
    for (const file of files) {
        const stream = fs.createReadStream(file).pipe(csv()).on('data', (data) => results.push(data));
        await finished(stream);
    }
    res.json(results);
});

// API endpoint for the analytical dashboard with filtering and summary
app.get('/api/mongo-history', async (req, res) => {
    if (!sensorCollection) {
        return res.status(503).json({ error: 'Database service not available' });
    }

    let { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        const now = new Date();
        endDate = now.toISOString();
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    }

    try {
        const matchStage = {
            $match: {
                timestamp: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            }
        };

        const sortStage = { $sort: { timestamp: 1 } }; 

        const summaryStage = {
            $group: {
                _id: null,
                avgTDS: { $avg: '$tds' },
                minTDS: { $min: '$tds' },
                maxTDS: { $max: '$tds' },
                avgPH: { $avg: '$ph' },
                minPH: { $min: '$ph' },
                maxPH: { $max: '$ph' },
                avgTurbidity: { $avg: '$turbidity' },
                minTurbidity: { $min: '$turbidity' },
                maxTurbidity: { $max: '$turbidity' },
            }
        };

        const results = await sensorCollection.aggregate([
            {
                $facet: {
                    'history': [matchStage, sortStage],
                    'summary': [matchStage, summaryStage]
                }
            }
        ]).toArray();
        
        const responseData = {
            history: results[0].history,
            summary: results[0].summary[0] || { avgTDS: 0, minTDS: 0, maxTDS: 0, avgPH: 0, minPH: 0, maxPH: 0, avgTurbidity: 0, minTurbidity: 0, maxTurbidity: 0 }
        };

        res.json(responseData);

    } catch (error) {
        console.error('Error fetching from MongoDB:', error);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// NEW: API endpoint to get database entry statistics for the overview widget
app.get('/api/entry-stats', async (req, res) => {
    if (!sensorCollection) {
        return res.status(503).json({ error: 'Database service not available' });
    }
    try {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [totalEntries, todayEntries, weekEntries] = await Promise.all([
            sensorCollection.countDocuments({}),
            sensorCollection.countDocuments({ timestamp: { $gte: startOfToday } }),
            sensorCollection.countDocuments({ timestamp: { $gte: sevenDaysAgo } })
        ]);

        res.json({
            total: totalEntries,
            today: todayEntries,
            pastWeek: weekEntries
        });

    } catch (error) {
        console.error('Error fetching entry stats from MongoDB:', error);
        res.status(500).json({ error: 'Failed to fetch entry statistics' });
    }
});

// API endpoint for sending maintenance alerts
app.post('/api/maintenance-alert', async (req, res) => {
    try {
        const { suggestions } = req.body;
        const result = await sendMaintenanceAlert(suggestions);
        if (result && result.success === false) {
            res.status(400).json(result);
        } else {
            res.json({ success: true, message: 'Maintenance alert processed successfully' });
        }
    } catch (error) {
        console.error('Error processing maintenance alert:', error);
        res.status(500).json({ success: false, message: 'Failed to process maintenance alert' });
    }
});

// API endpoint for sending health alerts
app.post('/api/health-alert', async (req, res) => {
    try {
        const { diseaseData } = req.body;
        const result = await sendHealthAlert(diseaseData);
        if (result && result.success === false) {
            res.status(400).json(result);
        } else {
            res.json({ success: true, message: 'Health alert processed successfully' });
        }
    } catch (error) {
        console.error('Error processing health alert:', error);
        res.status(500).json({ success: false, message: 'Failed to process health alert' });
    }
});

// API endpoint to check email cooldown status
app.get('/api/email-status', (req, res) => {
    const now = Date.now();
    const maintenanceStatus = {};
    const healthStatus = {};
    
    MAINTENANCE_PARAMETERS.forEach(param => {
        const lastAlert = lastMaintenanceAlert[param];
        if (lastAlert) {
            const timeSince = now - lastAlert;
            const remaining = Math.max(0, EMAIL_COOLDOWN - timeSince);
            maintenanceStatus[param] = {
                lastAlert: new Date(lastAlert).toLocaleString(),
                timeSinceSeconds: Math.round(timeSince / 1000),
                cooldownRemainingSeconds: Math.round(remaining / 1000),
                canSend: remaining === 0
            };
        } else {
            maintenanceStatus[param] = { lastAlert: 'Never', timeSinceSeconds: null, cooldownRemainingSeconds: 0, canSend: true };
        }
    });
    
    HEALTH_DISEASES.forEach(disease => {
        const lastAlert = lastHealthAlert[disease];
        if (lastAlert) {
            const timeSince = now - lastAlert;
            const remaining = Math.max(0, EMAIL_COOLDOWN - timeSince);
            healthStatus[disease] = {
                lastAlert: new Date(lastAlert).toLocaleString(),
                timeSinceSeconds: Math.round(timeSince / 1000),
                cooldownRemainingSeconds: Math.round(remaining / 1000),
                canSend: remaining === 0
            };
        } else {
            healthStatus[disease] = { lastAlert: 'Never', timeSinceSeconds: null, cooldownRemainingSeconds: 0, canSend: true };
        }
    });
    
    res.json({ emailEnabled, cooldownMinutes: EMAIL_COOLDOWN / (60 * 1000), maintenance: maintenanceStatus, health: healthStatus });
});

// --- UNIFIED CSV WRITER ---
const getCsvFileName = () => `surveillance_log_${new Date().toISOString().split('T')[0]}.csv`;
const csvHeader = [
    { id: 'timestamp', title: 'timestamp' }, { id: 'tds', title: 'tds' }, { id: 'ph', title: 'ph' }, { id: 'turbidity', title: 'turbidity' },
    { id: 'cholera_prob', title: 'cholera_prob' }, { id: 'typhoid_prob', title: 'typhoid_prob' }, { id: 'hepatitis_a_prob', title: 'hepatitis_a_prob' },
    { id: 'dysentery_prob', title: 'dysentery_prob' }, { id: 'diarrheal_prob', title: 'diarrheal_prob' }
];
function getCsvWriter() {
    const filePath = path.join(dataPath, getCsvFileName());
    return createObjectCsvWriter({ path: filePath, header: csvHeader, append: fs.existsSync(filePath) });
}

// --- NEW ROBUST SERIAL PORT CONNECTION ---
const scanAndConnect = async () => {
    if ((activePort && activePort.isOpen) || isConnecting) {
        return; 
    }
    isConnecting = true;
    try {
        updateAndBroadcastStatus('scanning');
        const ports = await SerialPort.list();
        const arduinoPortInfo = ports.find(p => p.manufacturer && (p.manufacturer.includes('Arduino') || p.manufacturer.includes('wch.cn')));

        if (arduinoPortInfo) {
            console.log(`Arduino found on ${arduinoPortInfo.path}. Attempting to connect...`);
            const port = new SerialPort({ path: arduinoPortInfo.path, baudRate: BAUD_RATE });
            const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            port.on('open', () => {
                console.log(`Successfully connected to Arduino on ${arduinoPortInfo.path}.`);
                activePort = port;
                isConnecting = false;
                updateAndBroadcastStatus('connected', arduinoPortInfo.path);
            });

            parser.on('data', handleSerialData);

            port.on('close', () => {
                console.log(`Arduino on ${arduinoPortInfo.path} disconnected.`);
                activePort = null;
                isConnecting = false;
                updateAndBroadcastStatus('disconnected');
            });

            port.on('error', (err) => {
                console.error(`SerialPort Error on ${arduinoPortInfo.path}:`, err.message);
                isConnecting = false;
                if (port.isOpen) port.close();
                activePort = null;
                updateAndBroadcastStatus('disconnected');
            });
        } else {
            isConnecting = false; 
            updateAndBroadcastStatus('disconnected');
        }
    } catch (error) {
        console.error("Failed to list serial ports:", error);
        isConnecting = false;
        updateAndBroadcastStatus('disconnected');
    }
};

// --- DATA PIPELINE ---
async function saveDataToMongo(record) {
    if (!sensorCollection) {
        console.warn("MongoDB collection not available. Skipping save.");
        return;
    }
    try {
        await sensorCollection.insertOne(record);
        console.log('📝 Data saved to MongoDB');
    } catch (error) {
        console.error('❌ Error saving data to MongoDB:', error);
    }
}

async function handleSerialData(data) {
    const parsedData = parseSerialData(data);
    const sensorRecord = { timestamp: new Date(), ...parsedData };

    triggerPrediction(sensorRecord, (predictions) => {
        const unifiedRecord = {
            ...sensorRecord,
            cholera_prob: predictions['Cholera']?.probability || 0,
            typhoid_prob: predictions['Typhoid']?.probability || 0,
            hepatitis_a_prob: predictions['Hepatitis A']?.probability || 0,
            dysentery_prob: predictions['Dysentery']?.probability || 0,
            diarrheal_prob: predictions['Diarrheal']?.probability || 0
        };
        
        const csvRecord = { ...unifiedRecord, timestamp: unifiedRecord.timestamp.toISOString() };
        getCsvWriter().writeRecords([csvRecord]);
        saveDataToMongo(unifiedRecord);
        broadcast(JSON.stringify({ type: 'data', payload: unifiedRecord }));
    });
}


// --- EMAIL NOTIFICATION FUNCTIONS ---
async function sendMaintenanceAlert(suggestions) {
    if (!emailEnabled || !emailTransporter) {
        console.log('📧 Email not configured - Maintenance alert would be sent for:', 
            suggestions.filter(s => s.severity === 'danger' || s.severity === 'warning').map(s => s.parameter).join(', '));
        return { success: false, message: 'Email not configured' };
    }

    const highSeveritySuggestions = suggestions.filter(s => s.severity === 'danger' || s.severity === 'warning');
    if (highSeveritySuggestions.length === 0) return { success: true, message: 'No high severity issues' };
    
    const now = Date.now();
    const alertsToSend = [];
    const cooldownStatus = [];
    
    for (const suggestion of highSeveritySuggestions) {
        const parameterKey = suggestion.parameter;
        const lastAlertTime = lastMaintenanceAlert[parameterKey];
        const timeSinceLastAlert = lastAlertTime ? now - lastAlertTime : EMAIL_COOLDOWN + 1;
        
        if (timeSinceLastAlert > EMAIL_COOLDOWN) {
            alertsToSend.push(suggestion);
            lastMaintenanceAlert[parameterKey] = now;
            console.log(`✅ ${parameterKey} alert approved - last sent ${lastAlertTime ? Math.round(timeSinceLastAlert/1000) + 's' : 'never'} ago`);
        } else {
            const remainingCooldown = Math.round((EMAIL_COOLDOWN - timeSinceLastAlert) / 1000);
            cooldownStatus.push(`${parameterKey}: ${remainingCooldown}s remaining`);
            console.log(`⏳ ${parameterKey} alert in cooldown - ${remainingCooldown}s remaining`);
        }
    }
    
    if (alertsToSend.length === 0) {
        console.log('📧 All maintenance alerts in cooldown period:', cooldownStatus.join(', '));
        return { success: true, message: `Alerts in cooldown: ${cooldownStatus.join(', ')}` };
    }
    
    const subject = `🚨 Water Quality Maintenance Alert - ${alertsToSend.map(s => s.parameter).join(', ')}`;
    const timestamp = new Date().toLocaleString();
    
    let emailBody = `<h2>Water Quality Maintenance Alert</h2><p><strong>Alert Time:</strong> ${timestamp}</p><p><strong>System:</strong> Health Surveillance System</p><p><strong>Parameters Affected:</strong> ${alertsToSend.length} of ${highSeveritySuggestions.length} (1-minute cooldown per parameter)</p>${cooldownStatus.length > 0 ? `<p><strong>In Cooldown:</strong> ${cooldownStatus.join(', ')}</p>` : ''}<hr>`;
    
    alertsToSend.forEach(suggestion => {
        const severityColor = suggestion.severity === 'danger' ? '#e74c3c' : '#f39c12';
        emailBody += `<div style="border-left: 4px solid ${severityColor}; padding: 10px; margin: 10px 0; background-color: #f9f9f9;"><h3 style="color: ${severityColor}; margin: 0;">${suggestion.parameter} - ${suggestion.severity.toUpperCase()}</h3><p><strong>Issue:</strong> ${suggestion.text}</p><p><strong>Recommended Action:</strong> ${suggestion.solution}</p></div>`;
    });
    
    emailBody += `<hr><p><em>This is an automated alert from the Health Surveillance System. Please take immediate action as required.</em></p>`;
    
    const mailOptions = { from: process.env.EMAIL_USER || 'health-system@company.com', to: MAINTENANCE_EMAILS.join(','), subject: subject, html: emailBody };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Maintenance alert email sent for: ${alertsToSend.map(s => s.parameter).join(', ')}`);
        return { success: true, message: 'Email sent successfully' };
    } catch (error) {
        console.error('❌ Failed to send maintenance alert email:', error.message);
        return { success: false, message: error.message };
    }
}

async function sendHealthAlert(diseaseData) {
    if (!emailEnabled || !emailTransporter) {
        const highRiskDiseases = Object.entries(diseaseData).filter(([disease, data]) => (data.probability * 100) > 70);
        console.log('🚨 Email not configured - CRITICAL health alert would be sent for:', highRiskDiseases.map(([disease, data]) => `${disease} (${(data.probability * 100).toFixed(1)}%)`).join(', '));
        return { success: false, message: 'Email not configured' };
    }

    const highRiskDiseases = Object.entries(diseaseData).filter(([disease, data]) => (data.probability * 100) > 70).map(([disease, data]) => ({ disease, probability: data.probability * 100 }));
    if (highRiskDiseases.length === 0) return { success: true, message: 'No high risk diseases' };
    
    const now = Date.now();
    const alertsToSend = [];
    const cooldownStatus = [];
    
    for (const { disease, probability } of highRiskDiseases) {
        const diseaseKey = disease;
        const lastAlertTime = lastHealthAlert[diseaseKey];
        const timeSinceLastAlert = lastAlertTime ? now - lastAlertTime : EMAIL_COOLDOWN + 1;
        
        if (timeSinceLastAlert > EMAIL_COOLDOWN) {
            alertsToSend.push({ disease, probability });
            lastHealthAlert[diseaseKey] = now;
            console.log(`🚨 ${disease} alert approved (${probability.toFixed(1)}%) - last sent ${lastAlertTime ? Math.round(timeSinceLastAlert/1000) + 's' : 'never'} ago`);
        } else {
            const remainingCooldown = Math.round((EMAIL_COOLDOWN - timeSinceLastAlert) / 1000);
            cooldownStatus.push(`${disease}: ${remainingCooldown}s remaining`);
            console.log(`⏳ ${disease} alert in cooldown (${probability.toFixed(1)}%) - ${remainingCooldown}s remaining`);
        }
    }
    
    if (alertsToSend.length === 0) {
        console.log('🚨 All health alerts in cooldown period:', cooldownStatus.join(', '));
        return { success: true, message: `Health alerts in cooldown: ${cooldownStatus.join(', ')}` };
    }
    
    const subject = `🚨 CRITICAL: High Disease Risk Alert - ${alertsToSend.map(a => a.disease).join(', ')}`;
    const timestamp = new Date().toLocaleString();
    
    let emailBody = `<h2 style="color: #e74c3c;">CRITICAL HEALTH ALERT</h2><p><strong>Alert Time:</strong> ${timestamp}</p><p><strong>System:</strong> Health Surveillance System</p><p><strong>Diseases Above 70%:</strong> ${alertsToSend.length} of ${highRiskDiseases.length} (1-minute cooldown per disease)</p>${cooldownStatus.length > 0 ? `<p><strong>In Cooldown:</strong> ${cooldownStatus.join(', ')}</p>` : ''}<p style="color: #e74c3c; font-weight: bold;">⚠️ IMMEDIATE ACTION REQUIRED ⚠️</p><hr>`;
    
    alertsToSend.forEach(({ disease, probability }) => {
        emailBody += `<div style="border: 2px solid #e74c3c; padding: 15px; margin: 15px 0; background-color: #fdf2f2;"><h3 style="color: #e74c3c; margin: 0;">${disease}</h3><p style="font-size: 18px; font-weight: bold; color: #e74c3c;">Risk Level: ${probability.toFixed(1)}%</p><p><strong>Status:</strong> CRITICAL - Above 70% threshold</p></div>`;
    });
    
    emailBody += `<hr><h3>Immediate Actions Required:</h3><ul><li>Immediately stop water consumption from this source</li><li>Implement emergency water treatment protocols</li><li>Notify health authorities and local population</li><li>Begin investigation of contamination source</li><li>Activate emergency response procedures</li></ul><p style="color: #e74c3c; font-weight: bold;"><em>This is a CRITICAL automated alert. Immediate response is required to prevent health risks.</em></p>`;
    
    const mailOptions = { from: process.env.EMAIL_USER || 'health-system@company.com', to: HEALTH_ALERT_EMAILS.join(','), subject: subject, html: emailBody, priority: 'high' };
    
    try {
        await emailTransporter.sendMail(mailOptions);
        console.log(`🚨 CRITICAL health alert email sent for: ${alertsToSend.map(a => a.disease).join(', ')}`);
        return { success: true, message: 'Critical email sent successfully' };
    } catch (error) {
        console.error('❌ Failed to send health alert email:', error.message);
        return { success: false, message: error.message };
    }
}

// --- WEBSOCKET ---
wss.on('connection', (ws) => {
  console.log('Client connected. Sending current model accuracy and connection status.');
  ws.send(JSON.stringify({ type: 'accuracy_update', payload: { accuracy: latestModelAccuracy } }));
  ws.send(JSON.stringify({ type: 'connection_update', payload: connectionStatus }));
  ws.on('message', (message) => {
    const msg = JSON.parse(message);
    if (msg.action === 'start_training') {
        initiateTraining('manual');
    } else if (msg.action === 'maintenance_alert') {
        sendMaintenanceAlert(msg.suggestions);
    } else if (msg.action === 'health_alert') {
        sendHealthAlert(msg.diseaseData);
    }
  });
});

function broadcast(data) {
  wss.clients.forEach((client) => { if (client.readyState === 1) client.send(data); });
}

function updateAndBroadcastStatus(status, port = null) {
    connectionStatus = { status, port };
    broadcast(JSON.stringify({ type: 'connection_update', payload: connectionStatus }));
}

// --- HYBRID ML TRAINING LOGIC ---
function initiateTraining(trigger = 'automatic') {
  if (isTraining) {
    if (trigger === 'manual') {
        broadcast(JSON.stringify({ type: 'training_complete', payload: { status: 'error', message: 'Training already in progress.' } }));
    }
    return;
  }
  isTraining = true;
  const startTime = Date.now();
  console.log(`[${new Date().toLocaleTimeString()}] Initiating ${trigger} model training...`);
  broadcast(JSON.stringify({ type: 'training_start', payload: { estimatedDuration: lastTrainingDuration } }));

  const allCsvFiles = fs.readdirSync(dataPath).filter(f => f.startsWith('surveillance_log_')).map(f => path.join(dataPath, f));
  if (allCsvFiles.length === 0) {
    isTraining = false;
    broadcast(JSON.stringify({ type: 'training_complete', payload: { status: 'error', message: 'No data to train on.' } }));
    return;
  }
  
  const pythonProcess = spawn('python', [path.join(mlPath, 'train_model.py'), ...allCsvFiles]);
  
  let errorOutput = '';
  pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });
  pythonProcess.stdout.on('data', (data) => {
    data.toString().split('\n').forEach(line => {
        if (line.startsWith('PROGRESS:')) {
            broadcast(JSON.stringify({ type: 'training_progress', payload: JSON.parse(line.replace('PROGRESS:', '')) }));
        }
        if (line.startsWith('RESULT:')) {
            const result = JSON.parse(line.replace('RESULT:', ''));
            latestModelAccuracy = result.accuracy;
            broadcast(JSON.stringify({ type: 'accuracy_update', payload: { accuracy: latestModelAccuracy } }));
        }
    });
  });

  pythonProcess.on('close', (code) => {
    isTraining = false;
    lastTrainingDuration = Date.now() - startTime;
    if (code !== 0) {
      broadcast(JSON.stringify({ type: 'training_complete', payload: { status: 'error', message: errorOutput.substring(0, 100) + '...' } }));
    } else {
      broadcast(JSON.stringify({ type: 'training_complete', payload: { status: 'success', message: 'Model updated successfully.' } }));
    }
  });
}

// --- PREDICTION LOGIC ---
function triggerPrediction(data, callback) {
    const pythonProcess = spawn('python', [path.join(mlPath, 'predict_disease.py'), JSON.stringify(data)]);
    let result = '';
    pythonProcess.stdout.on('data', (data) => { result += data.toString(); });
    pythonProcess.on('close', (code) => {
        if (code === 0 && result) {
            try { callback(JSON.parse(result)); } catch (e) { console.error('Prediction parse error:', e); }
        }
    });
}

// --- HELPERS ---
function parseSerialData(data) {
  const readings = {};
  data.split(',').forEach(part => {
    const [key, value] = part.split(':');
    if (key && value) readings[key.trim()] = parseFloat(value) || 0;
  });
  return readings;
}


// --- SERVER START ---
async function startServer() {
    console.log('='.repeat(60));
    console.log('🚀 Health Surveillance System Backend Starting');
    console.log('='.repeat(60));
    
    await connectToMongo();

    server.listen(PORT, () => {
        console.log(`📡 Server running at: http://localhost:${PORT}`);
        console.log(`📁 Frontend path: ${frontendPath}`);
        console.log(`💾 Data path: ${dataPath}`);
        console.log(`🤖 ML path: ${mlPath}`);
        console.log(`📧 Email enabled: ${emailEnabled ? '✅ Yes' : '❌ No (install nodemailer)'}`);
        if (emailEnabled) {
            console.log(`📬 Maintenance emails: ${MAINTENANCE_EMAILS.join(', ')}`);
            console.log(`🏥 Health alert emails: ${HEALTH_ALERT_EMAILS.join(', ')}`);
        }
        console.log('='.repeat(60));
        
        setInterval(scanAndConnect, SCAN_INTERVAL);
        console.log('🔍 Starting Arduino scanning...');
        console.log('🧠 Performing initial model training in 5 seconds...');
        setTimeout(() => initiateTraining('initial'), 5000);
        setInterval(() => initiateTraining('automatic'), TRAINING_INTERVAL);
    });
}

startServer();

