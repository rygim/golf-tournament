# Golf Tournament Standings

A web-based golf tournament tracker with live standings, custom scoring rules, beer modifiers, awards, and GolfCourseAPI course integration.

## Features

- **Live Standings** — Real-time leaderboard with handicap-adjusted scoring
- **Multi-Round Support** — Track multiple rounds with per-round rules
- **Custom Scoring Rules** — Mulligan madness, worst ball, scramble, and more
- **Beer Modifier** — Because every golf tournament needs one 🍺
- **Course Search** — Search by course name or location; uses [GolfCourseAPI](https://golfcourseapi.com) (full tee + yardage data, requires a free API key entered in Setup) or falls back to [OpenGolfAPI](https://opengolfapi.org) (basic par data, no key needed)
- **Tee Selection** — All available tees (men's and women's) are stored per round; each player can be assigned their own tee (e.g. Blue, White, Red)
- **Scorecard with Distances** — Hole headers show hole number, par, and yardage in separate rows; each player's chosen tee is shown inline
- **Awards** — Auto-generated awards ceremony with longest drive, most improved, etc.
- **Excel Export** — Export full tournament data to spreadsheet
- **Editor Access Control** — Only allowed editors can modify tournament data; supports a local `.golf-editors.json` allowlist for development
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

#### Local development

Create a `.golf-editors.json` file in the project root (it is gitignored):

```json
{
  "emails": ["you@example.com"]
}
```

When Firebase is not configured (e.g. running via Live Server), the app falls back to this file for editor access.

### 5. Configure GolfCourseAPI (optional)

Course search works without a key via OpenGolfAPI (basic par data only). For full tee selection and per-hole yardages, get a free API key at [golfcourseapi.com](https://golfcourseapi.com) and paste it into the **GolfCourseAPI Key** field in the Setup tab. The key is stored in your browser's `localStorage` and is never committed to source control.

### 6. Open

Visit your Firebase Hosting URL (shown after deploy) and sign in with Google.

## Tech Stack

- Vanilla JavaScript (no build step, no frameworks)
- Firebase Hosting, Auth, and Firestore
- [GolfCourseAPI](https://golfcourseapi.com) for full tee + yardage data (optional, key entered in Setup)
- [OpenGolfAPI](https://opengolfapi.org) as a keyless fallback (basic par data)

## File Structure

```
index.html        — Main page
app.js            — App initialization, auth, UI rendering, course search
courseapi.js      — Course search client (GolfCourseAPI + OpenGolfAPI fallback)
state.js          — Firestore/localStorage persistence, editor allowlist
scoring.js        — Score calculation engine
rules.js          — Scoring rules library
awards.js         — Awards generation
excel-export.js   — Excel/CSV export
```

## License

MIT
