/**
 * Awards Ceremony — auto-generated fun awards based on tournament data
 */
import { calculateStandings, calculateRoundScore } from './scoring.js';

/**
 * Compute all awards for the tournament. Returns an array of { icon, title, winner, detail }.
 */
export function computeAwards(state) {
  const standings = calculateStandings(state);
  const activePlayers = standings.filter(s => s.roundsPlayed > 0);
  if (activePlayers.length < 2) return [];

  const awards = [];

  // Only consider completed rounds
  const completedRounds = state.rounds.filter(round => {
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
  });
  const completedRoundIds = new Set(completedRounds.map(r => r.id));

  // Helper: get all hole scores for a player across completed rounds only
  function getAllHoleData(playerId) {
    const holes = [];
    for (const round of completedRounds) {
      let scoreKey = playerId;
      if (round.scramble && round.teams) {
        const team = round.teams.find(t => t.players.includes(playerId));
        if (team) scoreKey = team.id;
      }
      const pd = round.scores?.[scoreKey];
      if (!pd?.participated) continue;
      const pars = round.pars || [];
      (pd.holes || []).forEach((score, i) => {
        if (score > 0) holes.push({ score, par: pars[i] || 4, round: round.name, hole: i + 1 });
      });
    }
    return holes;
  }

  // Helper: get per-round results for a player (completed rounds only)
  function getRoundResults(playerId) {
    return standings.find(s => s.playerId === playerId)?.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId)) || [];
  }

  // === 1. Tournament Champion ===
  awards.push({
    icon: '🏆',
    title: 'Tournament Champion',
    winner: activePlayers[0].playerName,
    detail: `Adjusted: ${activePlayers[0].totalAdjusted} | Avg/Round: ${activePlayers[0].avgPerRound}`,
  });

  // === 2. Last Place (Lantern Rouge) ===
  const last = activePlayers[activePlayers.length - 1];
  if (last.playerId !== activePlayers[0].playerId) {
    awards.push({
      icon: '🏮',
      title: 'Lantern Rouge',
      winner: last.playerName,
      detail: `Someone has to be last. Adjusted: ${last.totalAdjusted}`,
    });
  }

  // === 3. The Bartender (most beers) ===
  const bartender = [...activePlayers].sort((a, b) => b.totalBeers - a.totalBeers)[0];
  if (bartender.totalBeers > 0) {
    awards.push({
      icon: '🍺',
      title: 'The Bartender',
      winner: bartender.playerName,
      detail: `${bartender.totalBeers} beers across ${bartender.roundsPlayed} round(s). Cheers.`,
    });
  }

  // === 4. Designated Driver (fewest beers, played all rounds) ===
  const fullParticipants = activePlayers.filter(s => s.roundsPlayed === s.totalRounds);
  if (fullParticipants.length > 0) {
    const dd = [...fullParticipants].sort((a, b) => a.totalBeers - b.totalBeers)[0];
    awards.push({
      icon: '🚗',
      title: 'Designated Driver',
      winner: dd.playerName,
      detail: `Only ${dd.totalBeers} beer(s) across the whole tournament. Responsible.`,
    });
  }

  // === 5. Mr. Consistent (lowest score variance across rounds) ===
  const multiRound = activePlayers.filter(s => s.roundsPlayed >= 2);
  if (multiRound.length > 0) {
    let bestVariance = Infinity;
    let consistentPlayer = null;
    for (const s of multiRound) {
      const scores = s.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId)).map(r => r.rawTotal);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, v) => sum + (v - avg) ** 2, 0) / scores.length;
      if (variance < bestVariance) { bestVariance = variance; consistentPlayer = s; }
    }
    if (consistentPlayer) {
      const scores = consistentPlayer.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId)).map(r => r.rawTotal);
      awards.push({
        icon: '📏',
        title: 'Mr. Consistent',
        winner: consistentPlayer.playerName,
        detail: `Round scores: ${scores.join(', ')}. Variance: ${bestVariance.toFixed(1)}`,
      });
    }
  }

  // === 6. Roller Coaster (highest score variance) ===
  if (multiRound.length > 0) {
    let worstVariance = -1;
    let wildPlayer = null;
    for (const s of multiRound) {
      const scores = s.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId)).map(r => r.rawTotal);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, v) => sum + (v - avg) ** 2, 0) / scores.length;
      if (variance > worstVariance) { worstVariance = variance; wildPlayer = s; }
    }
    if (wildPlayer && worstVariance > 0) {
      const scores = wildPlayer.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId)).map(r => r.rawTotal);
      awards.push({
        icon: '🎢',
        title: 'Roller Coaster',
        winner: wildPlayer.playerName,
        detail: `Round scores: ${scores.join(', ')}. Never boring.`,
      });
    }
  }

  // === 7. Blow-Up Artist (single worst hole relative to par) ===
  let worstHole = { player: null, score: 0, par: 0, diff: -Infinity, round: '', hole: 0 };
  for (const s of activePlayers) {
    const holes = getAllHoleData(s.playerId);
    for (const h of holes) {
      const diff = h.score - h.par;
      if (diff > worstHole.diff) {
        worstHole = { player: s.playerName, score: h.score, par: h.par, diff, round: h.round, hole: h.hole };
      }
    }
  }
  if (worstHole.player && worstHole.diff > 0) {
    awards.push({
      icon: '💥',
      title: 'Blow-Up Artist',
      winner: worstHole.player,
      detail: `Scored ${worstHole.score} on a par ${worstHole.par} (${worstHole.round}, H${worstHole.hole}). +${worstHole.diff} over. Yikes.`,
    });
  }

  // === 8. Birdie Machine (most birdies or better) ===
  let mostBirdies = { player: null, count: 0 };
  for (const s of activePlayers) {
    const holes = getAllHoleData(s.playerId);
    const birdies = holes.filter(h => h.score < h.par).length;
    if (birdies > mostBirdies.count) mostBirdies = { player: s.playerName, count: birdies };
  }
  if (mostBirdies.player && mostBirdies.count > 0) {
    awards.push({
      icon: '🐦',
      title: 'Birdie Machine',
      winner: mostBirdies.player,
      detail: `${mostBirdies.count} birdie(s) or better across the tournament.`,
    });
  }

  // === 9. Bogey Magnet (most bogeys) ===
  let mostBogeys = { player: null, count: 0 };
  for (const s of activePlayers) {
    const holes = getAllHoleData(s.playerId);
    const bogeys = holes.filter(h => h.score === h.par + 1).length;
    if (bogeys > mostBogeys.count) mostBogeys = { player: s.playerName, count: bogeys };
  }
  if (mostBogeys.player && mostBogeys.count > 0) {
    awards.push({
      icon: '🧲',
      title: 'Bogey Magnet',
      winner: mostBogeys.player,
      detail: `${mostBogeys.count} bogeys. They just keep coming.`,
    });
  }

  // === 10. The Sandbagger (most handicap strokes used) ===
  const sandbagger = [...activePlayers].sort((a, b) => b.totalHandicapStrokes - a.totalHandicapStrokes)[0];
  if (sandbagger && sandbagger.totalHandicapStrokes > 0) {
    awards.push({
      icon: '🏖️',
      title: 'The Sandbagger',
      winner: sandbagger.playerName,
      detail: `Used ${sandbagger.totalHandicapStrokes} handicap strokes. Totally legit.`,
    });
  }

  // === 11. Most Improved (biggest drop from first to last round) ===
  if (state.rounds.length >= 2) {
    let bestImprovement = { player: null, diff: Infinity };
    for (const s of activePlayers) {
      const played = s.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId));
      if (played.length < 2) continue;
      const first = played[0].rawTotal;
      const last = played[played.length - 1].rawTotal;
      const diff = last - first; // negative = improved
      if (diff < bestImprovement.diff) bestImprovement = { player: s.playerName, diff, first, last };
    }
    if (bestImprovement.player && bestImprovement.diff < 0) {
      awards.push({
        icon: '📈',
        title: 'Most Improved',
        winner: bestImprovement.player,
        detail: `Went from ${bestImprovement.first} to ${bestImprovement.last} (${bestImprovement.diff} strokes). Getting better!`,
      });
    }
  }

  // === 12. Most Declined (biggest increase from first to last round) ===
  if (state.rounds.length >= 2) {
    let worstDecline = { player: null, diff: -Infinity };
    for (const s of activePlayers) {
      const played = s.roundResults.filter(r => !r.skipped && completedRoundIds.has(r.roundId));
      if (played.length < 2) continue;
      const first = played[0].rawTotal;
      const last = played[played.length - 1].rawTotal;
      const diff = last - first;
      if (diff > worstDecline.diff) worstDecline = { player: s.playerName, diff, first, last };
    }
    if (worstDecline.player && worstDecline.diff > 0) {
      awards.push({
        icon: '📉',
        title: 'The Fade',
        winner: worstDecline.player,
        detail: `Went from ${worstDecline.first} to ${worstDecline.last} (+${worstDecline.diff} strokes). The wheels came off.`,
      });
    }
  }

  // === 13. Par Machine (most pars) ===
  let mostPars = { player: null, count: 0 };
  for (const s of activePlayers) {
    const holes = getAllHoleData(s.playerId);
    const pars = holes.filter(h => h.score === h.par).length;
    if (pars > mostPars.count) mostPars = { player: s.playerName, count: pars };
  }
  if (mostPars.player && mostPars.count > 0) {
    awards.push({
      icon: '🎯',
      title: 'Par Machine',
      winner: mostPars.player,
      detail: `${mostPars.count} pars. Steady as she goes.`,
    });
  }

  // === 14. Best Single Round ===
  let bestRound = { player: null, score: Infinity, round: '' };
  for (const s of activePlayers) {
    for (const rr of s.roundResults) {
      if (rr.skipped || !completedRoundIds.has(rr.roundId)) continue;
      if (rr.rawTotal < bestRound.score) {
        bestRound = { player: s.playerName, score: rr.rawTotal, round: rr.roundName };
      }
    }
  }
  if (bestRound.player) {
    awards.push({
      icon: '⭐',
      title: 'Best Single Round',
      winner: bestRound.player,
      detail: `Shot ${bestRound.score} in ${bestRound.round}. Peak performance.`,
    });
  }

  // === 15. Worst Single Round ===
  let worstRound = { player: null, score: -Infinity, round: '' };
  for (const s of activePlayers) {
    for (const rr of s.roundResults) {
      if (rr.skipped || !completedRoundIds.has(rr.roundId)) continue;
      if (rr.rawTotal > worstRound.score) {
        worstRound = { player: s.playerName, score: rr.rawTotal, round: rr.roundName };
      }
    }
  }
  if (worstRound.player && worstRound.score !== bestRound.score) {
    awards.push({
      icon: '🗑️',
      title: 'Worst Single Round',
      winner: worstRound.player,
      detail: `Shot ${worstRound.score} in ${worstRound.round}. We don't talk about it.`,
    });
  }

  // === 16. Best Hole (best score relative to par) ===
  let bestHoleScore = { player: null, score: 0, par: 0, diff: Infinity, round: '', hole: 0 };
  for (const s of activePlayers) {
    const holes = getAllHoleData(s.playerId);
    for (const h of holes) {
      const diff = h.score - h.par;
      if (diff < bestHoleScore.diff || (diff === bestHoleScore.diff && h.score < bestHoleScore.score)) {
        bestHoleScore = { player: s.playerName, score: h.score, par: h.par, diff, round: h.round, hole: h.hole };
      }
    }
  }
  if (bestHoleScore.player && bestHoleScore.diff < Infinity) {
    const label = bestHoleScore.diff <= -2 ? 'Eagle!' : bestHoleScore.diff === -1 ? 'Birdie' : 'Par';
    awards.push({
      icon: '🔥',
      title: 'Best Single Hole',
      winner: bestHoleScore.player,
      detail: `${label} — ${bestHoleScore.score} on a par ${bestHoleScore.par} (${bestHoleScore.round}, H${bestHoleScore.hole}).`,
    });
  }

  // === 17. Comeback King (worst first 3 holes, best last 3 holes in any round) ===
  let bestComeback = { player: null, earlyOver: -Infinity, lateUnder: Infinity };
  for (const s of activePlayers) {
    for (const round of completedRounds) {
      let scoreKey = s.playerId;
      if (round.scramble && round.teams) {
        const team = round.teams.find(t => t.players.includes(s.playerId));
        if (team) scoreKey = team.id;
      }
      const pd = round.scores?.[scoreKey];
      if (!pd?.participated) continue;
      const holes = pd.holes || [];
      const pars = round.pars || [];
      if (holes.length < 6) continue;
      const earlyOver = (holes[0] - (pars[0]||4)) + (holes[1] - (pars[1]||4)) + (holes[2] - (pars[2]||4));
      const last3 = holes.length;
      const lateOver = (holes[last3-3] - (pars[last3-3]||4)) + (holes[last3-2] - (pars[last3-2]||4)) + (holes[last3-1] - (pars[last3-1]||4));
      const swing = earlyOver - lateOver; // bigger = better comeback
      if (earlyOver > 0 && lateOver < earlyOver && swing > (bestComeback.earlyOver - bestComeback.lateUnder)) {
        bestComeback = { player: s.playerName, earlyOver, lateUnder: lateOver, swing, round: round.name };
      }
    }
  }
  if (bestComeback.player) {
    awards.push({
      icon: '💪',
      title: 'Comeback King',
      winner: bestComeback.player,
      detail: `Started +${bestComeback.earlyOver} over par (first 3), finished ${bestComeback.lateUnder >= 0 ? '+' : ''}${bestComeback.lateUnder} (last 3) in ${bestComeback.round}.`,
    });
  }

  // === 18. Iron Liver (most beers per round average) ===
  const withBeers = activePlayers.filter(s => s.totalBeers > 0);
  if (withBeers.length > 0) {
    const ironLiver = [...withBeers].sort((a, b) => (b.totalBeers / b.roundsPlayed) - (a.totalBeers / a.roundsPlayed))[0];
    const avg = (ironLiver.totalBeers / ironLiver.roundsPlayed).toFixed(1);
    awards.push({
      icon: '🫁',
      title: 'Iron Liver',
      winner: ironLiver.playerName,
      detail: `${avg} beers per round average. Built different.`,
    });
  }


  // === 20. Rule Beneficiary (most bonus strokes from rules) ===
  let mostRuleBonus = { player: null, bonus: 0 };
  for (const s of activePlayers) {
    const rawMinusAdj = s.totalRaw - (s.totalAdjusted + s.totalHandicapStrokes + s.globalBeerBonus);
    if (rawMinusAdj > mostRuleBonus.bonus) {
      mostRuleBonus = { player: s.playerName, bonus: rawMinusAdj };
    }
  }
  if (mostRuleBonus.player && mostRuleBonus.bonus > 0) {
    awards.push({
      icon: '📜',
      title: 'Rule Lawyer',
      winner: mostRuleBonus.player,
      detail: `Gained ${mostRuleBonus.bonus} stroke(s) from rule modifiers alone. Knows the system.`,
    });
  }

  // === 21. Rule Victim (most penalty strokes from rules) ===
  let mostRulePenalty = { player: null, penalty: 0 };
  for (const s of activePlayers) {
    const rawMinusAdj = s.totalRaw - (s.totalAdjusted + s.totalHandicapStrokes + s.globalBeerBonus);
    if (rawMinusAdj < mostRulePenalty.penalty) {
      mostRulePenalty = { player: s.playerName, penalty: rawMinusAdj };
    }
  }
  if (mostRulePenalty.player && mostRulePenalty.penalty < 0) {
    awards.push({
      icon: '⚖️',
      title: 'Rule Victim',
      winner: mostRulePenalty.player,
      detail: `Lost ${Math.abs(mostRulePenalty.penalty)} stroke(s) to rule penalties. The rules giveth and taketh.`,
    });
  }

  return awards;
}
