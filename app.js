import { loadState, saveState, nextId, exportState, importState, initFirestore, isAllowedEditor, getEditorEmails, setEditorEmails, listenToState, transactionalUpdate } from './state.js?v=20260501f';
import { RULES_LIBRARY, RULE_CATEGORIES } from './rules.js?v=20260501c';
import { calculateStandings, calculateRoundScore } from './scoring.js?v=20260501c';
import { exportToExcel } from './excel-export.js?v=20260501c';
import { computeAwards } from './awards.js?v=20260501c';

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

    // Real-time listener for live updates from other users
    listenToState((newState) => {
      // Save UI state
      const openDetails = [];
      document.querySelectorAll('details[open]').forEach(d => {
        const summary = d.querySelector('summary');
        if (summary) openDetails.push(summary.textContent.trim());
      });
      const holeSelects = {};
      document.querySelectorAll('.hole-override-select').forEach(s => {
        holeSelects[s.dataset.round] = s.value;
      });

      state = newState;
      renderAll();

      // Restore UI state
      if (openDetails.length > 0) {
        document.querySelectorAll('details').forEach(d => {
          const summary = d.querySelector('summary');
          if (summary && openDetails.includes(summary.textContent.trim())) {
            d.open = true;
          }
        });
      }
      Object.entries(holeSelects).forEach(([roundId, val]) => {
        const sel = document.querySelector(`.hole-override-select[data-round="${roundId}"]`);
        if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
      });
    });

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
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (tab) {
    tab.classList.add('active');
    document.getElementById(`${tabName}-panel`).classList.add('active');
  }
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
      history.replaceState(null, '', `#${tabName}`);
    });
  });

  const hash = location.hash.replace('#', '');
  if (hash && document.querySelector(`.tab[data-tab="${hash}"]`)) {
    switchTab(hash);
  }
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
  // Save UI state before re-render
  const openDetails = [];
  document.querySelectorAll('details[open]').forEach(d => {
    const summary = d.querySelector('summary');
    if (summary) openDetails.push(summary.textContent.trim());
  });
  const holeSelects = {};
  document.querySelectorAll('.hole-override-select').forEach(s => {
    holeSelects[s.dataset.round] = s.value;
  });

  await saveState(state);
  renderAll();

  // Restore UI state after re-render
  if (openDetails.length > 0) {
    document.querySelectorAll('details').forEach(d => {
      const summary = d.querySelector('summary');
      if (summary && openDetails.includes(summary.textContent.trim())) {
        d.open = true;
      }
    });
  }
  // Restore hole selects and trigger re-render of override rules
  Object.entries(holeSelects).forEach(([roundId, val]) => {
    const sel = document.querySelector(`.hole-override-select[data-round="${roundId}"]`);
    if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
  });
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

  // Per-round breakdown — incomplete rounds first, then completed
  if (state.rounds.length > 0) {
    const isRoundComplete = (round) => {
      const scramble = round.scramble && round.teams && round.teams.length > 0;
      if (scramble) {
        const teams = round.teams.filter(t => round.scores?.[t.id]?.participated);
        return teams.length > 0 && teams.every(t => {
          const holes = round.scores[t.id]?.holes || [];
          return holes.filter(h => h && h > 0).length === round.holes;
        });
      }
      const participants = state.players.filter(p => round.scores?.[p.id]?.participated);
      return participants.length > 0 && participants.every(p => {
        const holes = round.scores[p.id]?.holes || [];
        return holes.filter(h => h && h > 0).length === round.holes;
      });
    };
    const incompleteRounds = state.rounds.filter(r => !isRoundComplete(r));
    const completeRounds = state.rounds.filter(r => isRoundComplete(r));
    const sortedRounds = [...incompleteRounds, ...completeRounds];

    let shownCompleteHeader = false;
    if (incompleteRounds.length > 0) {
      html += '<h3 style="margin-top:1.5rem">In Progress</h3>';
    }
    sortedRounds.forEach(round => {
      if (!shownCompleteHeader && isRoundComplete(round)) {
        html += '<h3 style="margin-top:1.5rem">Completed Rounds</h3>';
        shownCompleteHeader = true;
      }
      const scrambleLabel = (round.scramble && round.teams?.length > 0) ? ' · Scramble' : '';
      html += `<div class="card"><h3>${round.name} (${round.holes} holes${scrambleLabel})</h3>`;
      html += '<table><thead><tr><th>Player</th><th>Raw</th><th>HCP</th><th>Adjusted</th><th>Beers</th><th>Modifiers</th></tr></thead><tbody>';
      standings.forEach(s => {
        const rr = s.roundResults.find(r => r.roundId === round.id);
        if (!rr || rr.skipped) {
          html += `<tr><td style="text-align:left">${s.playerName}</td><td colspan="5" style="color:#5a7a5a">Did not play</td></tr>`;
        } else {
          const teamLabel = (round.scramble && round.teams) ? (() => {
            const team = round.teams.find(t => t.players.includes(s.playerId));
            return team ? ` <span style="color:#6a8a6a;font-size:0.7rem">(${team.name})</span>` : '';
          })() : '';
          const mods = (rr.roundModifiers || []).map(m =>
            `<span class="rule-badge ${RULES_LIBRARY.find(r => r.id === m.ruleId)?.category || 'wild'}">${m.label}</span>`
          ).join('');
          html += `<tr><td style="text-align:left">${s.playerName}${teamLabel}</td><td>${rr.rawTotal}</td><td style="color:#6ecf6e">${rr.handicapStrokes ? '-' + rr.handicapStrokes : '-'}</td><td style="font-weight:600">${rr.adjustedTotal - (rr.handicapStrokes || 0)}</td><td>🍺 ${rr.beers}</td><td>${mods || '-'}</td></tr>`;
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
  const isRoundComplete = (round) => {
    const scramble = round.scramble && round.teams && round.teams.length > 0;
    if (scramble) {
      const teams = round.teams.filter(t => round.scores?.[t.id]?.participated);
      return teams.length > 0 && teams.every(t => {
        const holes = round.scores[t.id]?.holes || [];
        return holes.filter(h => h && h > 0).length === round.holes;
      });
    }
    const participants = state.players.filter(p => round.scores?.[p.id]?.participated);
    return participants.length > 0 && participants.every(p => {
      const holes = round.scores[p.id]?.holes || [];
      return holes.filter(h => h && h > 0).length === round.holes;
    });
  };
  const incompleteRounds = state.rounds.filter(r => !isRoundComplete(r));
  const completeRounds = state.rounds.filter(r => isRoundComplete(r));
  const sortedRounds = [...incompleteRounds, ...completeRounds];

  let shownCompleteHeader = false;
  if (incompleteRounds.length > 0) {
    html += '<h3 style="margin-bottom:0.5rem">In Progress</h3>';
  }
  sortedRounds.forEach(round => {
    if (!shownCompleteHeader && isRoundComplete(round)) {
      html += '<h3 style="margin-top:1.5rem;margin-bottom:0.5rem">Completed Rounds</h3>';
      shownCompleteHeader = true;
    }
    const scrambleTag = (round.scramble && round.teams?.length > 0) ? ' · Scramble' : '';
    html += `<div class="card">
      <div class="round-header">
        <h3>${round.name} — ${round.holes} holes${scrambleTag}</h3>
        <div>
          <span style="font-size:0.75rem;color:#6a8a6a">Active rules: ${round.activeRules.length}</span>
        </div>
      </div>`;

    const roundIsScramble = round.scramble && round.teams && round.teams.length > 0;

    // Build scoring entities for this round
    let roundEntities;
    if (roundIsScramble) {
      roundEntities = round.teams.map(t => ({ id: t.id, name: t.name }));
    } else {
      roundEntities = state.players.map(p => ({ id: p.id, name: p.name }));
    }

    // Round summary highlights
    const roundResults = roundEntities.map(e => {
      const pd = round.scores?.[e.id];
      if (!pd?.participated) return null;
      const result = calculateRoundScore(round, e.id, state.holeRuleOverrides);
      return result ? { entity: e, result } : null;
    }).filter(Boolean);

    const roundComplete = roundResults.length > 0 && roundResults.every(r => {
      const holes = round.scores[r.entity.id]?.holes || [];
      return holes.filter(h => h && h > 0).length === round.holes;
    });

    if (roundComplete) {
      const totalPar = round.pars.reduce((s, p) => s + (p || 4), 0);
      const sorted = [...roundResults].sort((a, b) => a.result.adjustedTotal - b.result.adjustedTotal);
      const winner = sorted[0];
      const winnerToPar = winner.result.rawTotal - totalPar;
      const winnerToParStr = winnerToPar > 0 ? `+${winnerToPar}` : winnerToPar === 0 ? 'E' : `${winnerToPar}`;

      let bestHole = null;
      let worstHole = null;
      roundResults.forEach(r => {
        (r.result.holeDetails || []).forEach(hd => {
          if (!hd.score) return;
          const diff = hd.score - hd.par;
          if (!bestHole || diff < bestHole.diff) bestHole = { player: r.entity.name, hole: hd.hole, score: hd.score, par: hd.par, diff };
          if (!worstHole || diff > worstHole.diff) worstHole = { player: r.entity.name, hole: hd.hole, score: hd.score, par: hd.par, diff };
        });
      });

      const mostBeers = [...roundResults].sort((a, b) => (round.scores[b.entity.id]?.beers || 0) - (round.scores[a.entity.id]?.beers || 0))[0];
      const mostBeersCount = round.scores[mostBeers.entity.id]?.beers || 0;

      html += `<div style="background:#0a1a0a;border:1px solid #2d5a2d;border-radius:6px;padding:0.75rem;margin-bottom:0.75rem">`;
      html += `<div style="font-size:0.85rem;font-weight:700;color:#ffd700;margin-bottom:0.4rem">🏆 ${winner.entity.name} wins — ${winner.result.adjustedTotal} adjusted (${winnerToParStr})</div>`;
      html += `<div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:0.78rem;color:#a0c8a0">`;
      if (bestHole) {
        const bestLabel = bestHole.diff === -2 ? 'Eagle' : bestHole.diff === -1 ? 'Birdie' : bestHole.diff === -3 ? 'Albatross' : `${bestHole.diff}`;
        html += `<span>🔥 Best: ${bestHole.player} H${bestHole.hole} (${bestHole.score} on par ${bestHole.par}, ${bestLabel})</span>`;
      }
      if (worstHole) {
        html += `<span>💀 Worst: ${worstHole.player} H${worstHole.hole} (${worstHole.score} on par ${worstHole.par})</span>`;
      }
      if (mostBeersCount > 0) {
        html += `<span>🍺 Most beers: ${mostBeers.entity.name} (${mostBeersCount})</span>`;
      }
      html += `</div></div>`;
    }

    // Par row header
    const entityLabel = roundIsScramble ? 'Team' : 'Player';
    html += `<div class="scorecard-scroll"><table><thead><tr><th>${entityLabel}</th>`;
    for (let h = 0; h < round.holes; h++) {
      html += `<th>H${h + 1}<br><span style="font-size:0.65rem;color:#6a8a6a">P${round.pars[h] || 4}</span></th>`;
    }
    html += '<th>🍺</th><th>Raw</th><th>Adj</th></tr></thead><tbody>';

    roundEntities.forEach(entity => {
      const pd = round.scores?.[entity.id];
      const participated = pd?.participated ?? false;
      const result = calculateRoundScore(round, entity.id, state.holeRuleOverrides);

      html += `<tr><td style="text-align:left;white-space:nowrap">`;
      html += `${entity.name}${!participated ? ' <span style="color:#5a7a5a;font-size:0.7rem">(DNP)</span>' : ''}`;
      html += '</td>';

      for (let h = 0; h < round.holes; h++) {
        const score = pd?.holes?.[h] || '';
        const par = round.pars[h] || 4;
        const scoreNum = parseInt(score) || 0;
        let cellStyle = '';
        if (scoreNum > 0 && scoreNum < par) cellStyle = 'color:#6ecf6e;font-weight:700';
        else if (scoreNum > par) cellStyle = 'color:#df8f8f';
        else if (scoreNum === par) cellStyle = 'color:#d4e8d4';
        html += `<td style="${cellStyle}">${score || '-'}</td>`;
      }

      html += `<td>🍺 ${pd?.beers || 0}</td>`;
      html += `<td>${result ? result.rawTotal : '-'}</td>`;
      html += `<td style="font-weight:600">${result ? result.adjustedTotal : '-'}</td>`;
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    html += `<div style="margin-top:0.5rem;font-size:0.8rem;color:#6a8a6a">Edit scores in the <a href="#liveround" style="color:#6ecf6e;cursor:pointer" class="scorecard-edit-link" data-round="${round.id}">Live Round</a> tab.</div>`;

    html += '</div>';
  });

  container.innerHTML = html;

  // Link to live round tab with the correct round selected
  container.querySelectorAll('.scorecard-edit-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      liveRoundId = link.dataset.round;
      liveHoleIdx = 0;
      switchTab('liveround');
      history.replaceState(null, '', '#liveround');
      renderLiveRound();
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
        <input type="text" id="tournament-name" value="${state.tournamentName}" style="width:250px;max-width:100%" />
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

  // Admin management
  html += `<div class="card"><h3>👥 Editor Access</h3>
    <p style="font-size:0.75rem;color:#6a8a6a;margin-bottom:0.5rem">Editors can modify tournament settings, enter scores, and manage players. Add email addresses of people who should have editor access.</p>
    <div id="editor-list" style="margin-bottom:0.5rem"><p style="font-size:0.8rem;color:#6a8a6a">Loading editors...</p></div>
    <div class="form-row">
      <div class="form-group"><label>Add Editor Email</label>
        <input type="email" id="new-editor-email" placeholder="email@example.com" style="width:250px;max-width:100%" />
      </div>
      <button class="btn btn-primary btn-small" id="add-editor-btn">Add Editor</button>
    </div>
  </div>`;

  // Players
  html += `<div class="card"><h3>Players (${state.players.length})</h3>
    <div class="form-row">
      <div class="form-group"><label>Player Name</label>
        <input type="text" id="new-player-name" placeholder="e.g. Tiger" style="width:180px;max-width:100%" />
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
      <p style="font-size:0.75rem;color:#6a8a6a;margin:0.2rem 0 0.4rem">Search for a course to auto-fill pars and course info. <a href="https://golfcourseapi.com" target="_blank" rel="noopener">Data from GolfCourseAPI</a></p>
      <div class="form-row">
        <div class="form-group"><label>Course Name or City</label>
          <input type="text" id="course-search-input" placeholder="e.g. Pebble Beach, Augusta" style="width:250px;max-width:100%" />
        </div>
        <button class="btn btn-primary btn-small" id="course-search-btn">🔍 Search</button>
      </div>
      <div id="course-search-results" style="margin-top:0.5rem;max-height:300px;overflow-y:auto"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Round Name</label>
        <input type="text" id="new-round-name" placeholder="e.g. Saturday AM" style="width:150px;max-width:100%" />
      </div>
      <div class="form-group"><label>Holes</label>
        <select id="new-round-holes">
          <option value="9">9</option>
          <option value="18" selected>18</option>
        </select>
      </div>
      <div class="form-group" style="justify-content:flex-end">
        <label style="display:flex;align-items:center;gap:0.3rem;cursor:pointer">
          <input type="checkbox" id="new-round-scramble" /> Scramble
        </label>
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
      <div style="margin-top:0.4rem">
        ${(() => {
          const hasScores = Object.values(round.scores || {}).some(pd => (pd.holes || []).some(h => h && h > 0));
          const disabled = hasScores ? 'disabled' : '';
          const hint = hasScores ? ' <span style="color:#6a8a6a;font-size:0.75rem">(locked — scores exist)</span>' : '';
          return `<label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;${hasScores ? 'opacity:0.6;' : 'cursor:pointer;'}">
            <input type="checkbox" class="scramble-toggle" data-round="${round.id}" ${round.scramble ? 'checked' : ''} ${disabled} /> 👥 Scramble (2-person teams share one scorecard)${hint}
          </label>`;
        })()}
      </div>
      ${courseHtml}
      <div style="margin-top:0.4rem">
        <label>Pars (comma-separated or set all):</label>
        <div class="form-row">
          <input type="text" class="par-input" data-round="${round.id}" value="${(round.pars || []).join(',')}" style="width:300px;max-width:100%" placeholder="4,3,5,4,..." />
          <select class="par-preset" data-round="${round.id}">
            <option value="">Set all to...</option>
            <option value="3">All Par 3</option>
            <option value="4">All Par 4</option>
            <option value="5">All Par 5</option>
          </select>
        </div>
      </div>
      <div style="margin-top:0.4rem">
        <label>🏌️ Longest Drive & Closest to Pin Holes:</label>
        <div class="form-row" style="margin-top:0.3rem">
          <div class="form-group"><label style="font-size:0.75rem">LD Front 9</label>
            <select class="ld-ctp-select" data-round="${round.id}" data-field="ldFront" style="width:100%">
              <option value="">None</option>
              ${Array.from({length: Math.min(round.holes, 9)}, (_, i) => `<option value="${i}"${(round.ldFront != null && round.ldFront == i) ? ' selected' : ''}>Hole ${i + 1} (Par ${round.pars[i] || 4})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label style="font-size:0.75rem">LD Back 9</label>
            <select class="ld-ctp-select" data-round="${round.id}" data-field="ldBack" style="width:100%">
              <option value="">None</option>
              ${round.holes > 9 ? Array.from({length: round.holes - 9}, (_, i) => `<option value="${i + 9}"${(round.ldBack != null && round.ldBack == i + 9) ? ' selected' : ''}>Hole ${i + 10} (Par ${round.pars[i + 9] || 4})</option>`).join('') : ''}
            </select>
          </div>
          <div class="form-group"><label style="font-size:0.75rem">CTP Front 9</label>
            <select class="ld-ctp-select" data-round="${round.id}" data-field="ctpFront" style="width:100%">
              <option value="">None</option>
              ${Array.from({length: Math.min(round.holes, 9)}, (_, i) => `<option value="${i}"${(round.ctpFront != null && round.ctpFront == i) ? ' selected' : ''}>Hole ${i + 1} (Par ${round.pars[i] || 4})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label style="font-size:0.75rem">CTP Back 9</label>
            <select class="ld-ctp-select" data-round="${round.id}" data-field="ctpBack" style="width:100%">
              <option value="">None</option>
              ${round.holes > 9 ? Array.from({length: round.holes - 9}, (_, i) => `<option value="${i + 9}"${(round.ctpBack != null && round.ctpBack == i + 9) ? ' selected' : ''}>Hole ${i + 10} (Par ${round.pars[i + 9] || 4})</option>`).join('') : ''}
            </select>
          </div>
        </div>
      </div>
      <div style="margin-top:0.4rem">
        <label>Active Rules for this Round:</label>
        <div style="margin-bottom:0.4rem;display:flex;gap:0.3rem;flex-wrap:wrap">
          <button class="btn btn-secondary btn-small random-rules-btn" data-round="${round.id}" data-count="3">🎲 Random 3</button>
          <button class="btn btn-secondary btn-small random-rules-btn" data-round="${round.id}" data-count="5">🎲 Random 5</button>
          <button class="btn btn-secondary btn-small random-rules-btn" data-round="${round.id}" data-count="8">🎲 Random 8</button>
          <button class="btn btn-secondary btn-small preset-rules-btn" data-round="${round.id}" data-preset="chill">😎 Chill</button>
          <button class="btn btn-secondary btn-small preset-rules-btn" data-round="${round.id}" data-preset="chaos">🔥 Chaos</button>
          <button class="btn btn-secondary btn-small preset-rules-btn" data-round="${round.id}" data-preset="beer">🍺 Beer Focus</button>
          <button class="btn btn-secondary btn-small preset-rules-btn" data-round="${round.id}" data-preset="competitive">🏆 Competitive</button>
          <button class="btn btn-secondary btn-small clear-rules-btn" data-round="${round.id}">✕ Clear All</button>
        </div>
        <div class="rule-selector">`;

    RULES_LIBRARY.forEach(rule => {
      const isActive = round.activeRules.includes(rule.id);
      html += `<span class="rule-chip ${isActive ? 'selected' : ''}" data-round-rule="${round.id}" data-rule-id="${rule.id}" title="${rule.description}">${rule.name}</span>`;
    });

    html += '</div></div>';

    // Scramble team assignment
    if (round.scramble) {
      const teams = round.teams || [];
      const assignedIds = new Set(teams.flatMap(t => t.players));
      const unassigned = state.players.filter(p => !assignedIds.has(p.id));

      html += `<div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #2a4a2a">
        <label style="font-size:0.9rem;color:#8fdf8f;font-weight:600">👥 Scramble Teams</label>`;

      if (teams.length > 0) {
        teams.forEach(team => {
          const names = team.players.map(pid => state.players.find(p => p.id === pid)?.name || '?').join(' & ');
          html += `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid #1a2e1a">
            <span style="flex:1;font-size:0.85rem">${names}</span>
            <button class="btn btn-danger btn-small remove-team-btn" data-round="${round.id}" data-team="${team.id}">✕</button>
          </div>`;
        });
      }

      if (unassigned.length >= 2) {
        html += `<div class="form-row" style="margin-top:0.5rem">
          <div class="form-group"><label>Player 1</label>
            <select class="team-player-select" data-round="${round.id}" data-slot="1">
              <option value="">Pick...</option>
              ${unassigned.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Player 2</label>
            <select class="team-player-select" data-round="${round.id}" data-slot="2">
              <option value="">Pick...</option>
              ${unassigned.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-small create-team-btn" data-round="${round.id}">Create Team</button>
        </div>`;
      } else if (unassigned.length === 1) {
        html += `<p style="font-size:0.8rem;color:#6a8a6a;margin-top:0.3rem">${unassigned[0].name} is unpaired (odd number of players).</p>`;
      }

      html += '</div>';
    }

    html += '</div>';
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
    const isScramble = document.getElementById('new-round-scramble')?.checked || false;
    const roundData = {
      id: nextId(),
      name,
      holes,
      pars,
      activeRules: [...state.globalRules],
      scores: {},
      scramble: isScramble,
      teams: isScramble ? [] : undefined,
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

  // Random rules buttons
  document.querySelectorAll('.random-rules-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const round = state.rounds.find(r => r.id === btn.dataset.round);
      if (!round) return;
      const count = parseInt(btn.dataset.count) || 5;
      const shuffled = [...RULES_LIBRARY].sort(() => Math.random() - 0.5);
      round.activeRules = shuffled.slice(0, count).map(r => r.id);
      persist();
      toast(`${count} random rules assigned`);
    });
  });

  // Preset rule packs
  document.querySelectorAll('.preset-rules-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const round = state.rounds.find(r => r.id === btn.dataset.round);
      if (!round) return;
      const preset = btn.dataset.preset;
      const presets = {
        chill: ['birdie-bonus', 'worst-hole-mulligan', 'par-streak', 'happy-hour', 'even-steven'],
        chaos: ['double-bogey-tax', 'snowman-shame', 'lucky-seven', 'the-yo-yo', 'the-jinx', 'roller-coaster', 'palindrome-round', 'the-double-down'],
        beer: ['beer-per-birdie', 'beer-handicap', 'sober-penalty', 'party-animal', 'two-beer-minimum', 'buzzkill', 'happy-hour', 'beer-bogey-combo', 'the-six-pack'],
        competitive: ['birdie-bonus', 'eagle-jackpot', 'double-bogey-tax', 'consistency-bonus', 'par-streak', 'no-bogeys', 'front-nine-back-nine', 'comeback-kid']
      };
      round.activeRules = presets[preset] || [];
      persist();
      toast(`"${preset}" rules applied`);
    });
  });

  // Clear all rules
  document.querySelectorAll('.clear-rules-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const round = state.rounds.find(r => r.id === btn.dataset.round);
      if (!round) return;
      round.activeRules = [];
      persist();
      toast('Rules cleared');
    });
  });

  // Longest Drive / Closest to Pin selects
  document.querySelectorAll('.ld-ctp-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const round = state.rounds.find(r => String(r.id) === String(sel.dataset.round));
      if (!round) return;
      const field = sel.dataset.field;
      round[field] = sel.value === '' ? null : parseInt(sel.value);
      persist();
      toast(`${field.includes('ld') ? 'Longest Drive' : 'Closest to Pin'} updated`);
    });
  });

  // Scramble toggle on existing rounds
  document.querySelectorAll('.scramble-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const round = state.rounds.find(r => String(r.id) === String(cb.dataset.round));
      if (!round) return;
      round.scramble = cb.checked;
      if (cb.checked && !round.teams) round.teams = [];
      persist().then(() => { renderSetup(); attachSetupListeners(); });
      toast(cb.checked ? 'Scramble mode enabled' : 'Scramble mode disabled');
    });
  });

  // Scramble team management
  document.querySelectorAll('.create-team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const round = state.rounds.find(r => String(r.id) === String(btn.dataset.round));
      if (!round) return;
      const container = btn.closest('.form-row');
      const selects = container.querySelectorAll('.team-player-select');
      const p1 = selects[0]?.value;
      const p2 = selects[1]?.value;
      if (!p1 || !p2 || p1 === p2) { toast('Select two different players'); return; }
      const name1 = state.players.find(p => p.id === p1)?.name || '?';
      const name2 = state.players.find(p => p.id === p2)?.name || '?';
      const teamId = nextId();
      if (!round.teams) round.teams = [];
      round.teams.push({ id: teamId, players: [p1, p2], name: `${name1} & ${name2}` });
      if (!round.scores) round.scores = {};
      round.scores[teamId] = { participated: true, holes: new Array(round.holes).fill(0), beers: 0 };
      persist().then(() => { renderSetup(); attachSetupListeners(); });
      toast(`Team: ${name1} & ${name2}`);
    });
  });

  document.querySelectorAll('.remove-team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const round = state.rounds.find(r => String(r.id) === String(btn.dataset.round));
      if (!round) return;
      const teamId = btn.dataset.team;
      round.teams = (round.teams || []).filter(t => String(t.id) !== String(teamId));
      if (round.scores) delete round.scores[teamId];
      persist().then(() => { renderSetup(); attachSetupListeners(); });
      toast('Team removed');
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

  // --- Editor management ---
  loadAndRenderEditors();

  document.getElementById('add-editor-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('new-editor-email');
    const email = input?.value.trim().toLowerCase();
    if (!email || !email.includes('@')) { toast('Enter a valid email'); return; }
    const editors = await getEditorEmails();
    if (editors.includes(email)) { toast('Already an editor'); return; }
    editors.push(email);
    const ok = await setEditorEmails(editors);
    if (ok) { toast(`${email} added as editor`); input.value = ''; loadAndRenderEditors(); }
    else { toast('Failed to save — check permissions'); }
  });

  document.getElementById('new-editor-email')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-editor-btn')?.click();
  });
}

