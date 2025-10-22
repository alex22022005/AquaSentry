~document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let historicalData = [];
    let currentFilter = 'live';
    let trainingInterval;
    let activeDiseaseAlerts = new Map();
    let activeSensorAlerts = new Map();
    let activeConnectionAlerts = new Map(); // Separate map for critical connection alerts
    let connectionTimeout;
    let predictionRefreshInterval;

    // --- DOM ELEMENT REFERENCES ---
    const themeToggle = document.getElementById('theme-toggle');
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const trainButton = document.getElementById('train-button');
    const accuracyGaugeContainer = document.querySelector('.accuracy-gauge-container');
    const accuracyGaugeFill = document.getElementById('accuracy-gauge-fill');
    const accuracyGaugeText = document.getElementById('accuracy-gauge-text');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressBarText = document.getElementById('progress-bar-text');
    const timeRemainingText = document.getElementById('time-remaining-text');
    const tdsValueEl = document.getElementById('tds-value'), phValueEl = document.getElementById('ph-value'), turbidityValueEl = document.getElementById('turbidity-value');
    const tdsStatusEl = document.getElementById('tds-status'), phStatusEl = document.getElementById('ph-status'), turbidityStatusEl = document.getElementById('turbidity-status');
    const tdsProgressEl = document.getElementById('tds-progress'), phProgressEl = document.getElementById('ph-progress'), turbidityProgressEl = document.getElementById('turbidity-progress');
    const ringCircumference = 226.19; // 2 * Math.PI * 36
    const suggestionsListEl = document.getElementById('suggestions-list');
    const preventionListEl = document.getElementById('prevention-list');
    const connectionStatusEl = document.getElementById('connection-status');
    const connectionIconEl = document.getElementById('connection-icon');
    const connectionTextEl = document.getElementById('connection-text');

    // --- CHART INITIALIZATION ---
    const tdsCtx = document.getElementById('tds-chart').getContext('2d');
    const tdsChart = new LiveChart(tdsCtx, 'TDS (ppm)', '--chart-line-tds');
    const phCtx = document.getElementById('ph-chart').getContext('2d');
    const phChart = new LiveChart(phCtx, 'pH', '--chart-line-ph');
    const turbidityCtx = document.getElementById('turbidity-chart').getContext('2d');
    const turbidityChart = new LiveChart(turbidityCtx, 'Turbidity (NTU)', '--chart-line-turbidity');
    const allCharts = [tdsChart, phChart, turbidityChart];

    // --- THEME LOGIC ---
    function applyTheme(theme) {
        document.body.classList.toggle('light-theme', theme === 'light');
        sunIcon.style.display = theme === 'light' ? 'none' : 'block';
        moonIcon.style.display = theme === 'light' ? 'block' : 'none';
        allCharts.forEach(chart => chart.updateTheme());
    }
    themeToggle.addEventListener('click', () => {
        const newTheme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    });
    applyTheme(localStorage.getItem('theme') || 'dark');

    // --- DATA FETCHING & WEBSOCKET ---
    async function fetchHistoricalData() {
        try {
            const response = await fetch('/api/history');
            historicalData = (await response.json()).map(d => ({...d, timestamp: new Date(d.timestamp), tds: parseFloat(d.tds), ph: parseFloat(d.ph), turbidity: parseFloat(d.turbidity), cholera_prob: parseFloat(d.cholera_prob), typhoid_prob: parseFloat(d.typhoid_prob), hepatitis_a_prob: parseFloat(d.hepatitis_a_prob), dysentery_prob: parseFloat(d.dysentery_prob), diarrheal_prob: parseFloat(d.diarrheal_prob) })).sort((a, b) => a.timestamp - b.timestamp);
            if (historicalData.length > 0) {
                const latestData = historicalData[historicalData.length - 1];
                updateLiveData(latestData);
                updatePredictionDashboardFromData(latestData);
            }
            filterData('live'); 
            updateSuggestions();
            updatePreventionMethods();
        } catch (error) { console.error('Failed to fetch historical data:', error); }
    }

    // WebSocket connection management
    let ws = null;
    let reconnectInterval = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const reconnectDelay = 3000; // 3 seconds
    let isInitialConnection = true;
    let connectionState = 'disconnected'; // 'disconnected', 'connecting', 'connected'
    
    function connectWebSocket() {
        try {
            connectionState = 'connecting';
            ws = new WebSocket(`ws://${window.location.host}`);
            
            ws.onopen = () => {
                console.log('WebSocket connected to server');
                connectionState = 'connected';
                reconnectAttempts = 0;
                clearInterval(reconnectInterval);
                reconnectInterval = null;
                
                // Clear any existing connection alerts when WebSocket connects
                dismissAlert('websocket-disconnected', activeConnectionAlerts);
                dismissAlert('connection-status', activeSensorAlerts);
                // Note: Arduino connection alerts are cleared in updateConnectionStatus when Arduino connects
                
                // Show connection success popup
                if (isInitialConnection) {
                    // Initial connection - show welcome message
                    createAlert('websocket-initial-connected', {
                        title: 'System Ready',
                        message: 'Health Surveillance System is now online and monitoring water quality in real-time.',
                        type: 'email-sent'
                    }, activeSensorAlerts, 5000);
                    isInitialConnection = false;
                } else {
                    // Reconnection - show restoration message
                    const successQuotes = [
                        "Welcome back! Your monitoring system is online.",
                        "Connection restored! All systems are operational.",
                        "You're back online! Monitoring resumed successfully.",
                        "Great news! Your dashboard is connected and ready.",
                        "Connection successful! Real-time monitoring active.",
                        "All set! Your health surveillance system is back online."
                    ];
                    const randomSuccessQuote = successQuotes[Math.floor(Math.random() * successQuotes.length)];
                    
                    createAlert('websocket-reconnected', {
                        title: 'Connection Restored',
                        message: randomSuccessQuote,
                        type: 'email-sent'
                    }, activeSensorAlerts, 4000);
                }
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected from server');
                if (connectionState === 'connected') {
                    connectionState = 'disconnected';
                    updateConnectionStatus({ status: 'disconnected' });
                    // Show immediate persistent disconnection alert
                    showDisconnectionAlert();
                    // Start reconnection attempts
                    startReconnection();
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                if (connectionState !== 'disconnected') {
                    connectionState = 'disconnected';
                    updateConnectionStatus({ status: 'disconnected' });
                }
            };
            
            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                switch(message.type) {
                    case 'data': handleDataMessage(message.payload); break;
                    case 'training_start': handleTrainingStart(message.payload); break;
                    case 'training_progress': updateTrainingProgress(message.payload); break;
                    case 'training_complete': handleTrainingComplete(message.payload); break;
                    case 'accuracy_update': renderAccuracyGauge(message.payload.accuracy); break;
                    case 'connection_update': updateConnectionStatus(message.payload); break;
                }
            };
            
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            startReconnection();
        }
    }
    
    function startReconnection() {
        if (reconnectInterval || connectionState === 'connecting') return; // Already trying to reconnect
        
        console.log('Starting reconnection attempts...');
        
        reconnectInterval = setInterval(() => {
            if (reconnectAttempts < maxReconnectAttempts && connectionState !== 'connected') {
                reconnectAttempts++;
                console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`);
                
                // Update the disconnection alert with reconnection status
                const reconnectQuotes = [
                    "Rebuilding connection, please wait...",
                    "Restoring your monitoring dashboard...",
                    "Reconnecting to keep you informed...",
                    "Getting back online for you...",
                    "Almost there, reconnecting now...",
                    "Establishing secure connection..."
                ];
                const randomReconnectQuote = reconnectQuotes[Math.floor(Math.random() * reconnectQuotes.length)];
                
                const alertData = { 
                    title: 'Reconnecting System', 
                    message: `${randomReconnectQuote} (Attempt ${reconnectAttempts} of ${maxReconnectAttempts})`, 
                    type: 'danger',
                    priority: 'critical'
                };
                createCriticalAlert('websocket-disconnected', alertData, activeConnectionAlerts, null);
                
                connectWebSocket();
            } else if (connectionState === 'connected') {
                // Successfully reconnected, stop the interval
                clearInterval(reconnectInterval);
                reconnectInterval = null;
                reconnectAttempts = 0;
            } else {
                // Max attempts reached
                console.error('Max reconnection attempts reached');
                clearInterval(reconnectInterval);
                reconnectInterval = null;
                
                // Update alert to show failed reconnection
                const alertData = { 
                    title: 'Connection Unavailable', 
                    message: 'Unable to restore connection to the monitoring system. Please check your internet connection and refresh the page, or contact your system administrator.', 
                    type: 'danger',
                    priority: 'critical'
                };
                createCriticalAlert('websocket-disconnected', alertData, activeConnectionAlerts, null);
            }
        }, reconnectDelay);
    }
    
    // Initialize WebSocket connection
    connectWebSocket();
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        switch(message.type) {
            case 'data': handleDataMessage(message.payload); break;
            case 'training_start': handleTrainingStart(message.payload); break;
            case 'training_progress': updateTrainingProgress(message.payload); break;
            case 'training_complete': handleTrainingComplete(message.payload); break;
            case 'accuracy_update': renderAccuracyGauge(message.payload.accuracy); break;
            case 'connection_update': updateConnectionStatus(message.payload); break;
        }
    };
    
    // --- UI LOGIC ---
    trainButton.addEventListener('click', () => { 
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'start_training' })); 
        } else {
            console.error('WebSocket not connected');
            createAlert('websocket-error', {
                title: 'Action Unavailable',
                message: 'Cannot start model training while disconnected from the system. Please wait for reconnection.',
                type: 'warning'
            }, activeSensorAlerts, 5000);
        }
    });
    
    function updateConnectionStatus(payload) {
        if (!connectionStatusEl || !connectionTextEl) return;
        
        const status = payload.status || 'disconnected';
        connectionStatusEl.className = `connection-status ${status}`;
        
        switch(status) {
            case 'connected':
                const portName = payload.port ? payload.port.split('/').pop() || payload.port : 'Unknown';
                connectionTextEl.textContent = `Connected (${portName})`;
                
                // Clear Arduino disconnection alert when Arduino reconnects
                dismissAlert('arduino-disconnected', activeConnectionAlerts);
                
                // Show Arduino reconnection acknowledgment
                createAlert('arduino-reconnected', {
                    title: 'Arduino Connected',
                    message: `Water quality sensors are now online and monitoring on ${portName}.`,
                    type: 'email-sent'
                }, activeSensorAlerts, 3000); // 3 second timeout
                
                break;
            case 'scanning':
                connectionTextEl.textContent = 'Scanning...';
                break;
            case 'disconnected':
            default:
                connectionTextEl.textContent = 'Disconnected';
                
                // Show persistent Arduino disconnection alert
                showArduinoDisconnectionAlert();
                break;
        }
    }

    function handleTrainingStart(payload) {
        trainButton.style.display = 'none';
        if(accuracyGaugeContainer) accuracyGaugeContainer.style.display = 'none';
        if(progressContainer) progressContainer.style.display = 'flex';
        progressBarFill.style.width = '0%';
        progressBarText.textContent = 'Initiating...';
        const totalDuration = payload.estimatedDuration;
        let elapsed = 0;
        clearInterval(trainingInterval);
        trainingInterval = setInterval(() => {
            elapsed += 1000;
            const remaining = Math.max(0, totalDuration - elapsed);
            const minutes = Math.floor(remaining / 60000);
            const seconds = ((remaining % 60000) / 1000).toFixed(0);
            timeRemainingText.textContent = `~ ${minutes}:${seconds < 10 ? '0' : ''}${seconds} remaining`;
        }, 1000);
    }
    function updateTrainingProgress(payload) { progressBarFill.style.width = `${payload.progress}%`; progressBarText.textContent = `${payload.step} (${payload.progress}%)`; }
    function handleTrainingComplete(payload) {
        clearInterval(trainingInterval);
        progressBarFill.style.width = '100%';
        progressBarText.textContent = payload.status === 'success' ? 'Complete!' : 'Failed!';
        timeRemainingText.textContent = payload.message;
        setTimeout(() => {
            trainButton.style.display = 'block';
            if(accuracyGaugeContainer) accuracyGaugeContainer.style.display = 'flex';
            if(progressContainer) progressContainer.style.display = 'none';
        }, 3000);
    }
    function renderAccuracyGauge(accuracy) {
        if (!accuracyGaugeContainer) return;
        const percentage = accuracy * 100;
        accuracyGaugeText.textContent = `${percentage.toFixed(1)}%`;
        const circumference = 2 * Math.PI * 45;
        const offset = circumference * (1 - accuracy);
        accuracyGaugeFill.style.strokeDashoffset = offset;
        if (percentage < 50) accuracyGaugeFill.style.stroke = 'var(--danger-color)';
        else if (percentage < 75) accuracyGaugeFill.style.stroke = 'var(--warning-color)';
        else accuracyGaugeFill.style.stroke = 'var(--safe-color)';
    }
    // Show persistent disconnection alert
    function showDisconnectionAlert() {
        const quotes = [
            "Stay calm, we're working to restore your connection.",
            "Every connection lost is a step closer to a stronger one.",
            "Patience is the key to reconnection.",
            "We're bringing you back online, one moment at a time.",
            "Connection interrupted, but not your progress.",
            "Reconnecting... because every second matters.",
            "Hold tight, we're rebuilding the bridge to your data."
        ];
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
        
        const alertData = { 
            title: 'System Disconnected', 
            message: `Connection to the monitoring system has been lost. ${randomQuote}`, 
            type: 'danger',
            priority: 'critical' // Mark as critical priority
        };
        // Create persistent critical alert (no timeout - will stay until manually dismissed)
        createCriticalAlert('websocket-disconnected', alertData, activeConnectionAlerts, null);
    }
    
    function showArduinoDisconnectionAlert() {
        const quotes = [
            "Sensors temporarily offline, attempting to reconnect...",
            "Water quality monitoring paused, restoring connection...",
            "Arduino sensors disconnected, working to restore monitoring...",
            "Monitoring equipment offline, reconnection in progress...",
            "Sensor connection lost, system is working to restore service...",
            "Hardware disconnected, please wait while we reconnect..."
        ];
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
        
        const alertData = { 
            title: 'Sensors Disconnected', 
            message: `Arduino water quality sensors have been disconnected. ${randomQuote}`, 
            type: 'danger',
            priority: 'critical'
        };
        // Create persistent critical alert (no timeout - will stay until Arduino reconnects)
        createCriticalAlert('arduino-disconnected', alertData, activeConnectionAlerts, null);
    }
    
    function handleDataMessage(payload) {
        clearTimeout(connectionTimeout);
        // Clear both types of connection alerts when data is received
        dismissAlert('connection-status', activeSensorAlerts);
        dismissAlert('websocket-disconnected', activeConnectionAlerts);
        dismissAlert('arduino-disconnected', activeConnectionAlerts);
        
        connectionTimeout = setTimeout(() => {
            const alertData = { 
                title: 'Sensor Data Delayed', 
                message: 'Water quality sensors are not responding. Checking connection to monitoring equipment...', 
                type: 'warning' 
            };
            createAlert('connection-status', alertData, activeSensorAlerts, 10000); // 10 second timeout for data alerts
        }, 5000);
        
        const newPoint = { ...payload, timestamp: new Date(payload.timestamp) };
        historicalData.push(newPoint);
        updateLiveData(newPoint);
        updatePredictionDashboardFromData(newPoint);
        
        // Update suggestions and prevention methods with new data
        updateSuggestions();
        updatePreventionMethods();
        
        if (currentFilter === 'live') allCharts.forEach(chart => chart.addDataPoint(getChartPoint(newPoint, chart)));
    }
    function updateLiveData(data) {
        if (!data || !tdsValueEl || !phValueEl || !turbidityValueEl) return;
        
        // Update values with proper null checks
        const tdsValue = parseFloat(data.tds) || 0;
        const phValue = parseFloat(data.ph) || 0;
        const turbidityValue = parseFloat(data.turbidity) || 0;
        
        tdsValueEl.textContent = tdsValue.toFixed(1);
        phValueEl.textContent = phValue.toFixed(1);
        turbidityValueEl.textContent = turbidityValue.toFixed(1);
        
        // Update status indicators
        if (tdsStatusEl) {
            let tdsStatus = getStatus(tdsValue, { safe: 500, warn: 1000 });
            tdsStatusEl.textContent = tdsStatus.text;
            tdsStatusEl.className = `data-status ${tdsStatus.level}`;
            manageSensorAlert('TDS', tdsStatus.level, tdsValue.toFixed(1));
        }
        
        if (phStatusEl) {
            let phStatus = getStatus(phValue, { safeMin: 6.5, safeMax: 8.5 });
            phStatusEl.textContent = phStatus.text;
            phStatusEl.className = `data-status ${phStatus.level}`;
            manageSensorAlert('pH', phStatus.level, phValue.toFixed(1));
        }
        
        if (turbidityStatusEl) {
            let turbidityStatus = getStatus(turbidityValue, { safe: 4, warn: 8 });
            turbidityStatusEl.textContent = turbidityStatus.text;
            turbidityStatusEl.className = `data-status ${turbidityStatus.level}`;
            manageSensorAlert('Turbidity', turbidityStatus.level, turbidityValue.toFixed(1));
        }
        
        // Update progress rings with status-based colors
        if (tdsProgressEl) {
            const tdsStatus = getStatus(tdsValue, { safe: 500, warn: 1000 });
            updateProgressRing(tdsProgressEl, tdsValue, 1000, tdsStatus.level);
        }
        if (phProgressEl) {
            const phStatus = getStatus(phValue, { safeMin: 6.5, safeMax: 8.5 });
            updateProgressRing(phProgressEl, phValue, 14, phStatus.level);
        }
        if (turbidityProgressEl) {
            const turbidityStatus = getStatus(turbidityValue, { safe: 4, warn: 8 });
            updateProgressRing(turbidityProgressEl, turbidityValue, 20, turbidityStatus.level);
        }
    }
    const alertContainer = document.getElementById('alert-container');
    
    // --- UPDATED ALERT MANAGEMENT ---
    function manageDiseaseAlerts(predictions) {
        const HIGH_RISK_THRESHOLD = 50;
        const RESOLVED_RISK_THRESHOLD = 40;
        
        for (const [disease, data] of Object.entries(predictions)) {
            const probability = (data.probability || 0) * 100;
            const diseaseKey = `disease-${disease.replace(/[^a-zA-Z0-9]/g, '-')}`;
            
            if (probability >= HIGH_RISK_THRESHOLD) {
                const alertData = { 
                    title: 'High Disease Risk', 
                    message: `${disease}: <strong>${probability.toFixed(1)}%</strong> probability.`, 
                    type: 'danger' 
                };
                createAlert(diseaseKey, alertData, activeDiseaseAlerts, 5000);
            } else if (probability < RESOLVED_RISK_THRESHOLD && activeDiseaseAlerts.has(diseaseKey)) {
                // Only dismiss if the alert has been active for at least 5 seconds
                const alertInfo = activeDiseaseAlerts.get(diseaseKey);
                const alertAge = Date.now() - alertInfo.createdAt;
                
                if (alertAge >= 5000) {
                    dismissAlert(diseaseKey, activeDiseaseAlerts);
                } else {
                    // Set a timeout to dismiss when the 5-second cooldown is reached
                    clearTimeout(alertInfo.timeoutId);
                    alertInfo.timeoutId = setTimeout(() => {
                        dismissAlert(diseaseKey, activeDiseaseAlerts);
                    }, 5000 - alertAge);
                    activeDiseaseAlerts.set(diseaseKey, alertInfo);
                }
            }
        }
    }

    function manageSensorAlert(parameter, level, value) {
        const parameterKey = `sensor-${parameter}`;
        
        if (level === 'warning' || level === 'danger') {
            const alertData = { 
                title: `${parameter} Alert`, 
                message: `Reading of <strong>${value}</strong> is outside safe range.`, 
                type: level === 'danger' ? 'danger' : 'warning' 
            };
            createAlert(parameterKey, alertData, activeSensorAlerts, 5000);
        } else if (level === 'safe' && activeSensorAlerts.has(parameterKey)) {
            // Only dismiss if the alert has been active for at least 5 seconds
            const alertInfo = activeSensorAlerts.get(parameterKey);
            const alertAge = Date.now() - alertInfo.createdAt;
            
            if (alertAge >= 5000) {
                dismissAlert(parameterKey, activeSensorAlerts);
            } else {
                // Set a timeout to dismiss when the 5-second cooldown is reached
                clearTimeout(alertInfo.timeoutId);
                alertInfo.timeoutId = setTimeout(() => {
                    dismissAlert(parameterKey, activeSensorAlerts);
                }, 5000 - alertAge);
                activeSensorAlerts.set(parameterKey, alertInfo);
            }
        }
    }

    // Create critical alerts that stay on top and are persistent
    function createCriticalAlert(key, data, alertMap, timeout = null) {
        // If alert already exists, update its content and reset timer
        if (alertMap.has(key)) {
            const alertInfo = alertMap.get(key);
            
            // Don't update if alert is being dismissed
            if (alertInfo.element.classList.contains('dismissing')) {
                return;
            }
            
            clearTimeout(alertInfo.timeoutId);
            
            // Update existing alert content with smooth transition
            alertInfo.element.style.opacity = '0.7';
            setTimeout(() => {
                if (alertInfo.element.parentNode) {
                    alertInfo.element.innerHTML = `<div class="alert-popup-title">${data.title}</div><div class="alert-popup-message">${data.message}</div>`;
                    alertInfo.element.style.opacity = '1';
                    // Ensure critical alert stays on top
                    alertContainer.prepend(alertInfo.element);
                }
            }, 150);
            
            if (timeout) {
                alertInfo.timeoutId = setTimeout(() => {
                    dismissAlert(key, alertMap);
                }, timeout);
            } else {
                alertInfo.timeoutId = null; // Persistent alert
            }
            
            alertMap.set(key, alertInfo);
            return;
        }
        
        // Create new critical alert
        const alertEl = document.createElement('div'); 
        alertEl.id = key; 
        let alertClass = `alert-popup ${data.type} critical-alert`;
        if (timeout === null) {
            alertClass += ' persistent'; // Add persistent class for styling
        }
        alertEl.className = alertClass;
        alertEl.innerHTML = `<div class="alert-popup-title">${data.title}</div><div class="alert-popup-message">${data.message}</div>`;
        
        // Critical alerts are added immediately and always on top
        if (alertContainer) {
            alertContainer.prepend(alertEl);
        }
        
        let timeoutId = null; 
        if (timeout) { 
            timeoutId = setTimeout(() => dismissAlert(key, alertMap), timeout); 
        }
        
        alertMap.set(key, { 
            element: alertEl, 
            timeoutId: timeoutId,
            createdAt: Date.now(),
            isCritical: true
        });
    }

    function createAlert(key, data, alertMap, timeout = null) {
        // If alert already exists, update its content and reset timer
        if (alertMap.has(key)) {
            const alertInfo = alertMap.get(key);
            
            // Don't update if alert is being dismissed
            if (alertInfo.element.classList.contains('dismissing')) {
                return;
            }
            
            clearTimeout(alertInfo.timeoutId);
            
            // Update existing alert content with smooth transition
            alertInfo.element.style.opacity = '0.7';
            setTimeout(() => {
                if (alertInfo.element.parentNode) {
                    alertInfo.element.innerHTML = `<div class="alert-popup-title">${data.title}</div><div class="alert-popup-message">${data.message}</div>`;
                    alertInfo.element.style.opacity = '1';
                }
            }, 150);
            
            if (timeout) {
                alertInfo.timeoutId = setTimeout(() => {
                    dismissAlert(key, alertMap);
                }, timeout);
            } else {
                alertInfo.timeoutId = null; // Persistent alert
            }
            
            alertMap.set(key, alertInfo);
            return;
        }
        
        // Create new alert
        const alertEl = document.createElement('div'); 
        alertEl.id = key; 
        let alertClass = `alert-popup ${data.type}`;
        if (timeout === null) {
            alertClass += ' persistent'; // Add persistent class for styling
        }
        alertEl.className = alertClass;
        alertEl.innerHTML = `<div class="alert-popup-title">${data.title}</div><div class="alert-popup-message">${data.message}</div>`;
        
        // Add with slight delay to prevent rapid flickering
        // But ensure critical alerts stay on top
        setTimeout(() => {
            if (alertContainer) {
                // Check if there are critical alerts and add after them
                const criticalAlerts = alertContainer.querySelectorAll('.critical-alert');
                if (criticalAlerts.length > 0) {
                    // Insert after the last critical alert
                    const lastCritical = criticalAlerts[criticalAlerts.length - 1];
                    lastCritical.insertAdjacentElement('afterend', alertEl);
                } else {
                    alertContainer.prepend(alertEl);
                }
            }
        }, 50);
        
        let timeoutId = null; 
        if (timeout) { 
            timeoutId = setTimeout(() => dismissAlert(key, alertMap), timeout); 
        }
        
        alertMap.set(key, { 
            element: alertEl, 
            timeoutId: timeoutId,
            createdAt: Date.now()
        });
    }

    function dismissAlert(key, alertMap) {
        if (alertMap.has(key)) {
            const alertInfo = alertMap.get(key);
            const { element, timeoutId } = alertInfo;
            
            // Prevent multiple dismissals of the same alert
            if (element.classList.contains('dismissing')) {
                return;
            }
            
            clearTimeout(timeoutId);
            element.classList.add('dismissing');
            
            // Remove from map immediately to prevent duplicate operations
            alertMap.delete(key);
            
            setTimeout(() => { 
                if (element.parentNode) {
                    element.remove(); 
                }
            }, 500);
        }
    }
    
    filterButtons.forEach(button => { button.addEventListener('click', () => { currentFilter = button.dataset.filter; filterButtons.forEach(btn => btn.classList.remove('active')); button.classList.add('active'); filterData(currentFilter); }); });
    function filterData(filter) {
        const now = new Date(); let startTime, timeUnit = 'minute';
        if (filter === 'live') { tdsChart.setLiveData(historicalData.map(d => ({ x: d.timestamp, y: d.tds }))); phChart.setLiveData(historicalData.map(d => ({ x: d.timestamp, y: d.ph }))); turbidityChart.setLiveData(historicalData.map(d => ({ x: d.timestamp, y: d.turbidity }))); return; }
        switch (filter) {
            case '10m': startTime = new Date(now.getTime() - 10 * 60 * 1000); break;
            case '1h': startTime = new Date(now.getTime() - 60 * 60 * 1000); timeUnit = 'hour'; break;
            case '1d': startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); timeUnit = 'hour'; break;
            case '7d': startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); timeUnit = 'day'; break;
            case '30d': startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); timeUnit = 'day'; break;
        }
        const filtered = historicalData.filter(d => d.timestamp >= startTime);
        const aggregated = aggregateData(filtered, filter);
        tdsChart.setData(aggregated.map(d => ({ x: d.timestamp, y: d.tds })), timeUnit); phChart.setData(aggregated.map(d => ({ x: d.timestamp, y: d.ph })), timeUnit); turbidityChart.setData(aggregated.map(d => ({ x: d.timestamp, y: d.turbidity })), timeUnit);
    }
    function aggregateData(data, filter) {
        if (!data || data.length === 0) return []; let aggregationUnit;
        if (filter === '1d') { aggregationUnit = 'hour'; } else if (filter === '7d' || filter === '30d') { aggregationUnit = 'day'; } else { return data; }
        const aggregated = new Map();
        const getKey = (date, unit) => { const d = new Date(date); d.setMilliseconds(0); d.setSeconds(0); d.setMinutes(0); if (unit === 'day') d.setHours(0); return d.getTime(); };
        for (const d of data) {
            const key = getKey(d.timestamp, aggregationUnit);
            if (!aggregated.has(key)) { aggregated.set(key, { tds: [], ph: [], turbidity: [], timestamp: new Date(key) }); }
            const group = aggregated.get(key); group.tds.push(d.tds); group.ph.push(d.ph); group.turbidity.push(d.turbidity);
        }
        return Array.from(aggregated.values()).map(group => ({ timestamp: group.timestamp, tds: group.tds.reduce((a, b) => a + b, 0) / group.tds.length, ph: group.ph.reduce((a, b) => a + b, 0) / group.ph.length, turbidity: group.turbidity.reduce((a, b) => a + b, 0) / group.turbidity.length }));
    }
    
    // --- SUGGESTIONS LOGIC (Now shows all three parameters) ---
    function generateSuggestions(dataForAnalysis) {
        const suggestions = [];
        const totalReadings = dataForAnalysis.length;

        if (totalReadings < 3) { 
            return [{ parameter: 'System', text: 'Collecting more data to generate reliable suggestions...', severity: 'safe', solution: 'Please wait for more sensor readings.' }];
        }
        
        // Add timestamp info to suggestions
        const timeRange = totalReadings >= 10 ? 'last hour' : totalReadings >= 5 ? 'last 30 minutes' : 'recent readings';
        console.log(`Generating suggestions based on ${totalReadings} readings from ${timeRange}`);

        const analyzeParameter = (data, name, thresholds) => {
            const values = data.map(d => d[name]);
            const avg = values.reduce((sum, v) => sum + v, 0) / totalReadings;
            const max = Math.max(...values);
            let warningCount = 0; let dangerCount = 0;
            for (const value of values) {
                const status = getStatus(value, thresholds);
                if (status.level === 'warning') warningCount++;
                if (status.level === 'danger') dangerCount++;
            }
            return { name, avg, max, warningPercent: (warningCount / totalReadings) * 100, dangerPercent: (dangerCount / totalReadings) * 100 };
        };

        const tdsAnalysis = analyzeParameter(dataForAnalysis, 'tds', { safe: 500, warn: 1000 });
        const phAnalysis = analyzeParameter(dataForAnalysis, 'ph', { safeMin: 6.5, safeMax: 8.5 });
        const turbidityAnalysis = analyzeParameter(dataForAnalysis, 'turbidity', { safe: 4, warn: 8 });

        // TDS Suggestions with current values
        const currentTDS = dataForAnalysis[dataForAnalysis.length - 1]?.tds || 0;
        if (tdsAnalysis.dangerPercent > 5 || tdsAnalysis.max > 1200 || currentTDS > 1000) {
            suggestions.push({ parameter: 'TDS', text: `High TDS detected! Current: ${currentTDS.toFixed(0)} ppm, Max: ${tdsAnalysis.max.toFixed(0)} ppm (${timeRange}).`, solution: 'SOLUTION: Immediate treatment like Reverse Osmosis (RO) is required. Check water source for contamination.', severity: 'danger' });
        } else if (tdsAnalysis.warningPercent > 15 || tdsAnalysis.avg > 500 || currentTDS > 500) {
            suggestions.push({ parameter: 'TDS', text: `Elevated TDS levels. Current: ${currentTDS.toFixed(0)} ppm, Average: ${tdsAnalysis.avg.toFixed(0)} ppm (${timeRange}).`, solution: 'SOLUTION: Consider installing an RO or distillation water filter. Monitor source water quality.', severity: 'warning' });
        } else {
            suggestions.push({ parameter: 'TDS', text: `TDS levels are acceptable. Current: ${currentTDS.toFixed(0)} ppm, Average: ${tdsAnalysis.avg.toFixed(0)} ppm (${timeRange}).`, solution: 'Continue regular monitoring. No immediate action required.', severity: 'safe' });
        }

        // pH Suggestions with current values
        const currentPH = dataForAnalysis[dataForAnalysis.length - 1]?.ph || 0;
        if (phAnalysis.dangerPercent > 5 || currentPH < 5.5 || currentPH > 9.5) {
            const phIssue = currentPH < 6.5 ? 'too acidic' : 'too alkaline';
            suggestions.push({ parameter: 'pH', text: `pH is ${phIssue}! Current: ${currentPH.toFixed(1)}, Average: ${phAnalysis.avg.toFixed(1)} (${timeRange}).`, solution: `SOLUTION: ${currentPH < 6.5 ? 'Use calcite filter or soda ash to raise pH' : 'Use neutralizing acid to lower pH'}. This can cause corrosion or scaling.`, severity: 'danger' });
        } else if (phAnalysis.warningPercent > 20 || currentPH < 6.5 || currentPH > 8.5) {
            suggestions.push({ parameter: 'pH', text: `pH levels need attention. Current: ${currentPH.toFixed(1)}, Average: ${phAnalysis.avg.toFixed(1)} (${timeRange}).`, solution: 'SOLUTION: Monitor closely and consider pH adjustment if trend continues. Check water source.', severity: 'warning' });
        } else {
             suggestions.push({ parameter: 'pH', text: `pH levels are balanced. Current: ${currentPH.toFixed(1)}, Average: ${phAnalysis.avg.toFixed(1)} (${timeRange}).`, solution: 'Maintain current water treatment. Continue monitoring.', severity: 'safe' });
        }

        // Turbidity Suggestions with current values
        const currentTurbidity = dataForAnalysis[dataForAnalysis.length - 1]?.turbidity || 0;
        if (turbidityAnalysis.dangerPercent > 5 || turbidityAnalysis.max > 10 || currentTurbidity > 8) {
            suggestions.push({ parameter: 'Turbidity', text: `High turbidity detected! Current: ${currentTurbidity.toFixed(1)} NTU, Max: ${turbidityAnalysis.max.toFixed(1)} NTU (${timeRange}).`, solution: 'SOLUTION: Check for sediment runoff. Clean/replace filters immediately. Boil water before consumption.', severity: 'danger' });
        } else if (turbidityAnalysis.warningPercent > 15 || turbidityAnalysis.avg > 4 || currentTurbidity > 4) {
            suggestions.push({ parameter: 'Turbidity', text: `Water clarity needs improvement. Current: ${currentTurbidity.toFixed(1)} NTU, Average: ${turbidityAnalysis.avg.toFixed(1)} NTU (${timeRange}).`, solution: 'SOLUTION: Clean or replace sediment filters. Check water source for contamination. Consider pre-filtration.', severity: 'warning' });
        } else {
             suggestions.push({ parameter: 'Turbidity', text: `Water is clear. Current: ${currentTurbidity.toFixed(1)} NTU, Average: ${turbidityAnalysis.avg.toFixed(1)} NTU (${timeRange}).`, solution: 'Water clarity is good. Maintain current filtration system.', severity: 'safe' });
        }

        return suggestions;
    }

    function renderSuggestions(suggestions) {
        if (!suggestionsListEl) return;
        suggestionsListEl.innerHTML = '';
        if (!suggestions || suggestions.length === 0) { suggestionsListEl.innerHTML = `<div class="no-suggestions">No suggestions at this time.</div>`; return; }
        
        suggestions.forEach(suggestion => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            const iconSVG = { safe: `<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`, warning: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`, danger: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` };
            
            item.innerHTML = `
                <div class="suggestion-icon ${suggestion.severity}">${iconSVG[suggestion.severity]}</div>
                <div class="suggestion-content">
                    <div class="parameter">${suggestion.parameter}</div>
                    <div class="text">${suggestion.text}</div>
                    <div class="solution">${suggestion.solution}</div>
                </div>
            `;
            suggestionsListEl.appendChild(item);
        });
        
        // Check for high-severity suggestions and send email alert
        checkMaintenanceAlerts(suggestions);
    }
    
    // --- EMAIL ALERT FUNCTIONS ---
    async function checkMaintenanceAlerts(suggestions) {
        const highSeveritySuggestions = suggestions.filter(s => s.severity === 'danger' || s.severity === 'warning');
        
        if (highSeveritySuggestions.length > 0) {
            console.log('High severity maintenance issues detected, sending email alert...');
            try {
                const response = await fetch('/api/maintenance-alert', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ suggestions: highSeveritySuggestions })
                });
                
                const result = await response.json();
                if (result.success) {
                    console.log('Maintenance alert email sent successfully');
                    // Show user notification
                    createAlert('maintenance-email-sent', {
                        title: 'Maintenance Alert Sent',
                        message: `Email notifications sent for ${highSeveritySuggestions.length} maintenance issue(s). (1-min cooldown per parameter)`,
                        type: 'email-sent'
                    }, activeSensorAlerts, 8000);
                } else {
                    console.error('Maintenance alert processing:', result.message);
                    // Show cooldown status if available
                    if (result.message.includes('cooldown')) {
                        createAlert('maintenance-cooldown', {
                            title: 'Maintenance Alert in Cooldown',
                            message: result.message,
                            type: 'warning'
                        }, activeSensorAlerts, 5000);
                    }
                }
            } catch (error) {
                console.error('Error sending maintenance alert:', error);
            }
        }
    }
    
    async function checkHealthAlerts(predictions) {
        const highRiskDiseases = Object.entries(predictions)
            .filter(([disease, data]) => (data.probability * 100) > 70);
        
        if (highRiskDiseases.length > 0) {
            console.log('High disease risk detected, sending critical health alert...');
            
            // Convert to the format expected by backend
            const diseaseData = {};
            highRiskDiseases.forEach(([disease, data]) => {
                diseaseData[disease] = data;
            });
            
            try {
                const response = await fetch('/api/health-alert', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ diseaseData })
                });
                
                const result = await response.json();
                if (result.success) {
                    console.log('Critical health alert email sent successfully');
                    // Show critical user notification
                    createAlert('health-email-sent', {
                        title: 'CRITICAL HEALTH ALERT SENT',
                        message: `Emergency notifications sent for ${highRiskDiseases.length} high-risk disease(s) above 70% threshold. (1-min cooldown per disease)`,
                        type: 'email-sent'
                    }, activeDiseaseAlerts, 15000);
                } else {
                    console.error('Health alert processing:', result.message);
                    // Show cooldown status if available
                    if (result.message.includes('cooldown')) {
                        createAlert('health-cooldown', {
                            title: 'Health Alert in Cooldown',
                            message: result.message,
                            type: 'warning'
                        }, activeDiseaseAlerts, 8000);
                    }
                }
            } catch (error) {
                console.error('Error sending health alert:', error);
            }
        }
    }
    
    // Check email status and log cooldown information
    async function checkEmailStatus() {
        try {
            const response = await fetch('/api/email-status');
            const status = await response.json();
            
            if (!status.emailEnabled) {
                console.log('📧 Email functionality disabled');
                return;
            }
            
            // Log parameters in cooldown
            const maintenanceInCooldown = Object.entries(status.maintenance)
                .filter(([param, info]) => !info.canSend)
                .map(([param, info]) => `${param}: ${info.cooldownRemainingSeconds}s`);
                
            const healthInCooldown = Object.entries(status.health)
                .filter(([disease, info]) => !info.canSend)
                .map(([disease, info]) => `${disease}: ${info.cooldownRemainingSeconds}s`);
            
            if (maintenanceInCooldown.length > 0 || healthInCooldown.length > 0) {
                console.log(`📧 Email cooldowns (${status.cooldownMinutes}min each):`);
                if (maintenanceInCooldown.length > 0) {
                    console.log(`   Maintenance: ${maintenanceInCooldown.join(', ')}`);
                }
                if (healthInCooldown.length > 0) {
                    console.log(`   Health: ${healthInCooldown.join(', ')}`);
                }
            }
        } catch (error) {
            console.error('Error checking email status:', error);
        }
    }

    function updateSuggestions() {
        console.log('Updating maintenance suggestions...');
        
        // Show updating indicator
        if (suggestionsListEl) {
            suggestionsListEl.style.opacity = '0.7';
        }
        
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
        let dataForAnalysis = historicalData.filter(d => d.timestamp >= oneHourAgo);
        
        // If not enough recent data, use last 30 minutes
        if (dataForAnalysis.length < 5) {
            const thirtyMinutesAgo = new Date(now.getTime() - (30 * 60 * 1000));
            dataForAnalysis = historicalData.filter(d => d.timestamp >= thirtyMinutesAgo);
        }
        
        // If still not enough, use last 10 data points
        if (dataForAnalysis.length < 3) {
            dataForAnalysis = historicalData.slice(-10);
        }
        
        console.log(`Analyzing ${dataForAnalysis.length} data points for suggestions`);
        renderSuggestions(generateSuggestions(dataForAnalysis));
        
        // Restore opacity
        if (suggestionsListEl) {
            suggestionsListEl.style.opacity = '1';
        }
    }
    
    // --- DISEASE PREVENTION SECTION ---
    const diseasePreventionInfo = {
        'Cholera': ["Drink only bottled, boiled, or chemically disinfected water.", "Wash hands often with soap and clean water.", "Cook food well, keep it covered, and eat it hot."],
        'Typhoid': ["Get vaccinated against typhoid fever.", "Avoid risky foods and drinks; choose hot foods.", "Ensure water is properly treated (boiled or disinfected)."],
        'Hepatitis A': ["Hepatitis A vaccination is the most effective prevention.", "Always wash hands with soap and water after using the bathroom.", "Avoid raw or undercooked shellfish."],
        'Dysentery': ["Frequent handwashing with soap is the most important prevention.", "Avoid swallowing water from ponds, lakes, or untreated pools.", "Ensure food is cooked thoroughly."],
        'Diarrheal': ["Practice good hygiene, including thorough handwashing.", "Ensure access to safe drinking-water and improved sanitation.", "Promote exclusive breastfeeding for infants."],
        'Default': ["All disease risks are currently low.", "General prevention includes ensuring water is boiled or filtered.", "Practice regular handwashing with soap."]
    };
    
    function updatePreventionMethods() {
        if (!preventionListEl) return;
        console.log('Updating disease prevention methods...');
        
        const now = new Date();
        let dataForAnalysis = [];
        let timeFrame = '';
        
        // Try different time frames to get enough data
        const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        dataForAnalysis = historicalData.filter(d => d.timestamp >= twentyFourHoursAgo);
        timeFrame = '24h';
        
        if (dataForAnalysis.length < 5) {
            const sixHoursAgo = new Date(now.getTime() - (6 * 60 * 60 * 1000));
            dataForAnalysis = historicalData.filter(d => d.timestamp >= sixHoursAgo);
            timeFrame = '6h';
        }
        
        if (dataForAnalysis.length < 3) {
            dataForAnalysis = historicalData.slice(-10);
            timeFrame = 'recent';
        }
        
        console.log(`Analyzing ${dataForAnalysis.length} data points for prevention methods (${timeFrame})`);
        
        if (dataForAnalysis.length < 1) { 
            renderPreventionMethods('Default', timeFrame); 
            return; 
        }
        
        const averageProbabilities = { 'Cholera': 0, 'Typhoid': 0, 'Hepatitis A': 0, 'Dysentery': 0, 'Diarrheal': 0 };
        const diseaseKeys = { 'Cholera': 'cholera_prob', 'Typhoid': 'typhoid_prob', 'Hepatitis A': 'hepatitis_a_prob', 'Dysentery': 'dysentery_prob', 'Diarrheal': 'diarrheal_prob' };
        
        // Calculate averages
        for (const disease in averageProbabilities) { 
            const key = diseaseKeys[disease]; 
            averageProbabilities[disease] = dataForAnalysis.reduce((sum, d) => sum + (d[key] || 0), 0) / dataForAnalysis.length; 
        }
        
        // Also check current/latest values for immediate risks
        const latestData = dataForAnalysis[dataForAnalysis.length - 1];
        const currentProbabilities = {
            'Cholera': latestData?.cholera_prob || 0,
            'Typhoid': latestData?.typhoid_prob || 0,
            'Hepatitis A': latestData?.hepatitis_a_prob || 0,
            'Dysentery': latestData?.dysentery_prob || 0,
            'Diarrheal': latestData?.diarrheal_prob || 0
        };
        
        let mostOccurringDisease = 'Default'; 
        let maxProb = 0.03; // Lower threshold for more responsive updates
        
        // Check both average and current probabilities
        for (const disease in averageProbabilities) { 
            const avgProb = averageProbabilities[disease];
            const currentProb = currentProbabilities[disease];
            const maxOfBoth = Math.max(avgProb, currentProb);
            
            if (maxOfBoth > maxProb) { 
                maxProb = maxOfBoth; 
                mostOccurringDisease = disease; 
            } 
        }
        
        console.log(`Primary disease focus: ${mostOccurringDisease} (probability: ${(maxProb * 100).toFixed(1)}%)`);
        renderPreventionMethods(mostOccurringDisease, timeFrame, maxProb);
    }

    function renderPreventionMethods(diseaseName, timeFrame = '24h', probability = 0) {
        if (!preventionListEl) return;
        const preventionTips = diseasePreventionInfo[diseaseName] || diseasePreventionInfo['Default'];
        
        // Create dynamic header with more information
        const probabilityText = diseaseName !== 'Default' ? ` (${(probability * 100).toFixed(1)}% risk)` : '';
        const focusClass = diseaseName === 'Default' ? 'safe' : probability > 0.1 ? 'danger' : 'warning';
        
        preventionListEl.innerHTML = `
            <div class="disease-focus">
                <span class="focus-label">Primary Focus (${timeFrame}):</span>
                <span class="focus-name ${focusClass}">${diseaseName}${probabilityText}</span>
            </div>
        `;
        
        const list = document.createElement('ul'); 
        list.className = 'prevention-list';
        
        // Add timestamp for when this was last updated
        const updateTime = new Date().toLocaleTimeString();
        const updateItem = document.createElement('li');
        updateItem.className = 'prevention-item update-time';
        updateItem.innerHTML = `<svg class="prevention-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12,6 12,12 16,14"></polyline></svg><span style="font-style: italic; opacity: 0.8;">Last updated: ${updateTime}</span>`;
        list.appendChild(updateItem);
        
        preventionTips.forEach(tip => {
            const item = document.createElement('li'); 
            item.className = 'prevention-item';
            item.innerHTML = `<svg class="prevention-icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg><span>${tip}</span>`;
            list.appendChild(item);
        });
        
        preventionListEl.appendChild(list);
    }
    
    // --- HELPER FUNCTIONS ---
    function updatePredictionDashboardFromData(data) { 
        const predictions = { 
            'Cholera': { probability: data.cholera_prob || 0.01 }, 
            'Typhoid': { probability: data.typhoid_prob || 0.01 }, 
            'Hepatitis A': { probability: data.hepatitis_a_prob || 0.01 }, 
            'Dysentery': { probability: data.dysentery_prob || 0.01 }, 
            'Diarrheal': { probability: data.diarrheal_prob || 0.01 }, 
        }; 
        updatePredictionDashboard(predictions); 
        manageDiseaseAlerts(predictions);
        
        // Check for critical health alerts (>70% risk)
        checkHealthAlerts(predictions);
    }
    function updatePredictionDashboard(predictions) {const container = document.getElementById('disease-cards-container'); if (!container) return; container.innerHTML = ''; for (const [disease, data] of Object.entries(predictions)) {if (!data || typeof data.probability !== 'number') continue; const card = document.createElement('div'); card.className = 'disease-card'; const probability = (data.probability * 100); let riskColor = 'var(--safe-color)'; if (probability > 60) riskColor = 'var(--danger-color)'; else if (probability > 30) riskColor = 'var(--warning-color)'; card.innerHTML = `<div class="disease-name">${disease.replace(/_/g, ' ')}</div><div class="risk-probability">${probability.toFixed(1)}%</div><div class="risk-bar"><div class="risk-fill" style="width: ${probability}%; background-color: ${riskColor};"></div></div>`; container.appendChild(card);}}
    function updateProgressRing(element, value, maxValue, statusLevel = 'safe') { 
        if (!element) {
            console.warn('Progress ring element not found');
            return;
        }
        
        const percentage = Math.min(value / maxValue, 1); 
        const offset = ringCircumference * (1 - percentage);
        
        console.log(`Updating progress ring: value=${value}, maxValue=${maxValue}, percentage=${percentage}, offset=${offset}`);
        
        element.style.strokeDashoffset = offset;
        
        // Set color based on status level
        switch(statusLevel) {
            case 'safe':
                element.style.stroke = 'var(--safe-color)';
                break;
            case 'warning':
                element.style.stroke = 'var(--warning-color)';
                break;
            case 'danger':
                element.style.stroke = 'var(--danger-color)';
                break;
            default:
                element.style.stroke = 'var(--primary-color)';
        }
    }
    function getChartPoint(point, chart) { if (chart.chart.data.datasets[0].label.includes('TDS')) return { x: point.timestamp, y: point.tds }; if (chart.chart.data.datasets[0].label.includes('pH')) return { x: point.timestamp, y: point.ph }; return { x: point.timestamp, y: point.turbidity }; }
    function getStatus(value, thresholds) {if (thresholds.safeMin !== undefined) {if (value >= thresholds.safeMin && value <= thresholds.safeMax) return { text: 'Normal', level: 'safe' }; if (value < 5.5 || value > 9.5) return { text: 'Danger', level: 'danger' }; return { text: 'Warning', level: 'warning' };} else {if (value <= thresholds.safe) return { text: 'Safe', level: 'safe' }; if (value <= thresholds.warn) return { text: 'Warning', 'level': 'warning' }; return { text: 'Danger', 'level': 'danger' };}}
    
    // --- INITIALIZATION ---
    // Initialize connection status
    updateConnectionStatus({ status: 'disconnected' });
    
    // Initialize progress rings with default values
    function initializeProgressRings() {
        console.log('Initializing progress rings...');
        console.log('TDS Progress Element:', tdsProgressEl);
        console.log('pH Progress Element:', phProgressEl);
        console.log('Turbidity Progress Element:', turbidityProgressEl);
        console.log('Ring Circumference:', ringCircumference);
        
        if (tdsProgressEl) {
            tdsProgressEl.style.strokeDasharray = ringCircumference;
            tdsProgressEl.style.strokeDashoffset = ringCircumference;
            tdsProgressEl.style.stroke = 'var(--primary-color)';
            console.log('TDS progress ring initialized');
        } else {
            console.error('TDS progress element not found!');
        }
        
        if (phProgressEl) {
            phProgressEl.style.strokeDasharray = ringCircumference;
            phProgressEl.style.strokeDashoffset = ringCircumference;
            phProgressEl.style.stroke = 'var(--primary-color)';
            console.log('pH progress ring initialized');
        } else {
            console.error('pH progress element not found!');
        }
        
        if (turbidityProgressEl) {
            turbidityProgressEl.style.strokeDasharray = ringCircumference;
            turbidityProgressEl.style.strokeDashoffset = ringCircumference;
            turbidityProgressEl.style.stroke = 'var(--primary-color)';
            console.log('Turbidity progress ring initialized');
        } else {
            console.error('Turbidity progress element not found!');
        }
    }
    
    initializeProgressRings();
    
    // Test progress rings with sample data after a short delay
    setTimeout(() => {
        console.log('Testing progress rings with sample data...');
        const testData = {
            tds: 480.0,
            ph: 7.8,
            turbidity: 6.1
        };
        updateLiveData(testData);
    }, 2000);
    
    fetchHistoricalData();
    
    // More frequent updates for better responsiveness
    setInterval(updateSuggestions, 30 * 1000); // Every 30 seconds
    setInterval(updatePreventionMethods, 45 * 1000); // Every 45 seconds
    
    // Check email status periodically
    setInterval(checkEmailStatus, 60 * 1000); // Every minute
    predictionRefreshInterval = setInterval(() => {
        if (historicalData.length > 0) {
            const latestData = historicalData[historicalData.length - 1];
            updatePredictionDashboardFromData(latestData);
        }
    }, 30000);
});