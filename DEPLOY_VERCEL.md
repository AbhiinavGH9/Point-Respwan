# Deploying Planck Frontend on Vercel

This guide explains how to deploy the Expo Web frontend to Vercel and connect it to your Render backend.

## Prerequisites
- A [Vercel](https://vercel.com) account.
- This GitHub repository connected to your Vercel account.
- Your backend URL (e.g., `https://planck-backend.onrender.com`).

## Deployment Steps

1. **Dashboard**: Go to your Vercel Dashboard and click **Add New...** -> **Project**.
2. **Connect Repo**: Select/Import the `Planck` repository.
3. **Configure Project**:
    - **Framework Preset**: Select **Other** (Vercel usually auto-detects, but "Other" is safer for simple static exports).
    - **Root Directory**: `frontend` (Click "Edit" next to Root Directory and select the `frontend` folder).
4. **Build & Output Settings**:
    - **Build Command**: `npx expo export --platform web` (or override with `npm run build:web`)
    - **Output Directory**: `dist`
    - **Install Command**: `npm install` (default is fine)
5. **Environment Variables**:
    Expand the "Environment Variables" section and add:

    | Key | Value |
    | :--- | :--- |
    | `EXPO_PUBLIC_API_URL` | `https://planck-backend.onrender.com` |

    *(Make sure there is NO trailing slash at the end of the URL)*

6. **Deploy**: Click **Deploy**.

## Verification
- Once deployed, open the Vercel URL on your PC.
- Open it on your Mobile Phone browser.
- Try logging in or signing up.
- If you see a white screen on refresh, ensure the `vercel.json` file was properly pushed (it handles routing).
