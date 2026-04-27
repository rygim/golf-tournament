import { loadState, saveState, nextId, exportState, importState, initFirestore, isAllowedEditor } from './state.js';
import { RULES_LIBRARY, RULE_CATEGORIES } from './rules.js';
import { calculateStandings, calculateRoundScore } from './scoring.js';
import { exportToExcel } from './excel-export.js';
import { computeAwards } from './awards.js';

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
      renderAuthBar(null, null, null);
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
      isEditor = false;

      if (user && user.email) {
        isEditor = await isAllowedEditor(user.email);
      }

      renderAuthBar(auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut);
      renderAll();
    });

    renderAuthBar(auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut);
  } catch (e) {
    console.warn('Firebase auth not available, running in view-only mode', e);
    renderAuthBar(null, null, null, null, null);
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

    // Par row header
    html += '<div class="scorecard-scroll"><table><thead><tr><th>Player</th>';
    for (let h = 0; h < round.holes; h++) {
      html += `<th>H${h + 1}<br><span style="font-size:0.65rem;color:#6a8a6a">P${round.pars[h] || 4}</span></th>`;
    }
    html += '<th>🍺</th><th>Raw</th><th>Adj</th></tr></thead><tbody>';

    state.players.forEach(player => {
      const pd = round.scores?.[player.id];
      const participated = pd?.participated ?? false;
      const result = calculateRoundScore(round, player.id, state.holeRuleOverrides);

      html += `<tr><td style="text-align:left;white-space:nowrap">`;

      if (isEditor) {
        const checked = participated ? 'checked' : '';
        html += `<label style="display:inline;font-size:0.85rem;color:#d4e8d4">
          <input type="checkbox" class="participate-check" data-round="${round.id}" data-player="${player.id}" ${checked} style="margin-right:4px" />
          ${player.name}
        </label>`;
      } else {
        html += `${player.name}${!participated ? ' <span style="color:#5a7a5a;font-size:0.7rem">(DNP)</span>' : ''}`;
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
    round.scores[playerId] = { holes: new Array(round.holes).fill(null), beers: 0, participated: true };
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
      <label style="font-size:0.9rem;color:#8fdf8f;font-weight:600">⛳ Search Golf Course (OpenGolfAPI)</label>
      <p style="font-size:0.75rem;color:#6a8a6a;margin:0.2rem 0 0.4rem">Search for a course to auto-fill pars and course info. <a href="https://opengolfapi.org" target="_blank" rel="noopener">Data from OpenGolfAPI (ODbL)</a></p>
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
      courseHtml = `<div style="margin-bottom:0.5rem;padding:0.4rem 0.6rem;background:#0a140a;border-radius:4px;font-size:0.8rem">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;flex-wrap:wrap">
          <div>
            <strong style="color:#8fdf8f">⛳ ${courseInfo.name || ''}</strong>
            <div style="color:#6a8a6a">${courseInfo.city || ''}${courseInfo.state ? ', ' + courseInfo.state : ''} · ${courseInfo.type || ''} · Par ${courseInfo.par || '?'}${courseInfo.year_built ? ' · Est. ' + courseInfo.year_built : ''}</div>
            ${courseInfo.phone ? `<div style="color:#6a8a6a">📞 ${courseInfo.phone}</div>` : ''}
          </div>
          <div style="display:flex;gap:0.3rem;flex-wrap:wrap">
            ${courseInfo.website ? `<a href="${courseInfo.website}" target="_blank" rel="noopener" class="btn btn-secondary btn-small">🌐 Website</a>` : ''}
            ${courseInfo.latitude ? `<a href="https://www.google.com/maps?q=${courseInfo.latitude},${courseInfo.longitude}" target="_blank" rel="noopener" class="btn btn-secondary btn-small">📍 Map</a>` : ''}
          </div>
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
      </div>
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
      // Apply pars from course scorecard if available
      if (window._pendingCourseInfo.pars && window._pendingCourseInfo.pars.length > 0) {
        roundData.pars = window._pendingCourseInfo.pars.slice(0, holes);
        while (roundData.pars.length < holes) roundData.pars.push(4);
      }
      window._pendingCourseInfo = null;
      window._pendingCoursePars = null;
    }
    state.rounds.push(roundData);
    document.getElementById('new-round-name').value = '';
    persist(); toast(`${name} added`);
  });

  // Course search
  document.getElementById('course-search-btn')?.addEventListener('click', searchCourses);
  document.getElementById('course-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchCourses();
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
// --- OpenGolfAPI Course Search ---
async function searchCourses() {
  const input = document.getElementById('course-search-input');
  const resultsDiv = document.getElementById('course-search-results');
  const query = input?.value.trim();
  if (!query) { if (resultsDiv) resultsDiv.innerHTML = ''; return; }

  resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">Searching...</p>';

  try {
    const resp = await fetch(`https://api.opengolfapi.org/v1/courses/search?q=${encodeURIComponent(query)}`);
    if (!resp.ok) throw new Error('API error ' + resp.status);
    const data = await resp.json();
    const courses = data.courses || [];

    if (courses.length === 0) {
      resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">No courses found. Try a different search.</p>';
      return;
    }

    resultsDiv.innerHTML = courses.slice(0, 15).map(c => `
      <div class="course-result" data-course-id="${c.id}" style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;border-bottom:1px solid #1a2e1a;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='#1a2e1a'" onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-weight:600;font-size:0.85rem">${c.course_name || c.club_name || 'Unknown'}</div>
          <div style="font-size:0.75rem;color:#6a8a6a">${c.city || ''}${c.state ? ', ' + c.state : ''} · ${c.course_type || ''} · ${c.holes_count || '?'} holes · Par ${c.par_total || '?'}${c.year_built ? ' · ' + c.year_built : ''}</div>
        </div>
        <button class="btn btn-primary btn-small" data-select-course="${c.id}">Select</button>
      </div>
    `).join('');

    // Bind select buttons
    resultsDiv.querySelectorAll('[data-select-course]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const courseId = btn.dataset.selectCourse;
        await selectCourse(courseId, courses.find(c => c.id === courseId));
      });
    });
  } catch (err) {
    resultsDiv.innerHTML = `<p style="font-size:0.8rem;color:#c0392b">Search failed: ${err.message}</p>`;
  }
}

