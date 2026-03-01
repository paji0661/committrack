# Deployment Instructions

This guide will walk you through setting up the Family Commitment Tracker.

## 1. Google Sheets Backend Setup
1. Go to [Google Sheets](https://sheets.google.com) and create or open your spreadsheet named **Family Tracker DB**.
2. **Delete any old test data in your sheets (keep row 1 headers though).**
3. Create three sheets named exactly as follows:
   - **Users**
   - **Folders**
   - **Commitments**
4. In the **Users** sheet, check that Row 1 has exactly 3 columns: `Email`, `Role`, `DisplayName`. Add your email, 'user' role, and your display name in row 2. (Role is now just legacy, everyone has same permissions).
5. In the **Folders** sheet, create five columns in Row 1: `ID`, `ParentID`, `OwnerEmail`, `Name`, `SharedEmails`.
6. In the **Commitments** sheet, create six columns in Row 1: `ID`, `FolderID`, `Name`, `Amount`, `Due Date`, `Status`.

## 2. Google Apps Script Setup
1. In your Google Sheet, click **Extensions > Apps Script**.
2. Replace the initial `Code.gs` code with the contents of the `Code.gs` file provided in this project.
3. Click the **Save** (disk) icon.
4. Click **Deploy > New deployment**.
5. Click the gear icon next to "Select type" and choose **Web app**.
6. Configuration:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone** (This is purely so the fetch request can reach the app without forcing the user to authorize Apps Script itself. We enforce authorization inside the app using the Google Sign-In JWT check against your Users sheet).
7. Click **Deploy**.
8. Click **Authorize access** and go through the warning screens ("Advanced -> Go to Project (unsafe)").
9. Copy the **Web app URL**.

## 3. Google Client ID Setup
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Go to **APIs & Services > Credentials**.
4. Click **Create Credentials > OAuth client ID**.
5. Set Application type to **Web application**.
6. Name it (e.g., "Family Tracker").
7. Under **Authorized JavaScript origins**, add your deployment URL (e.g., `http://localhost:3000` for local testing, or your Netlify/Vercel production URL).
8. Under **Authorized redirect URIs**, add the same URL.
9. Click **Create** and copy the **Client ID**.

## 4. Frontend Configuration
1. Open `index.html` and replace `YOUR_GOOGLE_CLIENT_ID_HERE` with your actual Client ID in the `data-client_id` attribute.
2. Open `script.js` and replace `YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with your actual Web App URL from Step 2.

## 5. Deployment (GitHub Pages - Free Forever)
Since this app is purely HTML/CSS/JS with no build step, GitHub Pages is the perfect free hosting solution.

**Step-by-Step Guide:**
1. Log in to [GitHub](https://github.com/) (create an account if you don't have one).
2. Click the **"+"** icon in the top right corner and select **"New repository"**.
3. Name your repository (e.g., `family-web-ui`), set it to **Public**, and click **Create repository**.
4. On the next screen, click the link that says **"uploading an existing file"** (near the top).
5. Drag and drop all your website files (`index.html`, `script.v2.js`, `style.css`, etc.) into the box. **Do not put them in a folder; drag the files themselves.**
6. Scroll down and click **Commit changes**.
7. Once the files are uploaded, click on the **Settings** tab of your repository.
8. On the left sidebar, click **Pages**.
9. Under the **Build and deployment** section, look for **Branch**. Change it from `None` to `main` (or `master`), and click **Save**.
10. Wait 1-2 minutes. Refresh the page, and GitHub will display your new active website link at the top (it usually looks like `https://[your-username].github.io/family-web-ui/`).

**CRITICAL FINAL STEP**: 
Once you have your new GitHub Pages URL, you **must** add it to the Google Cloud Console so Google Sign-In works:
1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials).
2. Click on your existing **Web Client 1**.
3. Under **Authorized JavaScript origins**, click **ADD URI** and paste your new GitHub URL.
4. Under **Authorized redirect URIs**, click **ADD URI** and paste the exact same GitHub URL.
5. Click **SAVE**.
