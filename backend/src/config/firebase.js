const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json');

try {
    let serviceAccount;

    // 1. Check for Base64 Env Var (Production/Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('ascii');
        serviceAccount = JSON.parse(decoded);
        console.log("🔥 Firebase Config loaded from Environment Variable");
    }
    // 2. Fallback to File (Local Development)
    else if (fs.existsSync(serviceAccountPath)) {
        serviceAccount = require(serviceAccountPath);
        console.log("🔥 Firebase Config loaded from local file");
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("🔥 Firebase Connected Successfully to Firestore");
    } else {
        console.warn("⚠️  Firebase Error: No credentials found!");
        console.warn("   - PRODUCTION: Set FIREBASE_SERVICE_ACCOUNT_BASE64 env var");
        console.warn("   - DEVELOPMENT: Place serviceAccountKey.json in backend root");
    }
} catch (error) {
    console.error("❌ Firebase Initialization Error:", error);
}

module.exports = { admin, db };
