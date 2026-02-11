const { db } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    let { username, password, avatarUrl } = req.body;

    // Normalize username to lowercase for case-insensitive login
    if (username) username = username.toLowerCase().trim();

    console.log(`[LOGIN ATTEMPT] Username: '${username}', Password: '${password}'`);

    if (!db) return res.status(500).json({ error: "Database not connected" });

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('username', '==', username).limit(1).get();

        if (snapshot.empty) {
            console.log(`[LOGIN FAILED] User '${username}' not found in DB.`);
            return res.status(401).json({ error: "Invalid username or password" });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        console.log(`[LOGIN FOUND] matched user document for '${userData.username}'`);

        const isMatch = await bcrypt.compare(password, userData.password);
        console.log(`[LOGIN CHECK] Password match result: ${isMatch}`);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        // If avatarUrl provides, update it
        if (avatarUrl) {
            await userDoc.ref.update({
                avatar: avatarUrl
            });
            userData.avatar = avatarUrl;
        }

        const token = jwt.sign({ id: userDoc.id, username: userData.username }, process.env.JWT_SECRET || 'dev_secret', {
            expiresIn: '7d'
        });

        res.json({
            token,
            user: {
                id: userDoc.id,
                username: userData.username,
                email: userData.email,
                avatar: userData.avatar
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