async function loadAndRenderEditors() {
  const listEl = document.getElementById('editor-list');
  if (!listEl) return;
  const editors = await getEditorEmails();
  if (editors.length === 0) {
    listEl.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">No editors configured. Add one below.</p>';
    return;
  }
  listEl.innerHTML = editors.map(email => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.25rem 0;border-bottom:1px solid #1a2e1a;font-size:0.85rem">
      <span>${email}${currentUser && currentUser.email && email === currentUser.email.toLowerCase() ? ' <span style="color:#6ecf6e;font-size:0.7rem">(you)</span>' : ''}</span>
      <button class="btn btn-danger btn-small remove-editor-btn" data-email="${email}">✕</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.remove-editor-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (currentUser && currentUser.email && email === currentUser.email.toLowerCase()) {
        if (!confirm('Remove yourself as editor? You will lose edit access.')) return;
      }
      const editors = await getEditorEmails();
      const updated = editors.filter(e => e !== email);
      const ok = await setEditorEmails(updated);
      if (ok) {
        toast(`${email} removed`);
        if (currentUser && currentUser.email && email === currentUser.email.toLowerCase()) {
          isEditor = false;
          renderAll();
        } else {
          loadAndRenderEditors();
        }
      } else { toast('Failed to save'); }
    });
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
    <p style="font-size:0.8rem;color:#6a8a6a;margin-top:0.3rem">${awards.length} awards generated from ${state.rounds.filter(r => { const ps = state.players.filter(p => r.scores?.[p.id]?.participated); return ps.length > 0 && ps.every(p => (r.scores[p.id]?.holes || []).filter(h => h && h > 0).length === r.holes); }).length} completed round(s).</p>
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

