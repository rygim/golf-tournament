# Golf Tournament Standings

A web-based golf tournament tracker with live standings, custom scoring rules, beer modifiers, awards, and OpenGolfAPI course integration.

## Features

- **Live Standings** — Real-time leaderboard with handicap-adjusted scoring
- **Multi-Round Support** — Track multiple rounds with per-round rules
- **Custom Scoring Rules** — Mulligan madness, worst ball, scramble, and more
- **Beer Modifier** — Because every golf tournament needs one 🍺
- **Course Search** — Search and auto-fill course data from [OpenGolfAPI](https://opengolfapi.org) (par data, location, contact info, map links)
- **Awards** — Auto-generated awards ceremony with longest drive, most improved, etc.
- **Excel Export** — Export full tournament data to spreadsheet
- **Editor Access Control** — Only allowed editors can modify tournament data
- **Firebase Persistence** — Data syncs across devices via Firestore

## Setup

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (or use an existing one)
3. Enable **Authentication** → Sign-in method → **Google**
4. Enable **Cloud Firestore** → Create database (start in production mode)

### 2. Configure

Edit `.firebaserc` and replace `your-firebase-project-id` with your Firebase project ID.

### 3. Deploy

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

### 4. Add Editors

Editors are managed via a Firestore document. In the Firebase Console:

1. Go to Firestore Database
2. Create collection `golf_editors`
3. Create document `allowed`
4. Add field `emails` (array) with editor email addresses

Or use the Firebase Admin SDK:
```bash
# Install firebase-admin if needed
npm install firebase-admin

# Use the seed script pattern from the main project
```

### 5. Open

Visit your Firebase Hosting URL (shown after deploy) and sign in with Google.

## Tech Stack

- Vanilla JavaScript (no build step, no frameworks)
- Firebase Hosting, Auth, and Firestore
- [OpenGolfAPI](https://opengolfapi.org) for course data (free, ODbL licensed)

## File Structure

```
index.html        — Main page
app.js            — App initialization, auth, UI rendering, course search
state.js          — Firestore/localStorage persistence
scoring.js        — Score calculation engine
rules.js          — Scoring rules library
awards.js         — Awards generation
excel-export.js   — Excel/CSV export
```

## License

MIT
