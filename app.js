import { loadState, saveState, nextId, exportState, importState, initFirestore, isAllowedEditor } from './state.js';
import { RULES_LIBRARY, RULE_CATEGORIES } from './rules.js';
import { calculateStandings, calculateRoundScore } from './scoring.js';
import { exportToExcel } from './excel-export.js';
import { computeAwards } from './awards.js';
import { API_KEY, setApiKey, searchCourses, searchCoursesOpenGolf, getCourseDetailOpenGolf } from './courseapi.js';

// Set to true to bypass auth for local development. Never deploy with this on.
const DEV_MODE_EDITOR = false;
const GCAPI_KEY_STORAGE = 'golf-gcapi-key';

let state = null;
let isAuthenticated = false;
let isEditor = false;
let currentUser = null;

// Firebase auth (lazy loaded)
async function initAuth() {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const { getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut } =
      await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');

    const firebaseConfig = {
      apiKey: window.__FIREBASE_CONFIG__?.apiKey || '',
      authDomain: window.__FIREBASE_CONFIG__?.authDomain || '',
      projectId: window.__FIREBASE_CONFIG__?.projectId || '',
    };

    // Try to read config from meta tags or env
    const metaConfig = document.querySelector('meta[name="firebase-config"]');
    if (metaConfig) {
      try { Object.assign(firebaseConfig, JSON.parse(metaConfig.content)); } catch(e) {}
    }

    // If no config, try fetching from /__/firebase/init.json (Firebase Hosting auto-config)
    if (!firebaseConfig.apiKey) {
      try {
        const resp = await fetch('/__/firebase/init.json');
        if (resp.ok) Object.assign(firebaseConfig, await resp.json());
      } catch(e) {}
    }

    if (!firebaseConfig.apiKey) {
      isEditor = DEV_MODE_EDITOR;
      renderAuthBar(null, null, null);
      renderAll();
      return;
    }

    const app = initializeApp(firebaseConfig);

    // Initialize Firestore and load state from it
    await initFirestore(app);
    state = await loadState();
    renderAll();

    const auth = getAuth(app);

    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      isAuthenticated = !!user;
      isEditor = DEV_MODE_EDITOR;

      if (!DEV_MODE_EDITOR && user && user.email) {
        isEditor = await isAllowedEditor(user.email);
      }

      renderAuthBar(auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut);
      renderAll();
    });

    renderAuthBar(auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut);
  } catch (e) {
    console.warn('Firebase auth not available, running in view-only mode', e);
    isEditor = DEV_MODE_EDITOR;
    renderAuthBar(null, null, null, null, null);
    renderAll();
  }
}

function renderAuthBar(auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut) {
  const bar = document.getElementById('auth-bar');
  if (isAuthenticated && currentUser) {
    const editorLabel = isEditor
      ? '<span style="color:#6ecf6e;font-size:0.75rem;margin-left:0.3rem">✓ Editor</span>'
      : '<span style="color:#6a8a6a;font-size:0.75rem;margin-left:0.3rem">View only</span>';
    bar.innerHTML = `
      <span>👤 ${currentUser.displayName || currentUser.email || 'User'}${editorLabel}</span>
      <button class="btn btn-secondary btn-small" id="sign-out-btn">Sign Out</button>
    `;
    bar.querySelector('#sign-out-btn')?.addEventListener('click', () => signOut?.(auth));
  } else if (auth && GoogleAuthProvider) {
    bar.innerHTML = `
      <span style="color:#6a8a6a">View only</span>
      <button class="btn btn-primary btn-small" id="sign-in-btn">Sign In to Edit</button>
    `;
    bar.querySelector('#sign-in-btn')?.addEventListener('click', async () => {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (e) {
        // Popup blocked or COOP issue — fall back to redirect
        console.warn('Popup sign-in failed, falling back to redirect:', e.code);
        signInWithRedirect(auth, new GoogleAuthProvider());
      }
    });
  } else {
    bar.innerHTML = '<span style="color:#6a8a6a">View only (no auth configured)</span>';
  }
}

// === Tab Navigation ===
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active');
    });
  });
}

// === Toast ===
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// === Persist helper ===
async function persist() {
  await saveState(state);
  renderAll();
}