// === RENDER: Live Round ===
let liveRoundId = null;
let liveHoleIdx = 0;

function renderLiveRound() {
  const container = document.getElementById('liveround-content');
  if (!state.rounds.length) {
    container.innerHTML = '<p class="empty-state">No rounds yet. Go to Setup to create one.</p>';
    return;
  }

  if (!liveRoundId || !state.rounds.find(r => r.id === liveRoundId)) {
    liveRoundId = state.rounds[state.rounds.length - 1].id;
  }
  const round = state.rounds.find(r => r.id === liveRoundId);
  if (!round) return;

  const isScramble = round.scramble && round.teams && round.teams.length > 0;

  // Scoring entities: teams for scramble, individual players otherwise
  let scoringEntities;
  if (isScramble) {
    scoringEntities = round.teams.filter(t => round.scores?.[t.id]?.participated).map(t => ({ id: t.id, name: t.name }));
  } else {
    scoringEntities = state.players.filter(p => round.scores?.[p.id]?.participated).map(p => ({ id: p.id, name: p.name }));
  }

  const participants = state.players.filter(p => {
    if (isScramble) {
      return round.teams.some(t => t.players.includes(p.id) && round.scores?.[t.id]?.participated);
    }
    return round.scores?.[p.id]?.participated;
  });

  const par = round.pars[liveHoleIdx] || 4;
  const holeNum = liveHoleIdx + 1;
  const overrideKey = `${round.id}-${liveHoleIdx}`;
  const effectiveRuleIds = state.holeRuleOverrides[overrideKey] || round.activeRules || [];
  const holeRules = RULES_LIBRARY.filter(r => r.type === 'hole' && effectiveRuleIds.includes(r.id));
  const isLD = (round.ldFront != null && round.ldFront === liveHoleIdx) || (round.ldBack != null && round.ldBack === liveHoleIdx);
  const isCTP = (round.ctpFront != null && round.ctpFront === liveHoleIdx) || (round.ctpBack != null && round.ctpBack === liveHoleIdx);

  let html = '';

  // Round selector
  html += '<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap">';
  html += '<select id="lr-round-select" style="background:#0f1a0f;color:#d4e8d4;border:1px solid #2a4a2a;border-radius:4px;padding:0.4rem 0.6rem;font-size:0.9rem">';
  state.rounds.forEach(r => {
    html += `<option value="${r.id}"${r.id === liveRoundId ? ' selected' : ''}>${r.name}</option>`;
  });
  html += '</select>';
  if (!isEditor) {
    html += '<span style="font-size:0.8rem;color:#6a8a6a">View only — sign in to edit</span>';
  }
  html += '</div>';

  // Hole dots
  html += '<div class="lr-hole-dots">';
  for (let h = 0; h < round.holes; h++) {
    const allScored = scoringEntities.length > 0 && scoringEntities.every(e => {
      const s = round.scores?.[e.id]?.holes?.[h];
      return s && s > 0;
    });
    const cls = h === liveHoleIdx ? 'current' : allScored ? 'scored' : '';
    html += `<div class="lr-dot ${cls}" data-hole="${h}">${h + 1}</div>`;
  }
  html += '</div>';

  // Hole navigation
  html += '<div class="lr-hole-nav">';
  html += `<button class="btn btn-secondary" id="lr-prev" ${liveHoleIdx <= 0 ? 'disabled' : ''}>&#9664; Prev</button>`;
  html += `<div class="lr-hole-indicator">Hole ${holeNum} <span style="font-size:0.85rem;color:#6a8a6a">Par ${par}</span></div>`;
  html += `<button class="btn btn-primary" id="lr-next">${liveHoleIdx >= round.holes - 1 ? 'Finish' : 'Next &#9654;'}</button>`;
  html += '</div>';

  // LD / CTP flags
  if (isLD || isCTP) {
    html += '<div style="text-align:center;margin-bottom:0.5rem">';
    if (isLD) html += '<span style="color:#ffd700;font-weight:700;font-size:0.9rem;margin-right:0.5rem">🏌️ LONGEST DRIVE</span>';
    if (isCTP) html += '<span style="color:#00bfff;font-weight:700;font-size:0.9rem">🎯 CLOSEST TO PIN</span>';
    html += '</div>';
  }

  // Active rules for this hole
  if (holeRules.length > 0) {
    html += '<div class="lr-rules-section"><h4>Active Rules — Hole ' + holeNum + '</h4>';
    holeRules.forEach(rule => {
      const cat = RULE_CATEGORIES[rule.category];
      const triggerText = describeRuleTrigger(rule, par);
      html += `<div class="lr-rule-item"><span class="rule-badge ${rule.category}">${cat?.label || rule.category}</span> <strong>${rule.name}</strong> — ${triggerText}</div>`;
    });
    html += '</div>';
  }

  // Round-level rules reminder
  const roundRules = RULES_LIBRARY.filter(r => r.type === 'round' && effectiveRuleIds.includes(r.id));
  if (roundRules.length > 0) {
    html += '<details class="lr-rules-section" style="margin-top:0.5rem" open><summary style="cursor:pointer;font-size:0.85rem;font-weight:600;color:#8fdf8f">📋 Round Rules (' + roundRules.length + ')</summary>';
    html += '<div style="margin-top:0.4rem">';
    roundRules.forEach(rule => {
      const cat = RULE_CATEGORIES[rule.category];
      html += `<div class="lr-rule-item"><span class="rule-badge ${rule.category}">${cat?.label || rule.category}</span> <strong>${rule.name}</strong> — ${rule.description}</div>`;
    });
    html += '</div></details>';
  }

  // Player/team participation toggles
  if (isScramble) {
    html += '<div class="card" style="margin-bottom:0.75rem"><span style="font-size:0.85rem;font-weight:600;color:#8fdf8f">👥 Scramble Teams (' + scoringEntities.length + ')</span>';
    if (scoringEntities.length === 0) {
      html += '<p style="font-size:0.8rem;color:#6a8a6a;margin-top:0.3rem">No teams set up. Go to Setup to create scramble teams.</p>';
    } else {
      html += '<div style="margin-top:0.3rem;font-size:0.85rem;color:#8aaa8a">';
      scoringEntities.forEach(e => { html += `<div style="padding:0.15rem 0">${e.name}</div>`; });
      html += '</div>';
    }
    html += '</div>';
  } else if (isEditor && state.players.length > 0) {
    const nonParticipants = state.players.filter(p => !participants.find(pp => pp.id === p.id));
    if (nonParticipants.length > 0 || participants.length > 0) {
      html += '<details class="card" style="margin-bottom:0.75rem"><summary style="cursor:pointer;font-size:0.85rem;font-weight:600;color:#8fdf8f">👥 Players (' + participants.length + '/' + state.players.length + ')</summary>';
      html += '<div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.3rem">';
      state.players.forEach(p => {
        const isIn = participants.find(pp => pp.id === p.id);
        html += `<label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.3rem 0">
          <input type="checkbox" class="lr-participate-check" data-player="${p.id}" ${isIn ? 'checked' : ''} />
          ${p.name}${isIn ? '' : ' <span style="color:#5a7a5a;font-size:0.7rem">(not playing)</span>'}
        </label>`;
      });
      html += '</div></details>';
    }
  }

  // Score entry cards (teams for scramble, players otherwise)
  if (scoringEntities.length === 0) {
    html += '<div class="card"><p class="empty-state">No ' + (isScramble ? 'teams' : 'players') + ' participating in this round.' + (isEditor ? (isScramble ? ' Go to Setup to create scramble teams.' : ' Check the Players section above to add them.') : '') + '</p></div>';
  }

  scoringEntities.forEach(entity => {
    const pd = round.scores?.[entity.id];
    const currentScore = pd?.holes?.[liveHoleIdx] || 0;
    const scoreClass = currentScore > 0
      ? (currentScore < par ? (currentScore <= par - 2 ? 'eagle' : 'birdie') : currentScore === par ? 'par' : 'bogey')
      : '';

    let runningRaw = 0;
    let runningPar = 0;
    for (let h = 0; h <= liveHoleIdx; h++) {
      const s = pd?.holes?.[h];
      if (s && s > 0) { runningRaw += s; runningPar += (round.pars[h] || 4); }
    }

    html += `<div class="lr-player-card">`;
    html += `<div class="lr-player-header">`;
    html += `<span class="lr-player-name">${entity.name}</span>`;
    html += `<span class="lr-player-running">${runningRaw > 0 ? `${runningRaw} (${runningRaw - runningPar >= 0 ? '+' : ''}${runningRaw - runningPar})` : '—'}</span>`;
    html += `</div>`;
    html += `<div class="lr-score-row">`;
    html += `<div class="lr-stepper">`;
    html += `<button class="lr-stepper-btn" data-player="${entity.id}" data-dir="-1"${!isEditor ? ' disabled' : ''}>−</button>`;
    html += `<div class="lr-stepper-val ${scoreClass}">${currentScore > 0 ? currentScore : '—'}</div>`;
    html += `<button class="lr-stepper-btn" data-player="${entity.id}" data-dir="1"${!isEditor ? ' disabled' : ''}>+</button>`;
    html += `</div>`;
    if (currentScore > 0) {
      const diff = currentScore - par;
      const label = diff === 0 ? 'Par' : diff === -1 ? 'Birdie' : diff === -2 ? 'Eagle' : diff <= -3 ? 'Albatross!' : diff === 1 ? 'Bogey' : diff === 2 ? 'Dbl Bogey' : `+${diff}`;
      const labelColor = diff < 0 ? '#6ecf6e' : diff === 0 ? '#d4e8d4' : '#df8f8f';
      html += `<span style="font-size:0.9rem;font-weight:600;color:${labelColor};min-width:70px;text-align:right">${label}</span>`;
    }
    html += `</div>`;
    html += `</div>`;
  });


  // Running scoreboard
  if (scoringEntities.length > 0) {
    html += '<div class="lr-running-board"><table><thead><tr><th style="text-align:left">' + (isScramble ? 'Team' : 'Player') + '</th><th>Thru</th><th>Raw</th><th>To Par</th></tr></thead><tbody>';
    const board = scoringEntities.map(entity => {
      const pd = round.scores?.[entity.id];
      let raw = 0, parTotal = 0, holesPlayed = 0;
      for (let h = 0; h < round.holes; h++) {
        const s = pd?.holes?.[h];
        if (s && s > 0) { raw += s; parTotal += (round.pars[h] || 4); holesPlayed++; }
      }
      return { name: entity.name, raw, toPar: raw - parTotal, holesPlayed };
    }).sort((a, b) => {
      if (a.holesPlayed === 0 && b.holesPlayed === 0) return 0;
      if (a.holesPlayed === 0) return 1;
      if (b.holesPlayed === 0) return -1;
      return a.toPar - b.toPar;
    });
    board.forEach((p, i) => {
      const toParStr = p.holesPlayed > 0 ? (p.toPar > 0 ? `+${p.toPar}` : p.toPar === 0 ? 'E' : `${p.toPar}`) : '—';
      const rankIcon = i === 0 && p.holesPlayed > 0 ? '🥇 ' : '';
      html += `<tr><td style="text-align:left">${rankIcon}${p.name}</td><td>${p.holesPlayed}</td><td>${p.holesPlayed > 0 ? p.raw : '—'}</td><td style="color:${p.toPar < 0 ? '#6ecf6e' : p.toPar > 0 ? '#df8f8f' : '#d4e8d4'}">${toParStr}</td></tr>`;
    });
    html += '</tbody></table></div>';
  }

  container.innerHTML = html;

  // --- Attach event listeners ---
  document.getElementById('lr-round-select')?.addEventListener('change', (e) => {
    liveRoundId = e.target.value;
    liveHoleIdx = 0;
    renderLiveRound();
  });

  document.getElementById('lr-prev')?.addEventListener('click', () => {
    if (liveHoleIdx > 0) { liveHoleIdx--; renderLiveRound(); }
  });

  document.getElementById('lr-next')?.addEventListener('click', () => {
    if (liveHoleIdx < round.holes - 1) { liveHoleIdx++; renderLiveRound(); }
    else { toast('Round complete!'); }
  });

  container.querySelectorAll('.lr-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      liveHoleIdx = parseInt(dot.dataset.hole);
      renderLiveRound();
    });
  });

  container.querySelectorAll('.lr-stepper-btn:not(.lr-beer-btn):not(.lr-meat-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isEditor) return;
      const entityId = btn.dataset.player;
      const dir = parseInt(btn.dataset.dir);
      const holeIdx = liveHoleIdx;
      const roundId = round.id;

      // Optimistic local update for instant feedback
      ensureScoreData(roundId, entityId);
      const pd = round.scores[entityId];
      const current = pd.holes[holeIdx] || 0;
      const newVal = Math.max(0, current + dir);
      pd.holes[holeIdx] = newVal > 0 ? newVal : null;
      renderLiveRound();

      // Atomic Firestore transaction to prevent clobbering
      transactionalUpdate((s) => {
        const r = s.rounds.find(r => String(r.id) === String(roundId));
        if (!r) return;
        if (!r.scores) r.scores = {};
        if (!r.scores[entityId]) {
          r.scores[entityId] = { holes: new Array(r.holes).fill(null), beers: 0, participated: true };
        }
        const cur = r.scores[entityId].holes[holeIdx] || 0;
        const nv = Math.max(0, cur + dir);
        r.scores[entityId].holes[holeIdx] = nv > 0 ? nv : null;
      }).then(updated => {
        if (updated) state = updated;
      });
    });
  });

  container.querySelectorAll('.lr-participate-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (!isEditor) return;
      const playerId = cb.dataset.player;
      const roundId = round.id;
      const checked = cb.checked;

      ensureScoreData(roundId, playerId);
      round.scores[playerId].participated = checked;
      renderLiveRound();

      transactionalUpdate((s) => {
        const r = s.rounds.find(r => String(r.id) === String(roundId));
        if (!r) return;
        if (!r.scores) r.scores = {};
        if (!r.scores[playerId]) {
          r.scores[playerId] = { holes: new Array(r.holes).fill(null), beers: 0, participated: true };
        }
        r.scores[playerId].participated = checked;
      }).then(updated => {
        if (updated) state = updated;
      });
    });
  });

}

