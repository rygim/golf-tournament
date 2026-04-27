/**
 * Excel export for Golf Tournament Standings
 * Uses SheetJS (xlsx) loaded from CDN
 */
import { calculateStandings, calculateRoundScore } from './scoring.js';
import { RULES_LIBRARY } from './rules.js';

let XLSX = null;

async function loadXLSX() {
  if (XLSX) return XLSX;
  // Load SheetJS from CDN
  const module = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  XLSX = module;
  return XLSX;
}

/**
 * Export the full tournament to an Excel workbook
 */
export async function exportToExcel(state) {
  const xlsx = await loadXLSX();
  const wb = xlsx.utils.book_new();
  const standings = calculateStandings(state);

  // === Sheet 1: Tournament Standings ===
  const standingsData = [
    [state.tournamentName],
    [`${state.players.length} players · ${state.rounds.length} round(s)`],
    [],
    ['Rank', 'Player', 'Handicap', 'Rounds Played', 'Total Rounds', 'Raw Score', 'Adjusted Score', 'To Par', 'Avg/Round', 'Total Beers', 'Beer Bonus'],
  ];

  standings.forEach((s, i) => {
    const toParStr = s.roundsPlayed > 0 ? (s.toPar > 0 ? `+${s.toPar}` : s.toPar === 0 ? 'E' : `${s.toPar}`) : '-';
    standingsData.push([
      i + 1,
      s.playerName,
      s.handicap || 0,
      s.roundsPlayed,
      s.totalRounds,
      s.roundsPlayed > 0 ? s.totalRaw : '',
      s.roundsPlayed > 0 ? s.totalAdjusted : '',
      toParStr,
      s.avgPerRound,
      s.totalBeers,
      s.globalBeerBonus > 0 ? -s.globalBeerBonus : 0,
    ]);
  });

  // Beer modifier info
  const bps = state.beerModifier?.beersPerStroke || 0;
  const so = state.beerModifier?.strokesOff || 0;
  standingsData.push([]);
  standingsData.push(['Beer Modifier', bps > 0 ? `Every ${bps} beers = -${so} stroke(s)` : 'Disabled']);

  const wsStandings = xlsx.utils.aoa_to_sheet(standingsData);
  // Set column widths
  wsStandings['!cols'] = [
    { wch: 6 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 13 },
    { wch: 11 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 11 },
  ];
  xlsx.utils.book_append_sheet(wb, wsStandings, 'Standings');

  // === Sheet per round: Scorecards ===
  state.rounds.forEach(round => {
    const pars = round.pars || [];
    const header1 = ['Player', 'HCP'];
    const header2 = ['', ''];
    for (let h = 0; h < round.holes; h++) {
      header1.push(`H${h + 1}`);
      header2.push(`Par ${pars[h] || 4}`);
    }
    header1.push('Beers', 'Raw', 'HCP Strokes', 'Adjusted', 'Modifiers');
    header2.push('', '', '', '', '');

    const rows = [header1, header2];

    // Par row
    const parRow = ['PAR', ''];
    for (let h = 0; h < round.holes; h++) parRow.push(pars[h] || 4);
    parRow.push('', pars.reduce((a, b) => a + (b || 4), 0), '', '', '');
    rows.push(parRow);

    state.players.forEach(player => {
      const pd = round.scores?.[player.id];
      if (!pd?.participated) {
        const row = [player.name, player.handicap || 0];
        for (let h = 0; h < round.holes; h++) row.push('');
        row.push('', '', '', 'DNP', '');
        rows.push(row);
        return;
      }

      const result = calculateRoundScore(round, player.id, state.holeRuleOverrides);
      const hcpStrokes = round.holes >= 18 ? (player.handicap || 0) : Math.round((player.handicap || 0) / 2);
      const row = [player.name, player.handicap || 0];

      for (let h = 0; h < round.holes; h++) {
        row.push(pd.holes?.[h] || '');
      }

      const mods = result ? (result.roundModifiers || []).map(m => m.label).join(', ') : '';
      row.push(
        pd.beers || 0,
        result ? result.rawTotal : '',
        hcpStrokes,
        result ? result.adjustedTotal - hcpStrokes : '',
        mods,
      );
      rows.push(row);
    });

    // Active rules for this round
    rows.push([]);
    rows.push(['Active Rules:']);
    const activeRuleNames = (round.activeRules || [])
      .map(id => RULES_LIBRARY.find(r => r.id === id)?.name)
      .filter(Boolean);
    if (activeRuleNames.length) {
      rows.push([activeRuleNames.join(', ')]);
    } else {
      rows.push(['None']);
    }

    const ws = xlsx.utils.aoa_to_sheet(rows);
    // Column widths
    const cols = [{ wch: 18 }, { wch: 6 }];
    for (let h = 0; h < round.holes; h++) cols.push({ wch: 5 });
    cols.push({ wch: 7 }, { wch: 7 }, { wch: 12 }, { wch: 10 }, { wch: 40 });
    ws['!cols'] = cols;

    // Truncate sheet name to 31 chars (Excel limit)
    const sheetName = round.name.substring(0, 31);
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
  });

  // === Sheet: Rules Library ===
  const rulesData = [
    ['Rules Library'],
    [],
    ['Name', 'Type', 'Category', 'Description'],
  ];

  RULES_LIBRARY.forEach(rule => {
    rulesData.push([rule.name, rule.type, rule.category, rule.description]);
  });

  const wsRules = xlsx.utils.aoa_to_sheet(rulesData);
  wsRules['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 60 }];
  xlsx.utils.book_append_sheet(wb, wsRules, 'Rules Library');

  // === Sheet: Scoring Formula ===
  const formulaData = [
    ['How Scoring Works'],
    [],
    ['Adjusted Score = Raw Score + Hole Modifiers + Round Modifiers - Handicap - Global Beer Bonus'],
    [],
    ['Step', 'Description'],
    ['1. Raw Score', 'Actual strokes per hole, added up.'],
    ['2. Hole Modifiers', 'Per-hole rules checked against each score (e.g., Birdie Bonus -1, Snowman Shame +2).'],
    ['3. Round Modifiers', 'Round-level rules applied after all holes (e.g., Par Streak, Consistency Bonus).'],
    ['4. Handicap', 'Full handicap subtracted for 18 holes, half (rounded) for 9 holes.'],
    ['5. Global Beer Bonus', `Every ${bps || '?'} beers = -${so || '?'} stroke(s) off final score.`],
    [],
    ['Ranking', 'Lowest average adjusted score per round wins. Tiebreak: more beers wins.'],
    ['To Par', 'Total adjusted score minus total par across all rounds played.'],
  ];

  const wsFormula = xlsx.utils.aoa_to_sheet(formulaData);
  wsFormula['!cols'] = [{ wch: 22 }, { wch: 70 }];
  xlsx.utils.book_append_sheet(wb, wsFormula, 'Scoring Formula');

  // Generate and download
  const filename = `${state.tournamentName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Tournament'}.xlsx`;
  xlsx.writeFile(wb, filename);
}