async function selectCourse(courseId, basicData) {
  const resultsDiv = document.getElementById('course-search-results');

  // Try to get detailed course data (may include scorecard)
  let course = basicData;
  try {
    const resp = await fetch(`https://api.opengolfapi.org/v1/courses/${courseId}`);
    if (resp.ok) {
      const detailed = await resp.json();
      if (detailed) course = detailed;
    }
  } catch (e) { /* use basic data */ }

  const name = course.course_name || course.club_name || 'Unknown Course';
  const holes = course.holes_count || 18;

  // Extract pars from scorecard if available
  let pars = null;
  if (course.scorecard && Array.isArray(course.scorecard) && course.scorecard.length > 0) {
    pars = course.scorecard.sort((a, b) => a.hole - b.hole).map(h => h.par || 4);
  }

  // Fill in the round form
  document.getElementById('new-round-name').value = name;
  const holesSelect = document.getElementById('new-round-holes');
  if (holes <= 9) holesSelect.value = '9';
  else holesSelect.value = '18';

  // Store course info for when the round is created
  window._pendingCourseInfo = {
    id: courseId,
    name,
    city: course.city || '',
    state: course.state || '',
    type: course.course_type || '',
    par: course.par_total || null,
    holes: holes,
    year_built: course.year_built || null,
    phone: course.phone || '',
    website: course.website || '',
    latitude: course.latitude || null,
    longitude: course.longitude || null,
    address: course.address || '',
    pars: pars
  };

  // If we got pars, we'll apply them after the round is created
  if (pars) {
    window._pendingCoursePars = pars;
  }

  resultsDiv.innerHTML = `
    <div style="padding:0.5rem;background:#1a2e1a;border-radius:4px;font-size:0.85rem">
      <strong style="color:#8fdf8f">✓ Selected: ${name}</strong>
      <div style="color:#6a8a6a;font-size:0.8rem">${course.city || ''}${course.state ? ', ' + course.state : ''} · Par ${course.par_total || '?'} · ${holes} holes</div>
      ${pars ? `<div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.3rem">Pars: ${pars.join(', ')}</div>` : '<div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.3rem">No hole-by-hole par data available — you can enter pars manually after adding the round.</div>'}
      <div style="margin-top:0.3rem;font-size:0.75rem;color:#6a8a6a">Click "Add Round" to create the round with this course.</div>
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
// Load from localStorage first for instant render, then Firestore will override via initAuth
state = state || (function() { try { const raw = localStorage.getItem('golf-tournament-state'); return raw ? JSON.parse(raw) : null; } catch(e) { return null; } })() || { tournamentName: 'Weekend Tournament', players: [], rounds: [], globalRules: [], holeRuleOverrides: {}, beerModifier: { beersPerStroke: 3, strokesOff: 1 } };
renderAll();
initAuth();
