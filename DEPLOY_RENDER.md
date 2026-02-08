# Deploying Planck (Firestore Version) on Render

This guide is specific to your **Firestore** setup. Follow these steps exactly.

## Step 1: Prepare Your Firebase Key
Since we cannot upload the `serviceAccountKey.json` file to GitHub (it's a secret!), we will give it to Render using a secure code.

1.  Open your `backend/serviceAccountKey.json` file on your computer.
2.  Copy the **entire content** (the whole JSON object including `{ "type": "service_account", ... }`).
3.  Go to this website: [https://www.base64encode.org/](https://www.base64encode.org/)
4.  Paste your JSON code into the top box.
5.  Click **Encode**.
6.  **Copy the resulting long text string**. You will need this in Step 3.

## Step 2: Create Web Service on Render

1.  Log in to [Render.com](https://render.com).
2.  Click **New +** -> **Web Service**.
3.  Connect your GitHub repository **AbhiinavGH9/Planck**.
4.  Click **Connect**.

## Step 3: Configure Settings

Fill in these exact details:

| Setting | Value |
| :--- | :--- |
| **Name** | `planck-backend` |
| **Region** | `Singapore` (or closest to you) |
| **Branch** | `main` |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node src/server.js` |

### Environment Variables
Scroll down to **Environment Variables** and add these:

| Key | Value |
| :--- | :--- |
| `PORT` | `10000` |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | *(Paste the long encoded string from Step 1)* |
| `JWT_SECRET` | *(Copy from your local .env)* |
| `CLOUDINARY_CLOUD_NAME` | *(Copy from your local .env)* |
| `CLOUDINARY_API_KEY` | *(Copy from your local .env)* |
| `CLOUDINARY_API_SECRET` | *(Copy from your local .env)* |

*(Note: You can skip `MONGO_URI` since you are using Firestore)*

## Step 4: Deploy

Click **Create Web Service** at the bottom.

Wait for the build to finish. In the logs, you should see:
> `🔥 Firebase Config loaded from Environment Variable`
> `🔥 Firebase Connected Successfully to Firestore`
> `🚀 Server running on port 10000`

## Frontend (Expo)

Your frontend is a mobile app. You generally do not "deploy" it to Render unless you are running it as a website.
To build your app for Android/iOS, you use EAS Build on your computer, pointing to this new backend URL.

1.  Install EAS CLI: `npm install -g eas-cli`
2.  Login: `eas login`
3.  Configure `eas.json`
4.  Run `eas build --platform android` (or ios)
