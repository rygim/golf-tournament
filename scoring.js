/**
 * Scoring engine — calculates final standings with rules, beers, and multi-round support
 */
import { applyHoleRules, applyRoundRules, RULES_LIBRARY } from './rules.js';

/**
 * Calculate a player's adjusted score for a single round
 */
export function calculateRoundScore(round, playerId, holeRuleOverrides = {}) {
  const playerData = round.scores?.[playerId];
  if (!playerData || !playerData.participated) return null;

  const holes = playerData.holes || [];
  const pars = round.pars || [];
  const activeRules = round.activeRules || [];
  let rawTotal = 0;
  let adjustedTotal = 0;
  let totalPar = 0;
  const holeDetails = [];
  let beerBonuses = 0;

  for (let i = 0; i < round.holes; i++) {
    const score = holes[i];
    const par = pars[i] || 4;
    totalPar += par;

    if (score === null || score === undefined || score === 0) {
      holeDetails.push({ hole: i + 1, score: null, par, modifiers: [], adjusted: null });
      continue;
    }

    rawTotal += score;

    // Determine active rules for this hole: round rules + any per-hole overrides
    const overrideKey = `${round.id}-${i}`;
    const holeActiveRules = holeRuleOverrides[overrideKey] || activeRules;

    const mods = applyHoleRules(holeActiveRules, score, i + 1, par, null, playerData.beers || 0);
    const holeModifier = mods.reduce((sum, m) => sum + m.modifier, 0);
    beerBonuses += mods.reduce((sum, m) => sum + (m.beerBonus || 0), 0);
    adjustedTotal += score + holeModifier;

    holeDetails.push({ hole: i + 1, score, par, modifiers: mods, adjusted: score + holeModifier });
  }

  // Apply round-level rules
  const roundContext = {
    totalScore: rawTotal,
    totalPar,
    roundNumber: null,
    holesPlayed: holes.filter(h => h > 0).length,
    beers: (playerData.beers || 0) + beerBonuses,
    meats: playerData.meats || 0,
    meatPlants: playerData.meatPlants || 0,
    holeScores: holes,
    pars,
    isBestScore: false, // will be set externally if needed
  };

  const roundMods = applyRoundRules(activeRules, roundContext);
  const roundModifier = roundMods.reduce((sum, m) => sum + m.modifier, 0);

  return {
    rawTotal,
    adjustedTotal: adjustedTotal + roundModifier,
    totalPar,
    beers: (playerData.beers || 0) + beerBonuses,
    holeDetails,
    roundModifiers: roundMods,
    holesPlayed: holes.filter(h => h > 0).length,
  };
}

/**
 * Calculate full tournament standings across all rounds
 */
export function calculateStandings(state) {
  const { players, rounds, holeRuleOverrides, beerModifier } = state;
  if (!players.length || !rounds.length) return [];

  const standings = players.map(player => {
    let totalRaw = 0;
    let totalAdjusted = 0;
    let totalPar = 0;
    let totalBeers = 0;
    let roundsPlayed = 0;
    let totalHandicapStrokes = 0;
    const roundResults = [];
    const playerHandicap = player.handicap || 0;

    for (const round of rounds) {
      const result = calculateRoundScore(round, player.id, holeRuleOverrides);
      if (result) {
        // Handicap: full for 18 holes, half (rounded) for 9
        const hcpStrokes = round.holes >= 18 ? playerHandicap : Math.round(playerHandicap / 2);
        totalRaw += result.rawTotal;
        totalAdjusted += result.adjustedTotal - hcpStrokes;
        totalPar += result.totalPar;
        totalBeers += result.beers;
        totalHandicapStrokes += hcpStrokes;
        roundsPlayed++;
        roundResults.push({ roundId: round.id, roundName: round.name, handicapStrokes: hcpStrokes, ...result });
      } else {
        roundResults.push({ roundId: round.id, roundName: round.name, skipped: true });
      }
    }

    // Global beer modifier: every X beers across the tournament = -Y strokes
    const bps = beerModifier?.beersPerStroke || 0;
    const so = beerModifier?.strokesOff || 0;
    const globalBeerBonus = (bps > 0 && so > 0) ? Math.floor(totalBeers / bps) * so : 0;
    totalAdjusted -= globalBeerBonus;

    return {
      playerId: player.id,
      playerName: player.name,
      handicap: playerHandicap,
      totalRaw,
      totalAdjusted,
      totalPar,
      totalBeers,
      globalBeerBonus,
      totalHandicapStrokes,
      roundsPlayed,
      totalRounds: rounds.length,
      roundResults,
      // Score relative to par
      toPar: totalAdjusted - totalPar,
      avgPerRound: roundsPlayed > 0 ? (totalAdjusted / roundsPlayed).toFixed(1) : '-',
    };
  });

  // Sort: lowest adjusted score wins, tiebreak by fewer beers (more sober = better tiebreak... or not)
  standings.sort((a, b) => {
    if (a.roundsPlayed === 0 && b.roundsPlayed === 0) return 0;
    if (a.roundsPlayed === 0) return 1;
    if (b.roundsPlayed === 0) return -1;
    // Normalize by rounds played for fairness
    const aAvg = a.totalAdjusted / a.roundsPlayed;
    const bAvg = b.totalAdjusted / b.roundsPlayed;
    if (aAvg !== bAvg) return aAvg - bAvg;
    return b.totalBeers - a.totalBeers; // more beers wins tiebreak, obviously
  });

  return standings;
}