function describeRuleTrigger(rule, par) {
  const triggers = {
    'birdie-bonus': `Score ${par - 1} (birdie) → -1`,
    'eagle-jackpot': `Score ${par - 2} or less (eagle+) → -3`,
    'double-bogey-tax': `Score ${par + 2}+ (double bogey) → +1`,
    'snowman-shame': `Score 8+ → +2`,
    'lucky-seven': `Score exactly 7 → -2`,
    'beer-per-birdie': `Score under par → +1 beer`,
    'hole-in-one': `Score 1 → -5`,
    'triple-bogey-blowup': `Score ${par + 3}+ → +3`,
    'the-deuce': `Score 2 → -2`,
    'par-3-hero': par === 3 ? `Par or better on par 3 → -1` : `Only on par 3 holes`,
    'par-5-survivor': par === 5 ? `Par or better on par 5 → -1` : `Only on par 5 holes`,
    'the-six-pack': `Score 6 → free beer`,
    'the-double-down': `Score ${par * 2} (double par) → +2`,
    'beer-bogey-combo': `Bogey (${par + 1}) with 3+ beers → -1`,
    'the-perfect-ten': `Score 10 → free beer`,
  };
  return triggers[rule.id] || rule.description;
}

function getPersonalizedTips(player, round, holeIdx, effectiveRuleIds, currentScore) {
  const tips = [];
  const pd = round.scores?.[player.id];
  const holes = pd?.holes || [];
  const par = round.pars[holeIdx] || 4;

  // Build the array of scores so far (completed holes) for pattern detection
  const prevScores = [];
  for (let h = 0; h < holeIdx; h++) {
    const s = holes[h];
    if (s && s > 0) prevScores.push(s);
  }

  // Hat Trick: same score 3 in a row
  if (effectiveRuleIds.includes('the-hat-trick') && prevScores.length >= 2) {
    const last2 = prevScores.slice(-2);
    if (last2[0] === last2[1]) {
      tips.push({ type: 'bonus', icon: '🎩', text: `Score ${last2[0]} for a Hat Trick (-1)` });
    }
  }

  // The Staircase: 3+ scores going up by 1
  if (effectiveRuleIds.includes('the-staircase') && prevScores.length >= 2) {
    let stairLen = 1;
    for (let i = prevScores.length - 1; i > 0; i--) {
      if (prevScores[i] === prevScores[i - 1] + 1) stairLen++;
      else break;
    }
    if (stairLen >= 2) {
      const nextStair = prevScores[prevScores.length - 1] + 1;
      tips.push({ type: 'penalty', icon: '📈', text: `Avoid ${nextStair} — would trigger Staircase (+1)` });
    }
  }

  // The Slide: 3+ scores going down by 1
  if (effectiveRuleIds.includes('the-slide') && prevScores.length >= 2) {
    let slideLen = 1;
    for (let i = prevScores.length - 1; i > 0; i--) {
      if (prevScores[i] === prevScores[i - 1] - 1) slideLen++;
      else break;
    }
    if (slideLen >= 2) {
      const nextSlide = prevScores[prevScores.length - 1] - 1;
      if (nextSlide > 0) {
        tips.push({ type: 'bonus', icon: '🛝', text: `Score ${nextSlide} to trigger The Slide (-2)` });
      }
    }
  }

  // Par Streak: 3+ consecutive pars
  if (effectiveRuleIds.includes('par-streak') && prevScores.length >= 2) {
    let parStreak = 0;
    for (let i = prevScores.length - 1; i >= 0; i--) {
      const holePar = round.pars[i] || 4;
      if (prevScores[i] === holePar) parStreak++;
      else break;
    }
    if (parStreak >= 2) {
      tips.push({ type: 'bonus', icon: '🎯', text: `Score ${par} (par) to extend par streak to ${parStreak + 1}${parStreak === 2 ? ' and trigger -2 bonus!' : '+'}` });
    }
  }

  // Bogey Train: 3+ bogeys in a row
  if (effectiveRuleIds.includes('bogey-train') && prevScores.length >= 2) {
    let bogeyStreak = 0;
    for (let i = prevScores.length - 1; i >= 0; i--) {
      const holePar = round.pars[i] || 4;
      if (prevScores[i] === holePar + 1) bogeyStreak++;
      else break;
    }
    if (bogeyStreak >= 2) {
      tips.push({ type: 'penalty', icon: '🚂', text: `Avoid ${par + 1} (bogey) — would trigger Bogey Train (+2)` });
    }
  }

  // Foursome Special: 4 fours in a row
  if (effectiveRuleIds.includes('foursome-special') && prevScores.length >= 3) {
    let fourStreak = 0;
    for (let i = prevScores.length - 1; i >= 0; i--) {
      if (prevScores[i] === 4) fourStreak++;
      else break;
    }
    if (fourStreak >= 3) {
      tips.push({ type: 'bonus', icon: '4️⃣', text: `Score 4 to complete a Foursome Special (-2)` });
    }
  }

  // The Sandwich: same score on holes N and N+2
  if (effectiveRuleIds.includes('the-sandwich') && prevScores.length >= 2) {
    const twoBack = prevScores[prevScores.length - 2];
    const oneBack = prevScores[prevScores.length - 1];
    if (twoBack !== oneBack) {
      tips.push({ type: 'bonus', icon: '🥪', text: `Score ${twoBack} for a Sandwich (same as 2 holes ago)` });
    }
  }

  // The Yo-Yo: alternating up-down
  if (effectiveRuleIds.includes('the-yo-yo') && prevScores.length >= 3) {
    let yoyoLen = 1;
    for (let i = prevScores.length - 1; i >= 2; i--) {
      const prev = prevScores[i] - prevScores[i - 1];
      const prevPrev = prevScores[i - 1] - prevScores[i - 2];
      if ((prev > 0 && prevPrev < 0) || (prev < 0 && prevPrev > 0)) yoyoLen++;
      else break;
    }
    if (yoyoLen >= 3) {
      const lastDir = prevScores[prevScores.length - 1] - prevScores[prevScores.length - 2];
      if (lastDir > 0) {
        tips.push({ type: 'bonus', icon: '🪀', text: `Score lower than ${prevScores[prevScores.length - 1]} to extend Yo-Yo${yoyoLen === 3 ? ' and trigger -2!' : ''}` });
      } else if (lastDir < 0) {
        tips.push({ type: 'bonus', icon: '🪀', text: `Score higher than ${prevScores[prevScores.length - 1]} to extend Yo-Yo${yoyoLen === 3 ? ' and trigger -2!' : ''}` });
      }
    }
  }

  // The Fiver: 5 fives total
  if (effectiveRuleIds.includes('the-fiver')) {
    const fiveCount = prevScores.filter(s => s === 5).length;
    if (fiveCount >= 4) {
      tips.push({ type: 'bonus', icon: '🖐️', text: `Score 5 for your ${fiveCount + 1}th five — triggers The Fiver (-2)!` });
    } else if (fiveCount >= 2) {
      tips.push({ type: 'fun', icon: '🖐️', text: `${fiveCount} fives so far — need ${5 - fiveCount} more for The Fiver (-2)` });
    }
  }

  // General score-based tips if nothing personalized
  const activeHoleRules = RULES_LIBRARY.filter(r => r.type === 'hole' && effectiveRuleIds.includes(r.id));
  if (tips.length === 0 && activeHoleRules.length > 0) {
    const bonusScores = [];
    for (const rule of activeHoleRules) {
      if (rule.id === 'birdie-bonus' && par - 1 > 0) bonusScores.push(par - 1);
      if (rule.id === 'eagle-jackpot' && par - 2 > 0) bonusScores.push(par - 2);
      if (rule.id === 'the-deuce') bonusScores.push(2);
      if (rule.id === 'par-3-hero' && par === 3) bonusScores.push(3);
      if (rule.id === 'par-5-survivor' && par === 5) bonusScores.push(5);
    }
    if (bonusScores.length > 0) {
      const best = Math.min(...bonusScores);
      tips.push({ type: 'bonus', icon: '🎯', text: `Target: ${best} for maximum bonus` });
    }
  }

  return tips;
}

