/**
 * Tournament state management
 * Persists to Firestore (primary) with localStorage fallback.
 * Firestore doc: golf_tournaments/current
 * Editor allowlist: golf_editors/allowed { emails: [...] }
 */

const STORAGE_KEY = 'golf-tournament-state';
const TOURNAMENT_DOC = 'golf_tournaments/current';
const EDITORS_DOC = 'golf_editors/allowed';

let _firestore = null;
let _firestoreModules = null;

export function createDefaultState() {
  return {
    tournamentName: 'Weekend Tournament',
    players: [],
    rounds: [],
    globalRules: [],
    holeRuleOverrides: {},
    beerModifier: { beersPerStroke: 3, strokesOff: 1 },
  };
}

/**
 * Initialize Firestore connection (called from app.js after Firebase app is created)
 */
export async function initFirestore(firebaseApp) {
  try {
    const mod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    _firestoreModules = mod;
    _firestore = mod.getFirestore(firebaseApp);
    return true;
  } catch (e) {
    console.warn('Firestore not available, using localStorage only', e);
    return false;
  }
}

/**
 * Check if a user email is in the editors allowlist
 */
export async function isAllowedEditor(email) {
  if (!_firestore || !_firestoreModules || !email) return false;
  try {
    const { doc, getDoc } = _firestoreModules;
    const snap = await getDoc(doc(_firestore, EDITORS_DOC));
    if (!snap.exists()) return false;
    const data = snap.data();
    const emails = data.emails || [];
    return emails.includes(email.toLowerCase());
  } catch (e) {
    console.warn('Could not check editor allowlist:', e);
    return false;
  }
}

/**
 * Load state: try Firestore first, fall back to localStorage
 */
export async function loadState() {
  // Try Firestore
  if (_firestore && _firestoreModules) {
    try {
      const { doc, getDoc } = _firestoreModules;
      const snap = await getDoc(doc(_firestore, TOURNAMENT_DOC));
      if (snap.exists()) {
        const data = snap.data();
        // Also cache to localStorage
        _saveToLocalStorage(data);
        return data;
      }
    } catch (e) {
      console.warn('Firestore load failed, falling back to localStorage:', e);
    }
  }

  // Fall back to localStorage
  return _loadFromLocalStorage();
}

/**
 * Save state: write to both Firestore and localStorage
 */
export async function saveState(state) {
  _saveToLocalStorage(state);

  if (_firestore && _firestoreModules) {
    try {
      const { doc, setDoc } = _firestoreModules;
      await setDoc(doc(_firestore, TOURNAMENT_DOC), state);
    } catch (e) {
      console.warn('Firestore save failed (permission denied or offline):', e.code || e.message);
    }
  }
}

function _loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return createDefaultState();
}

function _saveToLocalStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

export function exportState(state) {
  return JSON.stringify(state, null, 2);
}

export function importState(json) {
  const data = JSON.parse(json);
  if (!data.players || !data.rounds) throw new Error('Invalid tournament data');
  return data;
}

let _id = Date.now();
export function nextId() {
  return String(_id++);
}
