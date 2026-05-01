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
 * Get the current list of editor emails
 */
export async function getEditorEmails() {
  if (!_firestore || !_firestoreModules) return [];
  try {
    const { doc, getDoc } = _firestoreModules;
    const snap = await getDoc(doc(_firestore, EDITORS_DOC));
    if (!snap.exists()) return [];
    return snap.data().emails || [];
  } catch (e) {
    console.warn('Could not load editor list:', e);
    return [];
  }
}

/**
 * Save the editor email list
 */
export async function setEditorEmails(emails) {
  if (!_firestore || !_firestoreModules) return false;
  try {
    const { doc, setDoc } = _firestoreModules;
    await setDoc(doc(_firestore, EDITORS_DOC), { emails });
    return true;
  } catch (e) {
    console.warn('Could not save editor list:', e);
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

/**
 * Atomically update the state document using a Firestore transaction.
 * `mutator(state)` receives the latest state from Firestore, mutates it in place,
 * and the result is written back. This prevents concurrent writes from clobbering each other.
 * Returns the updated state, or null on failure.
 */
export async function transactionalUpdate(mutator) {
  if (!_firestore || !_firestoreModules) return null;
  try {
    const { doc, runTransaction } = _firestoreModules;
    const ref = doc(_firestore, TOURNAMENT_DOC);
    const result = await runTransaction(_firestore, async (txn) => {
      const snap = await txn.get(ref);
      const data = snap.exists() ? snap.data() : createDefaultState();
      mutator(data);
      txn.set(ref, data);
      return data;
    });
    _saveToLocalStorage(result);
    return result;
  } catch (e) {
    console.warn('Transactional update failed:', e.code || e.message);
    return null;
  }
}

/**
 * Subscribe to real-time state updates from Firestore.
 * Calls onChange(newState) whenever another client saves.
 * Returns an unsubscribe function.
 */
export function listenToState(onChange) {
  if (!_firestore || !_firestoreModules) return null;
  try {
    const { doc, onSnapshot } = _firestoreModules;
    return onSnapshot(doc(_firestore, TOURNAMENT_DOC), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        _saveToLocalStorage(data);
        if (onChange) onChange(data);
      }
    });
  } catch (e) {
    console.warn('Real-time listener failed:', e);
    return null;
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