// === Render All ===
// --- GolfCourseAPI Course Search ---
const GOLF_API_KEY = 'DFED3RLNN5GJIJFH7CMCCRJDYI';
const GOLF_API_BASE = 'https://api.golfcourseapi.com/v1';

async function searchCourses() {
  const input = document.getElementById('course-search-input');
  const resultsDiv = document.getElementById('course-search-results');
  const query = input?.value.trim();
  if (!query) { if (resultsDiv) resultsDiv.innerHTML = ''; return; }

  resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">Searching...</p>';

  try {
    const resp = await fetch(`${GOLF_API_BASE}/search?search_query=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Key ${GOLF_API_KEY}` }
    });
    if (!resp.ok) throw new Error('API error ' + resp.status);
    const data = await resp.json();
    const courses = data.courses || [];

    if (courses.length === 0) {
      resultsDiv.innerHTML = '<p style="font-size:0.8rem;color:#6a8a6a">No courses found. Try a different search.</p>';
      return;
    }

    resultsDiv.innerHTML = courses.slice(0, 15).map(c => {
      const loc = c.location || {};
      const tee = c.tees?.male?.[0] || c.tees?.female?.[0];
      const holes = tee?.number_of_holes || '?';
      const par = tee?.par_total || '?';
      return `
      <div class="course-result" data-course-id="${c.id}" style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;border-bottom:1px solid #1a2e1a;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='#1a2e1a'" onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-weight:600;font-size:0.85rem">${c.course_name || c.club_name || 'Unknown'}</div>
          <div style="font-size:0.75rem;color:#6a8a6a">${loc.city || ''}${loc.state ? ', ' + loc.state : ''} · ${holes} holes · Par ${par}</div>
        </div>
        <button class="btn btn-primary btn-small" data-select-course="${c.id}">Select</button>
      </div>`;
    }).join('');

    resultsDiv.querySelectorAll('[data-select-course]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const courseId = btn.dataset.selectCourse;
        await selectCourse(courseId, courses.find(c => String(c.id) === String(courseId)));
      });
    });
  } catch (err) {
    resultsDiv.innerHTML = `<p style="font-size:0.8rem;color:#c0392b">Search failed: ${err.message}</p>`;
  }
}

