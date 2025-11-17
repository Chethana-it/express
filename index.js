const express = require('express')
const admin = require('firebase-admin')
const cron = require('node-cron')
const cors = require('cors')
const app = express();
const port = process.env.PORT || 3000;

// CORS enable karanna - BEFORE other middleware
app.use(cors()) 

// Body parser middleware add karanna - BEFORE routes
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Serve static files from root directory
app.use(express.static(__dirname))

// initialize firebase admin - SYNCHRONOUSLY
let firebaseInitialized = false;

(async () => {
    let serviceAccount;

    if (process.env.FIREBASE_CONFIG) {
        // Production - Environment variable eken
        console.log('🔐 Using Firebase config from environment variable');
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
            console.log('✅ Firebase config parsed successfully');
            console.log('📋 Project ID:', serviceAccount.project_id);
        } catch (error) {
            console.error('❌ Failed to parse FIREBASE_CONFIG:', error.message);
            process.exit(1);
        }
    } else {
        // Local development - JSON file eken
        console.log('🔐 Using Firebase config from local file');
        serviceAccount = require('./firebaseAdminConfig.json');
    }

    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase Admin initialized successfully');
        firebaseInitialized = true;
    } catch (error) {
        console.error('❌ Firebase initialization failed:', error.message);
        process.exit(1);
    }
})();

// SSE endpoint - Real-time updates walata
app.get('/currency-stream', (req, res) => {
    // SSE headers set karanna
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Initial data yawanna
    const sendCurrencyData = async () => {
        const db = admin.firestore();
        try {
            const snapshot = await db.collection('testCollection')
                .orderBy('fetchedAt', 'desc')
                .limit(10)
                .get();
            const data = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
            
            // SSE format eke yawanna
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            console.log(`📡 SSE: Sent ${data.length} records to client`);
        } catch(error) {
            console.error('SSE Error:', error.message);
        }
    };

    // Initial data yawanna
    sendCurrencyData();

    // Every 5 seconds walata update yawanna (10 seconds wadi wenna puluwan)
    const interval = setInterval(sendCurrencyData, 5000);

    // Client disconnect unoth cleanup karanna
    req.on('close', () => {
        console.log('🔌 SSE Client disconnected');
        clearInterval(interval);
        res.end();
    });
});

// GET endpoint - data ganna
app.get('/get-currencies', async(req, res) => {
    const db = admin.firestore();
    try {
        const snapshot = await db.collection('testCollection').get()
        const data = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}))
        res.json(data)
    } catch(error) {
        res.status(500).send(error)
    }
})