// === RENDER: Standings ===
function renderStandings() {
  const container = document.getElementById('standings-content');
  const standings = calculateStandings(state);

  if (!standings.length) {
    container.innerHTML = '<p class="empty-state">No tournament data yet. Go to Setup to get started.</p>';
    return;
  }

  let html = `<div class="card"><h3>🏆 ${state.tournamentName}</h3>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem">
      <p style="font-size:0.8rem;color:#6a8a6a">${state.players.length} players · ${state.rounds.length} round(s)</p>
      <button class="btn btn-secondary btn-small" id="export-excel-btn">📊 Export to Excel</button>
    </div>
  </div>`;

  // Scoring explanation
  const activeRuleCount = new Set(state.rounds.flatMap(r => r.activeRules)).size;
  html += `<details class="card" style="cursor:pointer">
    <summary style="font-weight:600;color:#8fdf8f;font-size:0.9rem">📐 How Scoring Works</summary>
    <div style="margin-top:0.75rem;font-size:0.8rem;color:#a0c8a0;line-height:1.6">
      <p style="margin-bottom:0.5rem">Scoring happens in three layers:</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">1. Raw Score</span> — Your actual strokes per hole, added up. No tricks, just golf.</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">2. Hole Modifiers</span> — Active per-hole rules are checked against each hole score. For example, a Birdie Bonus subtracts a stroke, a Snowman Shame adds 2 if you score 8+. These adjust each hole individually before totaling.</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">3. Round Modifiers</span> — After all holes are tallied, round-level rules kick in. These look at patterns across the whole round (par streaks, consistency, beer count, etc.) and apply a single modifier to the round total.</p>
      <p style="margin-bottom:0.5rem;border-top:1px solid #2a4a2a;padding-top:0.5rem"><span style="color:#6ecf6e;font-weight:600">Adjusted Score</span> = Raw Score + Σ(Hole Modifiers) + Σ(Round Modifiers) - Handicap - Global Beer Bonus</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">🏌️ Handicap</span> — Each player can have a handicap set in Setup. Full handicap is subtracted per 18-hole round; half (rounded) for 9-hole rounds. This levels the playing field between different skill levels.</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">🍺 Beers</span> — Beer counts are tracked per round. Some rules use them directly (Beer Handicap: -1 per 3 beers, Sober Penalty: +2 for 0 beers). Some hole rules can also award bonus beers (Beer Per Birdie, The Six Pack). Beers show up in standings for bragging rights and tiebreakers.</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">🍺 Global Beer Modifier</span> — Configured in Setup. Currently: every <strong>${state.beerModifier?.beersPerStroke || 0}</strong> beers = <strong>-${state.beerModifier?.strokesOff || 0}</strong> stroke(s) off the final tournament score. This is applied after all round scoring is done, based on total beers across all rounds. ${(state.beerModifier?.beersPerStroke || 0) === 0 ? '<em>(Currently disabled)</em>' : ''}</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">Ranking</span> — Players are ranked by <em>average adjusted score per round</em> (lowest wins). This keeps it fair when someone misses a round. If two players tie, the one with more beers wins the tiebreak. 🍻</p>
      <p style="margin-bottom:0.4rem"><span style="color:#6ecf6e;font-weight:600">To Par</span> — Total adjusted score minus total par across all rounds played.</p>
      <p style="color:#6a8a6a;margin-top:0.5rem;font-style:italic">${activeRuleCount} unique rule(s) active across ${state.rounds.length} round(s). Rules can be toggled per-round in Setup, or overridden per-hole in the Scorecard tab.</p>
    </div>
  </details>`;

  html += '<div class="scorecard-scroll"><table class="final-score-table"><thead><tr>';
  html += '<th>Rank</th><th>Player</th><th>HCP</th><th>Rounds</th><th>Raw</th><th>Adjusted</th><th>To Par</th><th>Avg/Round</th><th>🍺 Beers</th><th>🍺 Bonus</th>';
  html += '</tr></thead><tbody>';

  standings.forEach((s, i) => {
    const rankClass = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
    const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
    const winnerClass = i === 0 ? 'highlight-winner' : '';
    const toParStr = s.toPar > 0 ? `+${s.toPar}` : s.toPar === 0 ? 'E' : `${s.toPar}`;

    html += `<tr class="${winnerClass}">`;
    html += `<td><span class="standings-rank ${rankClass}">${rankLabel}</span></td>`;
    html += `<td style="text-align:left;font-weight:600">${s.playerName}</td>`;
    html += `<td>${s.handicap || '-'}</td>`;
    html += `<td>${s.roundsPlayed}/${s.totalRounds}</td>`;
    html += `<td>${s.roundsPlayed > 0 ? s.totalRaw : '-'}</td>`;
    html += `<td style="font-weight:700">${s.roundsPlayed > 0 ? s.totalAdjusted : '-'}</td>`;
    html += `<td>${s.roundsPlayed > 0 ? toParStr : '-'}</td>`;
    html += `<td>${s.avgPerRound}</td>`;
    html += `<td><span class="beer-icon">🍺</span> ${s.totalBeers}</td>`;
    html += `<td style="color:#6ecf6e">${s.globalBeerBonus > 0 ? '-' + s.globalBeerBonus : '-'}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table></div>';

  // Per-round breakdown
  if (state.rounds.length > 0) {
    html += '<h3 style="margin-top:1.5rem">Round Breakdown</h3>';
    state.rounds.forEach(round => {
      html += `<div class="card"><h3>${round.name} (${round.holes} holes)</h3>`;
      html += '<table><thead><tr><th>Player</th><th>Raw</th><th>HCP</th><th>Adjusted</th><th>Beers</th><th>Modifiers</th></tr></thead><tbody>';
      standings.forEach(s => {
        const rr = s.roundResults.find(r => r.roundId === round.id);
        if (!rr || rr.skipped) {
          html += `<tr><td style="text-align:left">${s.playerName}</td><td colspan="5" style="color:#5a7a5a">Did not play</td></tr>`;
        } else {
          const mods = (rr.roundModifiers || []).map(m =>
            `<span class="rule-badge ${RULES_LIBRARY.find(r => r.id === m.ruleId)?.category || 'wild'}">${m.label}</span>`
          ).join('');
          html += `<tr><td style="text-align:left">${s.playerName}</td><td>${rr.rawTotal}</td><td style="color:#6ecf6e">${rr.handicapStrokes ? '-' + rr.handicapStrokes : '-'}</td><td style="font-weight:600">${rr.adjustedTotal - (rr.handicapStrokes || 0)}</td><td>🍺 ${rr.beers}</td><td>${mods || '-'}</td></tr>`;
        }
      });
      html += '</tbody></table></div>';
    });
  }

  container.innerHTML = html;

  // Excel export handler
  document.getElementById('export-excel-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('export-excel-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Generating...';
    try {
      await exportToExcel(state);
      toast('Excel file downloaded');
    } catch (e) {
      console.error('Excel export failed:', e);
      toast('Export failed — check console');
    } finally {
      btn.disabled = false;
      btn.textContent = '📊 Export to Excel';
    }
  });
}

// === RENDER: Scorecard ===
function renderScorecard() {
  const container = document.getElementById('scorecard-content');

  if (!state.rounds.length) {
    container.innerHTML = '<p class="empty-state">No rounds yet. Go to Setup to create one.</p>';
    return;
  }

  let html = '';
  state.rounds.forEach(round => {
    html += `<div class="card">
      <div class="round-header">
        <h3>${round.name} — ${round.holes} holes</h3>
        <div>
          <span style="font-size:0.75rem;color:#6a8a6a">Active rules: ${round.activeRules.length}</span>
        </div>
      </div>`;

    // Three-row header: Hole / Par / Distance
    const hasYardages = round.yardages?.some(y => y > 0);
    const statSpan = hasYardages ? 3 : 2;
    html += '<div class="scorecard-scroll"><table><thead>';
    html += `<tr><th style="text-align:left">Hole</th>`;
    for (let h = 0; h < round.holes; h++) html += `<th>${h + 1}</th>`;
    html += `<th rowspan="${statSpan}" style="vertical-align:middle">🍺</th><th rowspan="${statSpan}" style="vertical-align:middle" title="Times meated">🥩↓</th><th rowspan="${statSpan}" style="vertical-align:middle" title="Times you planted">🥩↑</th><th rowspan="${statSpan}" style="vertical-align:middle">Raw</th><th rowspan="${statSpan}" style="vertical-align:middle">Adj</th></tr>`;
    html += `<tr><th style="text-align:left;color:#8aaa8a;font-weight:400">Par</th>`;
    for (let h = 0; h < round.holes; h++) html += `<th>${round.pars[h] || 4}</th>`;
    html += '</tr>';
    if (hasYardages) {
      html += `<tr><th style="text-align:left;color:#5a7a5a;font-weight:400">Dist.</th>`;
      for (let h = 0; h < round.holes; h++) html += `<th style="color:#5a7a5a;font-weight:400">${round.yardages[h] || '—'}</th>`;
      html += '</tr>';
    }
    html += '</thead><tbody>';

    state.players.forEach(player => {
      const pd = round.scores?.[player.id];
      const participated = pd?.participated ?? false;
      const result = calculateRoundScore(round, player.id, state.holeRuleOverrides);

      html += `<tr><td style="text-align:left;white-space:nowrap">`;

      const teeBadge = pd?.tee_name ? `<span style="font-size:0.65rem;color:#6a8a6a;margin-left:0.3rem">${pd.tee_name}</span>` : '';
      if (isEditor) {
        const checked = participated ? 'checked' : '';
        html += `<label style="display:inline;font-size:0.85rem;color:#d4e8d4">
          <input type="checkbox" class="participate-check" data-round="${round.id}" data-player="${player.id}" ${checked} style="margin-right:4px" />
          ${player.name}
        </label>${teeBadge}`;
      } else {
        html += `${player.name}${teeBadge}${!participated ? ' <span style="color:#5a7a5a;font-size:0.7rem">(DNP)</span>' : ''}`;
      }
      html += '</td>';

      for (let h = 0; h < round.holes; h++) {
        const score = pd?.holes?.[h] || '';
        const par = round.pars[h] || 4;
        const scoreNum = parseInt(score) || 0;
        let cellStyle = '';
        if (scoreNum > 0 && scoreNum < par) cellStyle = 'color:#6ecf6e;font-weight:700';
        else if (scoreNum > par) cellStyle = 'color:#df8f8f';
        else if (scoreNum === par) cellStyle = 'color:#d4e8d4';

        if (isEditor && participated) {
          html += `<td><input type="number" class="score-input" min="1" max="20"
            data-round="${round.id}" data-player="${player.id}" data-hole="${h}"
            value="${score || ''}" /></td>`;
        } else {
          html += `<td style="${cellStyle}">${score || '-'}</td>`;
        }
      }

      // Beer input
      if (isEditor && participated) {
        html += `<td><input type="number" class="beer-input" min="0" max="30"
          data-round="${round.id}" data-player="${player.id}" data-field="beers"
          value="${pd?.beers || 0}" /></td>`;
      } else {
        html += `<td>🍺 ${pd?.beers || 0}</td>`;
      }

      // Meat inputs
      if (isEditor && participated) {
        html += `<td><input type="number" class="meat-input" min="0" max="20"
          data-round="${round.id}" data-player="${player.id}" data-field="meats"
          value="${pd?.meats || 0}" title="Times meated" /></td>`;
        html += `<td><input type="number" class="meat-input" min="0" max="20"
          data-round="${round.id}" data-player="${player.id}" data-field="meatPlants"
          value="${pd?.meatPlants || 0}" title="Times you planted" /></td>`;
      } else {
        html += `<td>${pd?.meats > 0 ? '🥩 ' + pd.meats : '-'}</td>`;
        html += `<td>${pd?.meatPlants > 0 ? '🥩 ' + pd.meatPlants : '-'}</td>`;
      }

      html += `<td>${result ? result.rawTotal : '-'}</td>`;
      html += `<td style="font-weight:600">${result ? result.adjustedTotal : '-'}</td>`;
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Per-hole rule overrides (for editors)
    if (isEditor) {
      html += '<details style="margin-top:0.5rem"><summary style="cursor:pointer;font-size:0.8rem;color:#6a8a6a">⚙️ Per-hole rule overrides</summary>';
      html += '<div style="margin-top:0.5rem;font-size:0.75rem">';
      const holeRules = RULES_LIBRARY.filter(r => r.type === 'hole');
      for (let h = 0; h < round.holes; h++) {
        const overrideKey = `${round.id}-${h}`;
        const currentOverrides = state.holeRuleOverrides[overrideKey] || null;
        html += `<div style="margin-bottom:0.3rem"><span style="color:#8aaa8a">H${h + 1}:</span> `;
        holeRules.forEach(rule => {
          const isActive = currentOverrides ? currentOverrides.includes(rule.id) : round.activeRules.includes(rule.id);
          html += `<span class="rule-chip ${isActive ? 'selected' : ''}"
            data-override-round="${round.id}" data-override-hole="${h}" data-override-rule="${rule.id}"
            title="${rule.description}">${rule.name}</span> `;
        });
        html += '</div>';
      }
      html += '</div></details>';
    }

    html += '</div>';
  });

  container.innerHTML = html;

  // Attach event listeners
  container.querySelectorAll('.score-input').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!isEditor) return;
      const { round, player, hole } = e.target.dataset;
      const val = parseInt(e.target.value) || 0;
      ensureScoreData(round, player);
      state.rounds.find(r => r.id === round).scores[player].holes[parseInt(hole)] = val > 0 ? val : null;
      persist();
    });
  });

  container.querySelectorAll('.beer-input').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!isEditor) return;
      const { round, player } = e.target.dataset;
      ensureScoreData(round, player);
      state.rounds.find(r => r.id === round).scores[player].beers = parseInt(e.target.value) || 0;
      persist();
    });
  });

  container.querySelectorAll('.meat-input').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!isEditor) return;
      const { round, player, field } = e.target.dataset;
      ensureScoreData(round, player);
      state.rounds.find(r => r.id === round).scores[player][field] = parseInt(e.target.value) || 0;
      persist();
    });
  });

  container.querySelectorAll('.participate-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (!isEditor) return;
      const { round, player } = e.target.dataset;
      ensureScoreData(round, player);
      state.rounds.find(r => r.id === round).scores[player].participated = e.target.checked;
      persist();
    });
  });

  container.querySelectorAll('.rule-chip[data-override-round]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!isEditor) return;
      const { overrideRound, overrideHole, overrideRule } = chip.dataset;
      const key = `${overrideRound}-${overrideHole}`;
      const round = state.rounds.find(r => r.id === overrideRound);
      if (!state.holeRuleOverrides[key]) {
        state.holeRuleOverrides[key] = [...(round?.activeRules || [])];
      }
      const arr = state.holeRuleOverrides[key];
      const idx = arr.indexOf(overrideRule);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(overrideRule);
      persist();
    });
  });
}

function ensureScoreData(roundId, playerId) {
  const round = state.rounds.find(r => r.id === roundId);
  if (!round) return;
  if (!round.scores) round.scores = {};
  if (!round.scores[playerId]) {
    round.scores[playerId] = { holes: new Array(round.holes).fill(null), beers: 0, meats: 0, meatPlants: 0, participated: true };
  }
}

// === RENDER: Rules Library ===
function renderRulesLibrary() {
  const container = document.getElementById('rules-content');
  let html = '<div class="card"><h3>📖 Rules Library</h3><p style="font-size:0.8rem;color:#6a8a6a;margin-bottom:0.5rem">Toggle rules on/off globally. You can also override rules per-hole in the Scorecard tab.</p></div>';

  const holeRules = RULES_LIBRARY.filter(r => r.type === 'hole');
  const roundRules = RULES_LIBRARY.filter(r => r.type === 'round');

  html += '<div class="card"><h3>Per-Hole Rules</h3>';
  holeRules.forEach(rule => {
    const isGlobal = state.globalRules.includes(rule.id);
    html += renderRuleRow(rule, isGlobal);
  });
  html += '</div>';

  html += '<div class="card"><h3>Per-Round Rules</h3>';
  roundRules.forEach(rule => {
    const isGlobal = state.globalRules.includes(rule.id);
    html += renderRuleRow(rule, isGlobal);
  });
  html += '</div>';

  container.innerHTML = html;

  // Attach toggle listeners
  container.querySelectorAll('.rule-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isEditor) { toast('Sign in as an editor to modify rules'); return; }
      const ruleId = btn.dataset.ruleId;
      const idx = state.globalRules.indexOf(ruleId);
      if (idx >= 0) state.globalRules.splice(idx, 1);
      else state.globalRules.push(ruleId);
      persist();
      toast(idx >= 0 ? 'Rule deactivated' : 'Rule activated');
    });
  });

  container.querySelectorAll('.apply-to-rounds-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isEditor) { toast('Sign in as an editor to modify rules'); return; }
      const ruleId = btn.dataset.ruleId;
      state.rounds.forEach(round => {
        if (!round.activeRules.includes(ruleId)) round.activeRules.push(ruleId);
      });
      persist();
      toast('Rule applied to all rounds');
    });
  });
}

function renderRuleRow(rule, isGlobal) {
  const cat = RULE_CATEGORIES[rule.category] || RULE_CATEGORIES.wild;
  return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid #1a2e1a">
    <span class="rule-badge ${rule.category}">${cat.label}</span>
    <div style="flex:1">
      <span style="font-weight:600;font-size:0.85rem">${rule.name}</span>
      <div class="rule-info">${rule.description}</div>
    </div>
    <button class="btn btn-small ${isGlobal ? 'btn-primary' : 'btn-secondary'} rule-toggle" data-rule-id="${rule.id}">
      ${isGlobal ? '✓ Active' : 'Off'}
    </button>
    <button class="btn btn-small btn-secondary apply-to-rounds-btn" data-rule-id="${rule.id}" title="Apply to all existing rounds">→ All Rounds</button>
  </div>`;
}

// === RENDER: Setup ===
function renderSetup() {
  const container = document.getElementById('setup-content');

  if (!isEditor) {
    container.innerHTML = '<div class="card"><p class="empty-state">Sign in as an allowed editor to set up or modify the tournament.</p></div>';
    // Still show read-only info
    if (state.players.length || state.rounds.length) {
      container.innerHTML += renderSetupReadOnly();
    }
    return;
  }

  let html = '';

  // Tournament name
  html += `<div class="card"><h3>Tournament Settings</h3>
    <div class="form-row">
      <div class="form-group"><label>Tournament Name</label>
        <input type="text" id="tournament-name" value="${state.tournamentName}" style="width:250px" />
      </div>
      <button class="btn btn-primary btn-small" id="save-name-btn">Save</button>
    </div>
    <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #2a4a2a">
      <label style="font-size:0.9rem;color:#8fdf8f;font-weight:600">🍺 Global Beer Modifier</label>
      <p style="font-size:0.75rem;color:#6a8a6a;margin:0.2rem 0 0.4rem">Applied to the final tournament score. Stacks with any per-round beer rules.</p>
      <div class="form-row">
        <div class="form-group"><label>Every</label>
          <input type="number" id="beer-per-stroke" min="0" max="20" value="${state.beerModifier?.beersPerStroke ?? 3}" style="width:60px" />
        </div>
        <span style="align-self:flex-end;padding-bottom:0.35rem;color:#8aaa8a;font-size:0.85rem">beers =</span>
        <div class="form-group"><label>Strokes off</label>
          <input type="number" id="beer-strokes-off" min="0" max="10" value="${state.beerModifier?.strokesOff ?? 1}" style="width:60px" />
        </div>
        <button class="btn btn-primary btn-small" id="save-beer-modifier-btn">Save</button>
      </div>
      <p style="font-size:0.7rem;color:#5a7a5a;margin-top:0.3rem">Set "Every" to 0 to disable. Example: Every 3 beers = 1 stroke off means 9 beers total = -3 strokes.</p>
    </div>
    <div class="form-row" style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #2a4a2a">
      <button class="btn btn-secondary btn-small" id="export-btn">📤 Export Data</button>
      <button class="btn btn-secondary btn-small" id="import-btn">📥 Import Data</button>
      <input type="file" id="import-file" accept=".json" class="hidden" />
      <button class="btn btn-danger btn-small" id="reset-btn">🗑️ Reset All</button>
    </div>
  </div>`;

  // Players
  html += `<div class="card"><h3>Players (${state.players.length})</h3>
    <div class="form-row">
      <div class="form-group"><label>Player Name</label>
        <input type="text" id="new-player-name" placeholder="e.g. Tiger" style="width:180px" />
      </div>
      <div class="form-group"><label>Handicap</label>
        <input type="number" id="new-player-handicap" min="0" max="54" value="0" style="width:60px" />
      </div>
      <button class="btn btn-primary btn-small" id="add-player-btn">Add Player</button>
    </div>
    <div id="players-list" style="margin-top:0.5rem">`;

  state.players.forEach(p => {
    html += `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid #1a2e1a">
      <span style="flex:1">${p.name}</span>
      <div class="form-group" style="margin:0"><label style="font-size:0.7rem">HCP</label>
        <input type="number" class="handicap-input" data-id="${p.id}" min="0" max="54" value="${p.handicap || 0}" style="width:50px" />
      </div>
      <button class="btn btn-danger btn-small remove-player-btn" data-id="${p.id}">✕</button>
    </div>`;
  });
  html += '</div></div>';

  // Rounds
  html += `<div class="card"><h3>Rounds (${state.rounds.length})</h3>
    <div style="margin-bottom:0.75rem;padding-bottom:0.75rem;border-bottom:1px solid #2a4a2a">
      <label style="font-size:0.9rem;color:#8fdf8f;font-weight:600">⛳ Search Golf Course</label>
      <div style="margin:0.3rem 0 0.5rem;padding:0.4rem 0.6rem;background:#0a140a;border-radius:4px">
        <label style="font-size:0.8rem;color:#a0c8a0">GolfCourseAPI Key <a href="https://golfcourseapi.com" target="_blank" rel="noopener" style="font-size:0.75rem;color:#6a8a6a">(free key at golfcourseapi.com)</a></label>
        <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem;flex-wrap:wrap">
          <input type="text" id="gcapi-key-input" placeholder="Paste API key here" value="${API_KEY}" style="width:280px;font-family:monospace;font-size:0.78rem" />
          <button class="btn btn-secondary btn-small" id="gcapi-key-save-btn">Save Key</button>
          ${API_KEY ? '<button class="btn btn-secondary btn-small" id="gcapi-key-clear-btn">Clear (use OpenGolfAPI instead)</button>' : ''}
        </div>
        <p style="font-size:0.75rem;color:#6a8a6a;margin:0.3rem 0 0">${API_KEY
          ? '&#10003; Using <strong style="color:#8fdf8f">GolfCourseAPI</strong> — full tee &amp; yardage data per hole.'
          : 'No key set — using <a href="https://opengolfapi.org" target="_blank" rel="noopener">OpenGolfAPI</a> (basic pars only, no tee selection).'
        }</p>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Course Name or City</label>
          <input type="text" id="course-search-input" placeholder="e.g. Pebble Beach, Augusta" style="width:250px" />
        </div>
        <button class="btn btn-primary btn-small" id="course-search-btn">🔍 Search</button>
      </div>
      <div id="course-search-results" style="margin-top:0.5rem;max-height:300px;overflow-y:auto"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Round Name</label>
        <input type="text" id="new-round-name" placeholder="e.g. Saturday AM" style="width:150px" />
      </div>
      <div class="form-group"><label>Holes</label>
        <select id="new-round-holes">
          <option value="9">9</option>
          <option value="18" selected>18</option>
        </select>
      </div>
      <button class="btn btn-primary btn-small" id="add-round-btn">Add Round</button>
    </div>`;

  state.rounds.forEach(round => {
    const courseInfo = round.courseInfo;
    let courseHtml = '';
    if (courseInfo) {
      const displayName = courseInfo.course_name || courseInfo.club_name || courseInfo.name || '';
      const par = courseInfo.par_total || courseInfo.par || '?';
      const teeLabel = courseInfo.tee_name ? ` · ${courseInfo.tee_name} tees` : '';
      const yardsLabel = courseInfo.total_yards ? ` · ${courseInfo.total_yards} yds` : '';
      const ratingLabel = courseInfo.course_rating ? ` · ${courseInfo.course_rating}/${courseInfo.slope_rating}` : '';
      courseHtml = `<div style="margin-bottom:0.5rem;padding:0.4rem 0.6rem;background:#0a140a;border-radius:4px;font-size:0.8rem">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;flex-wrap:wrap">
          <div>
            <strong style="color:#8fdf8f">⛳ ${displayName}</strong>
            <div style="color:#6a8a6a">${courseInfo.city || ''}${courseInfo.state ? ', ' + courseInfo.state : ''} · Par ${par}${teeLabel}${yardsLabel}${ratingLabel}</div>
          </div>
          ${courseInfo.latitude ? `<div><a href="https://www.google.com/maps?q=${courseInfo.latitude},${courseInfo.longitude}" target="_blank" rel="noopener" class="btn btn-secondary btn-small">📍 Map</a></div>` : ''}
        </div>
      </div>`;
    }

    html += `<div class="card" style="margin-top:0.5rem;background:#0f1a0f">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:600">${round.name} (${round.holes} holes)</span>
        <button class="btn btn-danger btn-small remove-round-btn" data-id="${round.id}">✕</button>
      </div>
      ${courseHtml}
      <div style="margin-top:0.4rem">
        <label>Pars (comma-separated or set all):</label>
        <div class="form-row">
          <input type="text" class="par-input" data-round="${round.id}" value="${(round.pars || []).join(',')}" style="width:300px" placeholder="4,3,5,4,..." />
          <select class="par-preset" data-round="${round.id}">
            <option value="">Set all to...</option>
            <option value="3">All Par 3</option>
            <option value="4">All Par 4</option>
            <option value="5">All Par 5</option>
          </select>
        </div>
        ${round.yardages?.some(y => y > 0) ? `<div style="font-size:0.75rem;color:#6a8a6a;margin-top:0.2rem">Yardages: ${round.yardages.join(', ')}</div>` : ''}
      </div>
      ${round.courseInfo?.tees?.length ? `<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #1a2e1a">
        <label style="font-size:0.8rem;color:#8fdf8f;font-weight:600">Player Tees</label>
        <div style="margin-top:0.3rem">
          ${state.players.map(p => {
            const teeVal = round.scores?.[p.id]?.tee_name || '';
            return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.15rem 0">
              <span style="min-width:110px;font-size:0.82rem">${p.name}</span>
              <select class="player-tee-select" data-round="${round.id}" data-player="${p.id}">
                <option value="">— choose tee —</option>
                ${round.courseInfo.tees.map(t => `<option value="${t.tee_name}" ${teeVal === t.tee_name ? 'selected' : ''}>${t.tee_name} (${t.total_yards} yds${t.tee_gender === 'female' ? ', W' : ''})</option>`).join('')}
              </select>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
      <div style="margin-top:0.4rem">
        <label>Active Rules for this Round:</label>
        <div class="rule-selector">`;

    RULES_LIBRARY.forEach(rule => {
      const isActive = round.activeRules.includes(rule.id);
      html += `<span class="rule-chip ${isActive ? 'selected' : ''}" data-round-rule="${round.id}" data-rule-id="${rule.id}" title="${rule.description}">${rule.name}</span>`;
    });

    html += '</div></div></div>';
  });

  html += '</div>';

  container.innerHTML = html;
  attachSetupListeners();
}

function renderSetupReadOnly() {
  let html = '<div class="card"><h3>Current Setup (read-only)</h3>';
  html += `<p style="font-size:0.85rem">Tournament: ${state.tournamentName}</p>`;
  html += `<p style="font-size:0.85rem">Players: ${state.players.map(p => `${p.name} (HCP ${p.handicap || 0})`).join(', ') || 'None'}</p>`;
  html += `<p style="font-size:0.85rem">Rounds: ${state.rounds.map(r => r.name + (r.courseInfo ? ' (' + r.courseInfo.city + ', ' + r.courseInfo.state + ')' : '')).join(', ') || 'None'}</p>`;
  const bps = state.beerModifier?.beersPerStroke || 0;
  const so = state.beerModifier?.strokesOff || 0;
  html += `<p style="font-size:0.85rem">🍺 Beer Modifier: ${bps > 0 ? `Every ${bps} beers = -${so} stroke(s)` : 'Disabled'}</p>`;
  html += '</div>';
  return html;
}

function attachSetupListeners() {
  document.getElementById('save-name-btn')?.addEventListener('click', () => {
    state.tournamentName = document.getElementById('tournament-name').value.trim() || 'Tournament';
    persist(); toast('Name saved');
  });

  document.getElementById('save-beer-modifier-btn')?.addEventListener('click', () => {
    const beersPerStroke = parseInt(document.getElementById('beer-per-stroke').value) || 0;
    const strokesOff = parseInt(document.getElementById('beer-strokes-off').value) || 0;
    state.beerModifier = { beersPerStroke, strokesOff };
    persist(); toast(beersPerStroke > 0 ? `Every ${beersPerStroke} beers = -${strokesOff} strokes` : 'Beer modifier disabled');
  });

  document.getElementById('add-player-btn')?.addEventListener('click', () => {
    const input = document.getElementById('new-player-name');
    const name = input.value.trim();
    if (!name) return;
    const handicap = parseInt(document.getElementById('new-player-handicap').value) || 0;
    state.players.push({ id: nextId(), name, handicap });
    input.value = '';
    document.getElementById('new-player-handicap').value = '0';
    persist(); toast(`${name} added (HCP ${handicap})`);
  });

  document.getElementById('new-player-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-player-btn')?.click();
  });

  document.querySelectorAll('.handicap-input').forEach(input => {
    input.addEventListener('change', () => {
      const player = state.players.find(p => p.id === input.dataset.id);
      if (player) {
        player.handicap = parseInt(input.value) || 0;
        persist(); toast(`${player.name} HCP → ${player.handicap}`);
      }
    });
  });

  document.querySelectorAll('.remove-player-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.players = state.players.filter(p => p.id !== btn.dataset.id);
      persist(); toast('Player removed');
    });
  });

  document.getElementById('add-round-btn')?.addEventListener('click', () => {
    const name = document.getElementById('new-round-name').value.trim() || `Round ${state.rounds.length + 1}`;
    const holes = parseInt(document.getElementById('new-round-holes').value) || 18;
    const pars = new Array(holes).fill(4);
    const roundData = {
      id: nextId(),
      name,
      holes,
      pars,
      activeRules: [...state.globalRules],
      scores: {},
    };
    // Attach pending course info if a course was selected
    if (window._pendingCourseInfo) {
      roundData.courseInfo = window._pendingCourseInfo;
      if (window._pendingCourseInfo.pars?.length > 0) {
        roundData.pars = window._pendingCourseInfo.pars.slice(0, holes);
        while (roundData.pars.length < holes) roundData.pars.push(4);
      }
      if (window._pendingCourseInfo.yardages?.length > 0) {
        roundData.yardages = window._pendingCourseInfo.yardages.slice(0, holes);
        while (roundData.yardages.length < holes) roundData.yardages.push(0);
      }
      window._pendingCourseInfo = null;
    }
    state.rounds.push(roundData);
    document.getElementById('new-round-name').value = '';
    persist(); toast(`${name} added`);
  });

  // GolfCourseAPI key
  document.getElementById('gcapi-key-save-btn')?.addEventListener('click', () => {
    const key = document.getElementById('gcapi-key-input')?.value.trim() || '';
    if (key) localStorage.setItem(GCAPI_KEY_STORAGE, key);
    else localStorage.removeItem(GCAPI_KEY_STORAGE);
    setApiKey(key);
    renderSetup();
    toast(key ? 'API key saved — using GolfCourseAPI' : 'Key cleared — using OpenGolfAPI');
  });
  document.getElementById('gcapi-key-clear-btn')?.addEventListener('click', () => {
    localStorage.removeItem(GCAPI_KEY_STORAGE);
    setApiKey('');
    renderSetup();
    toast('Key cleared — using OpenGolfAPI');
  });

  // Course search
  document.getElementById('course-search-btn')?.addEventListener('click', handleCourseSearch);
  document.getElementById('course-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCourseSearch();
  });

  document.querySelectorAll('.remove-round-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      state.rounds = state.rounds.filter(r => r.id !== id);
      // Clean up hole overrides for this round
      Object.keys(state.holeRuleOverrides).forEach(key => {
        if (key.startsWith(id + '-')) delete state.holeRuleOverrides[key];
      });
      persist(); toast('Round removed');
    });
  });

  document.querySelectorAll('.par-input').forEach(input => {
    input.addEventListener('change', () => {
      const round = state.rounds.find(r => r.id === input.dataset.round);
      if (!round) return;
      const vals = input.value.split(',').map(v => parseInt(v.trim()) || 4);
      round.pars = vals;
      // Pad to match hole count
      while (round.pars.length < round.holes) round.pars.push(4);
      persist();
    });
  });

  document.querySelectorAll('.par-preset').forEach(select => {
    select.addEventListener('change', () => {
      const round = state.rounds.find(r => r.id === select.dataset.round);
      if (!round || !select.value) return;
      round.pars = new Array(round.holes).fill(parseInt(select.value));
      select.value = '';
      persist(); toast('Pars updated');
    });
  });

  document.querySelectorAll('.player-tee-select').forEach(select => {
    select.addEventListener('change', () => {
      if (!isEditor) return;
      const { round: roundId, player: playerId } = select.dataset;
      ensureScoreData(roundId, playerId);
      state.rounds.find(r => r.id === roundId).scores[playerId].tee_name = select.value || null;
      persist();
    });
  });

  document.querySelectorAll('.rule-chip[data-round-rule]').forEach(chip => {
    chip.addEventListener('click', () => {
      const round = state.rounds.find(r => r.id === chip.dataset.roundRule);
      if (!round) return;
      const ruleId = chip.dataset.ruleId;
      const idx = round.activeRules.indexOf(ruleId);
      if (idx >= 0) round.activeRules.splice(idx, 1);
      else round.activeRules.push(ruleId);
      persist();
    });
  });

  document.getElementById('export-btn')?.addEventListener('click', () => {
    const blob = new Blob([exportState(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'golf-tournament.json'; a.click();
    URL.revokeObjectURL(url);
    toast('Exported');
  });

  document.getElementById('import-btn')?.addEventListener('click', () => {
    document.getElementById('import-file')?.click();
  });

  document.getElementById('import-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = importState(reader.result);
        persist(); toast('Imported successfully');
      } catch (err) {
        toast('Invalid file format');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset all tournament data? This cannot be undone.')) {
      state = { tournamentName: 'Weekend Tournament', players: [], rounds: [], globalRules: [], holeRuleOverrides: {}, beerModifier: { beersPerStroke: 3, strokesOff: 1 } };
      persist(); toast('Reset complete');
    }
  });
}

// === RENDER: Awards Ceremony ===
function renderAwards() {
  const container = document.getElementById('awards-content');
  const awards = computeAwards(state);

  if (!awards.length) {
    container.innerHTML = '<p class="empty-state">Play some rounds first to unlock awards.</p>';
    return;
  }

  let html = `<div class="card">
    <h3>🏆 Awards Ceremony — ${state.tournamentName}</h3>
    <p style="font-size:0.8rem;color:#6a8a6a;margin-top:0.3rem">${awards.length} awards generated from ${state.rounds.length} round(s) of data.</p>
  </div>`;

  html += '<div class="award-grid">';
  awards.forEach(award => {
    html += `<div class="award-card">
      <div class="award-icon">${award.icon}</div>
      <div class="award-body">
        <div class="award-title">${award.title}</div>
        <div class="award-winner">${award.winner}</div>
        <div class="award-detail">${award.detail}</div>
      </div>
    </div>`;
  });
  html += '</div>';

  container.innerHTML = html;
}

// === Render All ===
// --- Course Search (GolfCourseAPI with tee selection, or OpenGolfAPI fallback) ---
async function handleCourseSearch() {
  const input = document.getElementById('course-search-input');
  const resultsDiv = document.getElementById('course-search-results');
  const query = input?.value.trim();
  if (!query) { if (resultsDiv) resultsDiv.innerHTML = ''; return; }

  resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">Searching...</p>';

  try {
    let courses;
    if (API_KEY) {
      courses = await searchCourses(query);
      window._courseSearchSource = 'golfcourseapi';
    } else {
      courses = await searchCoursesOpenGolf(query);
      window._courseSearchSource = 'opengolfapi';
    }
    window._courseSearchResults = courses;

    if (courses.length === 0) {
      resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">No courses found. Try a different search.</p>';
      return;
    }

    renderCourseResults(courses, resultsDiv);
  } catch (err) {
    resultsDiv.innerHTML = `<p style="font-size:0.8rem;color:#c0392b">Search failed: ${err.message}</p>`;
  }
}

function renderCourseResults(courses, resultsDiv) {
  resultsDiv.innerHTML = courses.slice(0, 20).map(c => {
    const name = c.club_name || c.course_name || 'Unknown';
    const city = c.location?.city || c.city || '';
    const state = c.location?.state || c.state || '';
    const allTees = [...(c.tees?.male || []), ...(c.tees?.female || [])];
    const numHoles = allTees[0]?.number_of_holes || c.holes_count || '?';
    const par = allTees[0]?.par_total || c.par_total || '?';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;border-bottom:1px solid #1a2e1a;gap:0.5rem">
      <div>
        <div style="font-weight:600;font-size:0.85rem">${name}</div>
        <div style="font-size:0.75rem;color:#6a8a6a">${city}${state ? ', ' + state : ''} · ${numHoles} holes · Par ${par}</div>
      </div>
      <button class="btn btn-primary btn-small" data-select-course="${c.id}">Select</button>
    </div>`;
  }).join('');

  resultsDiv.querySelectorAll('[data-select-course]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const courseId = btn.dataset.selectCourse;
      const course = (window._courseSearchResults || []).find(c => String(c.id) === courseId);
      if (!course) return;
      if (window._courseSearchSource === 'golfcourseapi') {
        renderTeeSelector(course, resultsDiv);
      } else {
        selectCourseOpenGolf(course, resultsDiv);
      }
    });
  });
}

function renderTeeSelector(course, resultsDiv) {
  const maleTees = course.tees?.male || [];
  const femaleTees = course.tees?.female || [];
  const courseName = course.club_name || course.course_name || 'Unknown Course';

  function teeRow(tee, gender) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0.5rem;border-bottom:1px solid #1a2e1a;gap:0.5rem">
      <div>
        <span style="font-weight:600;font-size:0.85rem">${tee.tee_name}</span>
        <span style="font-size:0.75rem;color:#6a8a6a"> · ${tee.total_yards} yds · Par ${tee.par_total} · ${tee.course_rating}/${tee.slope_rating}</span>
      </div>
      <button class="btn btn-primary btn-small" data-tee-gender="${gender}" data-tee-name="${tee.tee_name}">Select</button>
    </div>`;
  }

  let html = `<div style="background:#0a140a;border-radius:4px;padding:0.5rem">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
      <strong style="color:#8fdf8f;font-size:0.85rem">${courseName}</strong>
      <button class="btn btn-secondary btn-small" id="tee-back-btn">← Back</button>
    </div>
    <p style="font-size:0.75rem;color:#6a8a6a;margin-bottom:0.4rem">${course.location?.city || ''}${course.location?.state ? ', ' + course.location.state : ''} · Choose tees:</p>`;

  if (maleTees.length) {
    html += `<div style="font-size:0.7rem;color:#8aaa8a;padding:0.2rem 0.5rem;background:#1a2e1a">Men's Tees</div>`;
    html += maleTees.map(t => teeRow(t, 'male')).join('');
  }
  if (femaleTees.length) {
    html += `<div style="font-size:0.7rem;color:#8aaa8a;padding:0.2rem 0.5rem;background:#1a2e1a;margin-top:0.25rem">Women's Tees</div>`;
    html += femaleTees.map(t => teeRow(t, 'female')).join('');
  }
  html += '</div>';
  resultsDiv.innerHTML = html;

  document.getElementById('tee-back-btn')?.addEventListener('click', () => {
    renderCourseResults(window._courseSearchResults || [], resultsDiv);
  });

  resultsDiv.querySelectorAll('[data-tee-gender]').forEach(btn => {
    btn.addEventListener('click', () => {
      const gender = btn.dataset.teeGender;
      const teeName = btn.dataset.teeName;
      const tee = course.tees[gender]?.find(t => t.tee_name === teeName);
      if (tee) selectTee(course, tee, gender, resultsDiv);
    });
  });
}

function selectTee(course, tee, gender, resultsDiv) {
  const courseName = course.club_name || course.course_name || 'Unknown Course';
  const holes = tee.holes || [];
  const numHoles = tee.number_of_holes || holes.length || 18;
  const pars = holes.map(h => h.par || 4);
  const yardages = holes.map(h => h.yardage || 0);

  document.getElementById('new-round-name').value = courseName;
  document.getElementById('new-round-holes').value = numHoles <= 9 ? '9' : '18';

  const teeSummary = (t, g) => ({
    tee_name: t.tee_name, tee_gender: g,
    total_yards: t.total_yards, par_total: t.par_total,
    course_rating: t.course_rating, slope_rating: t.slope_rating,
    number_of_holes: t.number_of_holes,
  });

  window._pendingCourseInfo = {
    id: course.id,
    club_name: course.club_name || '',
    course_name: course.course_name || '',
    city: course.location?.city || '',
    state: course.location?.state || '',
    country: course.location?.country || '',
    latitude: course.location?.latitude || null,
    longitude: course.location?.longitude || null,
    tee_name: tee.tee_name,
    tee_gender: gender,
    par_total: tee.par_total,
    total_yards: tee.total_yards,
    course_rating: tee.course_rating,
    slope_rating: tee.slope_rating,
    number_of_holes: numHoles,
    pars,
    yardages,
    tees: [
      ...(course.tees?.male || []).map(t => teeSummary(t, 'male')),
      ...(course.tees?.female || []).map(t => teeSummary(t, 'female')),
    ],
  };

  const genderLabel = gender === 'male' ? "Men's" : "Women's";
  resultsDiv.innerHTML = `
    <div style="padding:0.5rem;background:#1a2e1a;border-radius:4px;font-size:0.85rem">
      <strong style="color:#8fdf8f">✓ ${courseName} — ${tee.tee_name} (${genderLabel})</strong>
      <div style="color:#6a8a6a;font-size:0.8rem">${course.location?.city || ''}${course.location?.state ? ', ' + course.location.state : ''} · Par ${tee.par_total} · ${tee.total_yards} yds · Rating ${tee.course_rating}/${tee.slope_rating}</div>
      <div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.25rem">Pars: ${pars.join(', ')}</div>
      <div style="color:#6a8a6a;font-size:0.75rem">Yards: ${yardages.join(', ')}</div>
      <div style="margin-top:0.3rem;font-size:0.75rem;color:#5a7a5a">Click "Add Round" below to use this course and tee selection.</div>
    </div>
  `;
  toast(`Selected: ${courseName} — ${tee.tee_name}`);
}

async function selectCourseOpenGolf(basicCourse, resultsDiv) {
  resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">Loading course details...</p>';
  const detailed = await getCourseDetailOpenGolf(basicCourse.id);
  const course = detailed || basicCourse;

  const name = course.course_name || course.club_name || 'Unknown Course';
  const numHoles = course.holes_count || 18;

  let pars = null;
  if (course.scorecard && Array.isArray(course.scorecard) && course.scorecard.length > 0) {
    pars = course.scorecard.sort((a, b) => a.hole - b.hole).map(h => h.par || 4);
  }

  document.getElementById('new-round-name').value = name;
  document.getElementById('new-round-holes').value = numHoles <= 9 ? '9' : '18';

  window._pendingCourseInfo = {
    id: basicCourse.id,
    course_name: name,
    city: course.city || '',
    state: course.state || '',
    country: '',
    latitude: course.latitude || null,
    longitude: course.longitude || null,
    par_total: course.par_total || null,
    total_yards: null,
    number_of_holes: numHoles,
    pars,
    yardages: null,
    tees: [],
  };

  resultsDiv.innerHTML = `
    <div style="padding:0.5rem;background:#1a2e1a;border-radius:4px;font-size:0.85rem">
      <strong style="color:#8fdf8f">✓ ${name}</strong>
      <div style="color:#6a8a6a;font-size:0.8rem">${course.city || ''}${course.state ? ', ' + course.state : ''} · Par ${course.par_total || '?'} · ${numHoles} holes</div>
      ${pars
        ? `<div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.25rem">Pars: ${pars.join(', ')}</div>`
        : '<div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.25rem">No hole-by-hole par data available — you can enter pars manually after adding the round.</div>'
      }
      <div style="margin-top:0.3rem;font-size:0.75rem;color:#5a7a5a">Click "Add Round" below to use this course.</div>
    </div>
  `;
  toast(`Selected: ${name}`);
}

function renderAll() {
  renderStandings();
  renderScorecard();
  renderRulesLibrary();
  renderAwards();
  renderSetup();
}

// === Init ===
initTabs();
setApiKey(localStorage.getItem(GCAPI_KEY_STORAGE) || '');
// Load from localStorage first for instant render, then Firestore will override via initAuth
state = state || (function() { try { const raw = localStorage.getItem('golf-tournament-state'); return raw ? JSON.parse(raw) : null; } catch(e) { return null; } })() || { tournamentName: 'Weekend Tournament', players: [], rounds: [], globalRules: [], holeRuleOverrides: {}, beerModifier: { beersPerStroke: 3, strokesOff: 1 } };
renderAll();
initAuth();