async function selectCourse(courseId, course) {
  const resultsDiv = document.getElementById('course-search-results');

  const name = course.course_name || course.club_name || 'Unknown Course';
  const loc = course.location || {};
  const tee = course.tees?.male?.[0] || course.tees?.female?.[0];
  const holes = tee?.number_of_holes || 18;
  const parTotal = tee?.par_total || null;

  let pars = null;
  if (tee?.holes && Array.isArray(tee.holes) && tee.holes.length > 0) {
    pars = tee.holes.map(h => h.par || 4);
  }

  document.getElementById('new-round-name').value = name;
  const holesSelect = document.getElementById('new-round-holes');
  if (holes <= 9) holesSelect.value = '9';
  else holesSelect.value = '18';

  window._pendingCourseInfo = {
    id: courseId,
    name,
    city: loc.city || '',
    state: loc.state || '',
    type: '',
    par: parTotal,
    holes: holes,
    year_built: null,
    phone: '',
    website: '',
    latitude: loc.latitude || null,
    longitude: loc.longitude || null,
    address: loc.address || '',
    pars: pars
  };

  if (pars) {
    window._pendingCoursePars = pars;
  }

  resultsDiv.innerHTML = `
    <div style="padding:0.5rem;background:#1a2e1a;border-radius:4px;font-size:0.85rem">
      <strong style="color:#8fdf8f">✓ Selected: ${name}</strong>
      <div style="color:#6a8a6a;font-size:0.8rem">${loc.city || ''}${loc.state ? ', ' + loc.state : ''} · Par ${parTotal || '?'} · ${holes} holes</div>
      ${pars ? `<div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.3rem">Pars: ${pars.join(', ')}</div>` : '<div style="color:#6a8a6a;font-size:0.75rem;margin-top:0.3rem">No hole-by-hole par data available — you can enter pars manually after adding the round.</div>'}
      <div style="margin-top:0.3rem;font-size:0.75rem;color:#6a8a6a">Click "Add Round" to create the round with this course.</div>
    </div>
  `;

  toast(`Selected: ${name}`);
}

// === RENDER: Hole Guide ===
// Active round tracking
let activeHoleGuideRound = null;
let activeHoleNum = 0; // 0 = not started, 1-18 = on that hole

function renderHoleGuide() {
  const container = document.getElementById('holeguide-content');
  if (!state.rounds.length) {
    container.innerHTML = '<p class="empty-state">No rounds yet. Go to Setup to create one.</p>';
    return;
  }

  let html = '<p style="font-size:0.8rem;color:#6a8a6a;margin-bottom:1rem">Use this on the course to see what rules apply to each hole and what scores trigger bonuses or penalties.</p>';

  // Round selector
  html += '<div style="margin-bottom:0.5rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap"><label style="font-size:0.85rem;color:#8fdf8f;font-weight:600">Round:</label> ';
  html += `<select id="holeguide-round-select" style="background:#0f1a0f;color:#d4e8d4;border:1px solid #2a4a2a;border-radius:4px;padding:0.3rem 0.5rem;font-size:0.85rem">`;
  state.rounds.forEach((r, i) => {
    html += `<option value="${r.id}"${i === 0 ? ' selected' : ''}>${r.name} (${r.holes} holes)</option>`;
  });
  html += '</select>';

  // Start/navigation buttons
  if (activeHoleNum > 0) {
    html += `<button class="btn btn-small btn-secondary" id="hg-prev-hole" ${activeHoleNum <= 1 ? 'disabled' : ''}>← Prev</button>`;
    html += `<span style="font-size:0.9rem;color:#8fdf8f;font-weight:600">Hole ${activeHoleNum}</span>`;
    html += `<button class="btn btn-small btn-primary" id="hg-next-hole">Next →</button>`;
    html += `<button class="btn btn-small btn-danger" id="hg-stop-round">Stop</button>`;
  } else {
    html += `<button class="btn btn-small btn-primary" id="hg-start-round">▶ Start Round</button>`;
  }
  html += '</div>';

  html += '<div id="holeguide-holes"></div>';
  container.innerHTML = html;

  // Render for first round by default
  const selectedRoundId = activeHoleGuideRound || state.rounds[0].id;
  renderHoleGuideForRound(selectedRoundId);

  document.getElementById('holeguide-round-select')?.addEventListener('change', (e) => {
    activeHoleGuideRound = e.target.value;
    activeHoleNum = 0;
    renderHoleGuide();
  });

  document.getElementById('hg-start-round')?.addEventListener('click', () => {
    activeHoleGuideRound = document.getElementById('holeguide-round-select')?.value || state.rounds[0].id;
    activeHoleNum = 1;
    renderHoleGuide();
  });

  document.getElementById('hg-prev-hole')?.addEventListener('click', () => {
    if (activeHoleNum > 1) { activeHoleNum--; renderHoleGuide(); }
  });

  document.getElementById('hg-next-hole')?.addEventListener('click', () => {
    const round = state.rounds.find(r => String(r.id) === String(activeHoleGuideRound));
    if (round && activeHoleNum < round.holes) { activeHoleNum++; renderHoleGuide(); }
    else { activeHoleNum = 0; renderHoleGuide(); toast('Round complete!'); }
  });

  document.getElementById('hg-stop-round')?.addEventListener('click', () => {
    activeHoleNum = 0;
    renderHoleGuide();
  });
}

function renderHoleGuideForRound(roundId) {
  const round = state.rounds.find(r => String(r.id) === String(roundId));
  if (!round) return;
  const holesDiv = document.getElementById('holeguide-holes');
  if (!holesDiv) return;

  const activeRules = round.activeRules || [];
  const holeRules = RULES_LIBRARY.filter(r => r.type === 'hole' && activeRules.includes(r.id));
  const roundRules = RULES_LIBRARY.filter(r => r.type === 'round' && activeRules.includes(r.id));

  let html = '';

  // Round-level rules summary
  if (roundRules.length > 0) {
    html += '<div class="card" style="background:#0f1a0f"><h3 style="font-size:0.9rem">📋 Round-Level Rules (apply at end)</h3>';
    roundRules.forEach(rule => {
      html += `<div style="padding:0.2rem 0;font-size:0.8rem"><span style="color:#6ecf6e">•</span> <strong>${rule.name}</strong>: ${rule.description}</div>`;
    });
    html += '</div>';
  }

  // Hole-by-hole guide
  for (let h = 0; h < round.holes; h++) {
    const par = round.pars[h] || 4;
    const holeNum = h + 1;

    // Check for per-hole overrides
    const overrideKey = `${round.id}-${h}`;
    const overrideRules = state.holeRuleOverrides[overrideKey];
    const effectiveRuleIds = overrideRules || activeRules;
    const effectiveHoleRules = RULES_LIBRARY.filter(r => r.type === 'hole' && effectiveRuleIds.includes(r.id));

    // Calculate optimal scores
    let tips = [];

    // Check what scores trigger bonuses
    effectiveHoleRules.forEach(rule => {
      if (rule.id === 'birdie-bonus') tips.push({ score: par - 1, text: `Birdie (${par - 1}) → -1 bonus`, type: 'bonus' });
      if (rule.id === 'eagle-jackpot') tips.push({ score: par - 2, text: `Eagle (${par - 2}) → -3 bonus!`, type: 'bonus' });
      if (rule.id === 'hole-in-one') tips.push({ score: 1, text: `Hole in one (1) → -5 bonus!!`, type: 'bonus' });
      if (rule.id === 'the-deuce') tips.push({ score: 2, text: `Deuce (2) → -2 bonus`, type: 'bonus' });
      if (rule.id === 'lucky-seven') tips.push({ score: 7, text: `Lucky 7 (7) → -2 bonus`, type: 'bonus' });
      if (rule.id === 'par-3-hero' && par === 3) tips.push({ score: par, text: `Par on a par 3 → -1 bonus`, type: 'bonus' });
      if (rule.id === 'par-5-survivor' && par === 5) tips.push({ score: par, text: `Par on a par 5 → -1 bonus`, type: 'bonus' });
      if (rule.id === 'double-bogey-tax') tips.push({ score: par + 2, text: `Double bogey (${par + 2}+) → +1 penalty`, type: 'penalty' });
      if (rule.id === 'triple-bogey-blowup') tips.push({ score: par + 3, text: `Triple bogey (${par + 3}+) → +3 penalty`, type: 'penalty' });
      if (rule.id === 'snowman-shame') tips.push({ score: 8, text: `Snowman (8+) → +2 penalty`, type: 'penalty' });
      if (rule.id === 'the-double-down') tips.push({ score: par * 2, text: `Double par (${par * 2}) → +2 penalty`, type: 'penalty' });
      if (rule.id === 'the-six-pack') tips.push({ score: 6, text: `Six (6) → free beer!`, type: 'fun' });
      if (rule.id === 'beer-per-birdie') tips.push({ score: par - 1, text: `Birdie → +1 beer count`, type: 'fun' });
      if (rule.id === 'beer-bogey-combo') tips.push({ score: par + 1, text: `Bogey + 3 beers → -1 bonus`, type: 'bonus' });
    });

    // Determine optimal score
    const bonusTips = tips.filter(t => t.type === 'bonus').sort((a, b) => a.score - b.score);
    const bestTarget = bonusTips.length > 0 ? bonusTips[0].score : par;

    const hasOverride = !!overrideRules;
    const isCurrentHole = activeHoleNum === holeNum;
    const isLD = (round.ldFront != null && round.ldFront === h) || (round.ldBack != null && round.ldBack === h);
    const isCTP = (round.ctpFront != null && round.ctpFront === h) || (round.ctpBack != null && round.ctpBack === h);
    const bgColor = isCurrentHole ? '#1a2a1a' : hasOverride ? '#1a1a0f' : '';
    const borderStyle = isCurrentHole ? 'border:2px solid #6ecf6e;' : '';

    html += `<div class="card" style="padding:0.6rem 0.8rem;${bgColor ? 'background:' + bgColor + ';' : ''}${borderStyle}margin-bottom:0.4rem"${isCurrentHole ? ' id="current-hole"' : ''}>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong style="color:#8fdf8f;font-size:1rem">${isCurrentHole ? '▶ ' : ''}Hole ${holeNum}</strong>
          <span style="color:#6a8a6a;font-size:0.85rem;margin-left:0.5rem">Par ${par}</span>
          ${isLD ? '<span style="color:#ffd700;font-size:0.75rem;margin-left:0.3rem;font-weight:600">🏌️ LONGEST DRIVE</span>' : ''}
          ${isCTP ? '<span style="color:#00bfff;font-size:0.75rem;margin-left:0.3rem;font-weight:600">🎯 CLOSEST TO PIN</span>' : ''}
          ${hasOverride ? '<span style="color:#a0a020;font-size:0.7rem;margin-left:0.3rem">(custom rules)</span>' : ''}
        </div>
        <div style="font-size:0.8rem;color:#6ecf6e">🎯 Target: <strong>${bestTarget}</strong></div>
      </div>`;

    if (tips.length > 0) {
      html += '<div style="margin-top:0.3rem;font-size:0.8rem">';
      tips.forEach(tip => {
        const color = tip.type === 'bonus' ? '#6ecf6e' : tip.type === 'penalty' ? '#cf6e6e' : '#a0a0cf';
        html += `<div style="color:${color};padding:1px 0">${tip.type === 'bonus' ? '✅' : tip.type === 'penalty' ? '⚠️' : '🍺'} ${tip.text}</div>`;
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:0.8rem;color:#6a8a6a;margin-top:0.2rem">No special rules for this hole. Just play your best!</div>';
    }

    html += '</div>';
  }

  // Beer strategy summary
  const beerRules = effectiveRuleIds => RULES_LIBRARY.filter(r => effectiveRuleIds.includes(r.id) && (r.id.includes('beer') || r.id === 'sober-penalty' || r.id === 'party-animal' || r.id === 'designated-driver' || r.id === 'happy-hour' || r.id === 'buzzkill' || r.id === 'two-beer-minimum'));
  const activeBeerRules = beerRules(activeRules);
  if (activeBeerRules.length > 0) {
    html += '<div class="card" style="background:#0f1a0f"><h3 style="font-size:0.9rem">🍺 Beer Strategy</h3>';
    activeBeerRules.forEach(rule => {
      html += `<div style="padding:0.2rem 0;font-size:0.8rem"><span style="color:#cfcf6e">•</span> <strong>${rule.name}</strong>: ${rule.description}</div>`;
    });
    // Optimal beer count
    let optimalBeers = '2-5';
    if (activeRules.includes('party-animal')) optimalBeers = '6+ (legend status)';
    else if (activeRules.includes('happy-hour')) optimalBeers = '4-5 (sweet spot)';
    else if (activeRules.includes('beer-handicap')) optimalBeers = '3+ (every 3 = -1 stroke)';
    else if (activeRules.includes('two-beer-minimum')) optimalBeers = '2+ (meet the minimum)';
    html += `<div style="margin-top:0.3rem;font-size:0.85rem;color:#cfcf6e"><strong>🎯 Optimal beers: ${optimalBeers}</strong></div>`;
    html += '</div>';
  }

  holesDiv.innerHTML = html;

  // Auto-scroll to current hole
  if (activeHoleNum > 0) {
    const currentEl = document.getElementById('current-hole');
    if (currentEl) currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderAll() {
  renderStandings();
  renderLiveRound();
  renderScorecard();
  renderHoleGuide();
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