// POST endpoint - FastForex API eken data fetch karala Firebase ekata save karanna
app.post('/fetch-and-save-currencies', async(req, res) => {
    const db = admin.firestore();
    try {
        const { from, to } = req.body;
        
        // Default values
        const baseCurrency = from || 'LKR';
        const targetCurrencies = to || 'USD,GBP,EUR';
        
        // FastForex API call karanna
        const response = await fetch(
            `https://api.fastforex.io/fetch-multi?from=${baseCurrency}&to=${targetCurrencies}`,
            {
                headers: {
                    'X-API-Key': '056257f2b2-ce9e058385-t5pmc0'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`FastForex API error: ${response.status}`);
        }

        const apiData = await response.json();

        // Firebase ekata save karanna
        const docRef = await db.collection('testCollection').add({
            base: apiData.base,
            result: apiData.results,
            updated: apiData.updated,
            ms: apiData.ms || 0,
            fetchedAt: new Date().toISOString()
        });

        res.status(201).json({ 
            message: 'Currency data fetched and saved successfully',
            id: docRef.id,
            data: apiData
        });

    } catch(error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual trigger endpoint - scheduler test karanna
app.post('/trigger-fetch', async(req, res) => {
    try {
        await fetchAndSaveCurrencies();
        res.json({ message: 'Manual fetch triggered successfully! Check console and Firebase.' });
    } catch(error) {
        res.status(500).json({ error: error.message });
    }
});

// POST endpoint - data add karanna
app.post('/add-currency', async(req, res) => {
    const db = admin.firestore();
    try {
        const { base, result, updated, ms } = req.body;
        
        // Validate karanna data tika awe da kiyala
        if (!base || !result || !updated || !ms) {
            return res.status(400).json({ error: 'Please provide base, result, updated, and ms fields' })
        }

        // Firebase ekata add karanna
        const docRef = await db.collection('testCollection').add({
            base: base,
            result: result,
            updated: updated,
            ms: ms
        })

        res.status(201).json({ 
            message: 'Currency data added successfully',
            id: docRef.id 
        })

    } catch(error) {
        res.status(500).json({ error: error.message })
    }
})

// POST endpoint - wedi data tikak ekameta add karanna (batch)
app.post('/add-currencies-batch', async(req, res) => {
    const db = admin.firestore();
    try {
        const currencies = req.body; // Array ekak expect karanawa
        
        if (!Array.isArray(currencies) || currencies.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of currency data' })
        }

        const batch = db.batch();
        const addedIds = [];

        currencies.forEach(currency => {
            const docRef = db.collection('testCollection').doc();
            batch.set(docRef, {
                base: currency.base,
                result: currency.result,
                updated: currency.updated,
                ms: currency.ms
            });
            addedIds.push(docRef.id);
        });

        await batch.commit();

        res.status(201).json({ 
            message: `${currencies.length} currency records added successfully`,
            ids: addedIds 
        })

    } catch(error) {
        res.status(500).json({ error: error.message })
    }
})

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// ======== SCHEDULER FUNCTION ========
// FastForex API eken data fetch karala Firebase ekata save karana function
async function fetchAndSaveCurrencies() {
    // Check if Firebase is initialized
    if (!firebaseInitialized) {
        console.log('⏳ Waiting for Firebase to initialize...');
        return;
    }

    const db = admin.firestore();
    try {
        console.log('⏰ Scheduler started - Fetching currency data...');
        
        const baseCurrency = 'LKR';
        const targetCurrencies = 'USD,GBP,EUR';
        const THRESHOLD = 0.00320; // USD threshold value
        
        // FastForex API call
        const response = await fetch(
            `https://api.fastforex.io/fetch-multi?from=${baseCurrency}&to=${targetCurrencies}`,
            {
                headers: {
                    'X-API-Key': '056257f2b2-ce9e058385-t5pmc0'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`FastForex API error: ${response.status}`);
        }

        const apiData = await response.json();
        const usdValue = apiData.results.USD;

        // Firebase ekata save karanna
        const docRef = await db.collection('testCollection').add({
            base: apiData.base,
            result: apiData.results,
            updated: apiData.updated,
            ms: apiData.ms || 0,
            fetchedAt: new Date().toISOString()
        });

        console.log(`✅ Currency data saved successfully! Doc ID: ${docRef.id}`);
        console.log(`📊 Data: ${apiData.base} -> ${JSON.stringify(apiData.results)}`);

        // USD value check karala notification yawanna
        if (usdValue > THRESHOLD) {
            console.log(`🚨 ALERT: USD value (${usdValue}) is higher than threshold (${THRESHOLD})`);
            await sendNotification(usdValue, THRESHOLD);
        } else {
            console.log(`✓ USD value (${usdValue}) is within threshold (${THRESHOLD})`);
        }

    } catch(error) {
        console.error('❌ Scheduler error:', error.message);
        // Don't crash the app, just log the error
    }
}

// Notification yawana function
async function sendNotification(currentValue, threshold) {
    try {
        // Console notification
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔔 CURRENCY ALERT NOTIFICATION');
        console.log(`Current USD Rate: ${currentValue}`);
        console.log(`Threshold: ${threshold}`);
        console.log(`Difference: +${(currentValue - threshold).toFixed(5)}`);
        console.log(`Time: ${new Date().toLocaleString()}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Webhook notification
        const webhookMessage = `🚨 USD rate ${currentValue} exceeded threshold ${threshold}`;
        console.log('📤 Sending webhook notification...');
        console.log(`Message: ${webhookMessage}`);
        
        const response = await fetch('https://webhook.site/a0f51556-0b24-461e-ad10-d5b6d2b8fc9f', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: webhookMessage,
                currentValue: currentValue,
                threshold: threshold,
                difference: (currentValue - threshold).toFixed(5),
                timestamp: new Date().toISOString()
            })
        });

        if (response.ok) {
            console.log('✅ Webhook notification sent successfully!');
        } else {
            console.log(`⚠️ Webhook response status: ${response.status}`);
        }

    } catch(error) {
        console.error('❌ Notification error:', error.message);
    }
}

// ======== CRON SCHEDULES ========

// Wait for Firebase to initialize before starting scheduler
const startScheduler = () => {
    const checkAndStart = setInterval(() => {
        if (firebaseInitialized) {
            clearInterval(checkAndStart);
            
            console.log('🕒 Starting scheduler...');
            
            // TESTING - Every 2 minutes (uncomment karala test karanna)
            cron.schedule('*/2 * * * *', () => {
                console.log('🔄 Running scheduled task...');
                fetchAndSaveCurrencies();
            });

            // PRODUCTION - Every hour at minute 0 (production walata meka use karanna)
            // cron.schedule('0 * * * *', () => {
            //     console.log('🔄 Running hourly scheduled task...');
            //     fetchAndSaveCurrencies();
            // });

            console.log('✅ Scheduler initialized - Currency data will be fetched every 2 minutes (TEST MODE)');
            console.log('💡 Tip: Use POST /trigger-fetch to manually trigger the fetch anytime!');
        }
    }, 1000); // Check every second
};

// Start the scheduler
startScheduler();

// Serve dashboard at root route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});