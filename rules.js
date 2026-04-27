/**
 * Golf Tournament Rules Library
 * Each rule has: id, name, description, category, type (hole|round), apply(context) => modifier
 * context for hole rules: { score, hole, par, playerName, beers }
 * context for round rules: { totalScore, roundNumber, holesPlayed, beers, playerName }
 * apply() returns { modifier: number, label: string } or null if not triggered
 */

export const RULE_CATEGORIES = {
  bonus: { label: 'Bonus', color: '#2d5a2d' },
  penalty: { label: 'Penalty', color: '#5a2d2d' },
  wild: { label: 'Wild', color: '#5a5a2d' },
  fun: { label: 'Fun', color: '#2d2d5a' },
};

export const RULES_LIBRARY = [
  // === HOLE RULES ===
  {
    id: 'birdie-bonus',
    name: 'Birdie Bonus',
    description: 'Score 1 under par? Take a bonus stroke off.',
    category: 'bonus',
    type: 'hole',
    apply: ({ score, par }) => score === par - 1 ? { modifier: -1, label: 'Birdie Bonus -1' } : null,
  },
  {
    id: 'eagle-jackpot',
    name: 'Eagle Jackpot',
    description: '2 under par earns a massive -3 bonus.',
    category: 'bonus',
    type: 'hole',
    apply: ({ score, par }) => score <= par - 2 ? { modifier: -3, label: 'Eagle Jackpot -3' } : null,
  },
  {
    id: 'double-bogey-tax',
    name: 'Double Bogey Tax',
    description: '2+ over par adds an extra penalty stroke.',
    category: 'penalty',
    type: 'hole',
    apply: ({ score, par }) => score >= par + 2 ? { modifier: 1, label: 'Dbl Bogey Tax +1' } : null,
  },
  {
    id: 'snowman-shame',
    name: 'Snowman Shame',
    description: 'Score an 8 or higher? Add 2 penalty strokes. Ouch.',
    category: 'penalty',
    type: 'hole',
    apply: ({ score }) => score >= 8 ? { modifier: 2, label: 'Snowman +2' } : null,
  },
  {
    id: 'lucky-seven',
    name: 'Lucky 7',
    description: 'Score exactly 7 on any hole and get -2. Lucky you.',
    category: 'wild',
    type: 'hole',
    apply: ({ score }) => score === 7 ? { modifier: -2, label: 'Lucky 7 -2' } : null,
  },
  {
    id: 'beer-per-birdie',
    name: 'Beer Per Birdie',
    description: 'Birdie or better? Your beer count goes up by 1 (no score effect).',
    category: 'fun',
    type: 'hole',
    apply: ({ score, par }) => score < par ? { modifier: 0, label: '🍺 Earned a beer!', beerBonus: 1 } : null,
  },
  {
    id: 'worst-hole-mulligan',
    name: 'Worst Hole Mulligan',
    description: 'Your worst hole score gets replaced with par. Applied at round end.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores, pars }) => {
      if (!holeScores || holeScores.length === 0) return null;
      let worstIdx = 0;
      let worstDiff = -Infinity;
      holeScores.forEach((s, i) => {
        if (s !== null && s !== undefined) {
          const diff = s - (pars[i] || 4);
          if (diff > worstDiff) { worstDiff = diff; worstIdx = i; }
        }
      });
      if (worstDiff <= 0) return null;
      return { modifier: -worstDiff, label: `Mulligan H${worstIdx + 1} -${worstDiff}` };
    },
  },
  {
    id: 'consistency-bonus',
    name: 'Consistency Bonus',
    description: 'All holes within 2 strokes of each other? -3 bonus.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      const range = Math.max(...valid) - Math.min(...valid);
      return range <= 2 ? { modifier: -3, label: 'Consistency -3' } : null;
    },
  },
  {
    id: 'beer-handicap',
    name: 'Beer Handicap',
    description: 'Every 3 beers drank removes 1 stroke. Cheers!',
    category: 'fun',
    type: 'round',
    apply: ({ beers }) => {
      const bonus = Math.floor((beers || 0) / 3);
      return bonus > 0 ? { modifier: -bonus, label: `Beer Handicap -${bonus}` } : null;
    },
  },
  {
    id: 'sober-penalty',
    name: 'Sober Penalty',
    description: "0 beers in a round? That's a +2 penalty. This is a social event.",
    category: 'fun',
    type: 'round',
    apply: ({ beers }) => (beers || 0) === 0 ? { modifier: 2, label: 'Sober Penalty +2' } : null,
  },
  {
    id: 'par-streak',
    name: 'Par Streak',
    description: '3+ consecutive pars in a row earns -2.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores, pars }) => {
      let streak = 0; let maxStreak = 0;
      (holeScores || []).forEach((s, i) => {
        if (s === (pars[i] || 4)) { streak++; maxStreak = Math.max(maxStreak, streak); }
        else { streak = 0; }
      });
      return maxStreak >= 3 ? { modifier: -2, label: `Par Streak (${maxStreak}) -2` } : null;
    },
  },
  {
    id: 'front-nine-back-nine',
    name: 'Front vs Back Challenge',
    description: 'If your back 9 is better than front 9, get -2.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const scores = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (scores.length < 18) return null;
      const front = scores.slice(0, 9).reduce((a, b) => a + b, 0);
      const back = scores.slice(9, 18).reduce((a, b) => a + b, 0);
      return back < front ? { modifier: -2, label: 'Back 9 Win -2' } : null;
    },
  },
  {
    id: 'hole-in-one',
    name: 'Hole in One',
    description: 'Score a 1? Legendary. -5 strokes.',
    category: 'bonus',
    type: 'hole',
    apply: ({ score }) => score === 1 ? { modifier: -5, label: 'ACE! -5' } : null,
  },
  {
    id: 'bogey-train',
    name: 'Bogey Train',
    description: '3+ bogeys in a row adds +2. Get off the train!',
    category: 'penalty',
    type: 'round',
    apply: ({ holeScores, pars }) => {
      let streak = 0; let maxStreak = 0;
      (holeScores || []).forEach((s, i) => {
        if (s === (pars[i] || 4) + 1) { streak++; maxStreak = Math.max(maxStreak, streak); }
        else { streak = 0; }
      });
      return maxStreak >= 3 ? { modifier: 2, label: `Bogey Train (${maxStreak}) +2` } : null;
    },
  },
  {
    id: 'designated-driver',
    name: 'Designated Driver',
    description: '0 beers but best score in the round? -3 bonus for being responsible AND good.',
    category: 'fun',
    type: 'round',
    apply: ({ beers, isBestScore }) => {
      return (beers || 0) === 0 && isBestScore ? { modifier: -3, label: 'DD Bonus -3' } : null;
    },
  },
  {
    id: 'party-animal',
    name: 'Party Animal',
    description: '6+ beers and you still finished? -4 bonus. Legend.',
    category: 'fun',
    type: 'round',
    apply: ({ beers }) => (beers || 0) >= 6 ? { modifier: -4, label: 'Party Animal -4' } : null,
  },
  {
    id: 'triple-bogey-blowup',
    name: 'Triple Bogey Blowup',
    description: '3+ over par on a hole? +3 penalty. Brutal.',
    category: 'penalty',
    type: 'hole',
    apply: ({ score, par }) => score >= par + 3 ? { modifier: 3, label: 'Blowup +3' } : null,
  },
  {
    id: 'even-steven',
    name: 'Even Steven',
    description: 'Finish a round at exactly even par? -2 bonus.',
    category: 'bonus',
    type: 'round',
    apply: ({ totalScore, totalPar }) => totalScore === totalPar ? { modifier: -2, label: 'Even Steven -2' } : null,
  },

  // === SILLY BUT ATTAINABLE RULES ===

  {
    id: 'nice',
    name: 'Nice.',
    description: 'Score exactly 69 for the round. Nice. -3.',
    category: 'fun',
    type: 'round',
    apply: ({ totalScore }) => totalScore === 69 ? { modifier: -3, label: 'Nice. -3' } : null,
  },
  {
    id: 'the-fiver',
    name: 'The Fiver',
    description: 'Score exactly 5 on five different holes. High five! -2.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const fives = (holeScores || []).filter(s => s === 5).length;
      return fives >= 5 ? { modifier: -2, label: 'High Five! -2' } : null;
    },
  },
  {
    id: 'palindrome-round',
    name: 'Palindrome Round',
    description: 'Your hole scores read the same forwards and backwards? -3. Symmetry is beautiful.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      const str = valid.join('');
      return str === str.split('').reverse().join('') ? { modifier: -3, label: 'Palindrome! -3' } : null;
    },
  },
  {
    id: 'the-yo-yo',
    name: 'The Yo-Yo',
    description: 'Alternate up-down-up-down for 4+ holes in a row. Embrace the chaos. -2.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      let streak = 1;
      let maxStreak = 1;
      for (let i = 2; i < valid.length; i++) {
        const prev = valid[i - 1] - valid[i - 2];
        const curr = valid[i] - valid[i - 1];
        if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) { streak++; maxStreak = Math.max(maxStreak, streak); }
        else { streak = 1; }
      }
      return maxStreak >= 4 ? { modifier: -2, label: `Yo-Yo (${maxStreak}) -2` } : null;
    },
  },
  {
    id: 'foursome-special',
    name: 'Foursome Special',
    description: 'Score exactly 4 on four holes in a row. Boring? No. Rewarded. -2.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores }) => {
      let streak = 0;
      for (const s of (holeScores || [])) {
        if (s === 4) { streak++; if (streak >= 4) return { modifier: -2, label: 'Foursome! -2' }; }
        else { streak = 0; }
      }
      return null;
    },
  },
  {
    id: 'the-sandwich',
    name: 'The Sandwich',
    description: 'Same score on holes N and N+2 with a different score on N+1. Three sandwiches in a round? -2.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      let sandwiches = 0;
      for (let i = 0; i < valid.length - 2; i++) {
        if (valid[i] === valid[i + 2] && valid[i] !== valid[i + 1]) sandwiches++;
      }
      return sandwiches >= 3 ? { modifier: -2, label: `Sandwiches (${sandwiches}) -2` } : null;
    },
  },
  {
    id: 'buzzkill',
    name: 'Buzzkill',
    description: 'Exactly 1 beer all round? That half-commitment costs you +1.',
    category: 'fun',
    type: 'round',
    apply: ({ beers }) => (beers || 0) === 1 ? { modifier: 1, label: 'Buzzkill +1' } : null,
  },
  {
    id: 'happy-hour',
    name: 'Happy Hour',
    description: '4 or 5 beers? The sweet spot. -2.',
    category: 'fun',
    type: 'round',
    apply: ({ beers }) => {
      const b = beers || 0;
      return (b === 4 || b === 5) ? { modifier: -2, label: 'Happy Hour -2' } : null;
    },
  },
  {
    id: 'the-deuce',
    name: 'The Deuce',
    description: 'Score a 2 on any hole. Rare and glorious. -2.',
    category: 'bonus',
    type: 'hole',
    apply: ({ score }) => score === 2 ? { modifier: -2, label: 'Deuce! -2' } : null,
  },
  {
    id: 'par-3-hero',
    name: 'Par 3 Hero',
    description: 'Par or better on a par 3? -1 bonus. Short holes, big glory.',
    category: 'bonus',
    type: 'hole',
    apply: ({ score, par }) => par === 3 && score <= 3 ? { modifier: -1, label: 'Par 3 Hero -1' } : null,
  },
  {
    id: 'par-5-survivor',
    name: 'Par 5 Survivor',
    description: 'Par or better on a par 5? That takes patience. -1.',
    category: 'bonus',
    type: 'hole',
    apply: ({ score, par }) => par === 5 && score <= 5 ? { modifier: -1, label: 'Par 5 Survivor -1' } : null,
  },
  {
    id: 'the-six-pack',
    name: 'The Six Pack',
    description: 'Score exactly 6 on any hole. Not great, not terrible. But you get a free beer.',
    category: 'fun',
    type: 'hole',
    apply: ({ score }) => score === 6 ? { modifier: 0, label: '🍺 Six Pack beer!', beerBonus: 1 } : null,
  },
  {
    id: 'comeback-kid',
    name: 'Comeback Kid',
    description: 'Score worse than par on H1-3 but better than par on H7-9? -2 for the redemption arc.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores, pars }) => {
      const scores = holeScores || [];
      const p = pars || [];
      if (scores.length < 9) return null;
      const earlyBad = scores[0] > (p[0]||4) && scores[1] > (p[1]||4) && scores[2] > (p[2]||4);
      const lateBetter = scores[6] <= (p[6]||4) && scores[7] <= (p[7]||4) && scores[8] <= (p[8]||4);
      return earlyBad && lateBetter ? { modifier: -2, label: 'Comeback Kid -2' } : null;
    },
  },
  {
    id: 'all-evens',
    name: 'All Evens',
    description: 'Every hole score is an even number? -2. Math nerd.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      return valid.every(s => s % 2 === 0) ? { modifier: -2, label: 'All Evens -2' } : null;
    },
  },
  {
    id: 'all-odds',
    name: 'All Odds',
    description: 'Every hole score is odd? -2. You beautiful weirdo.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      return valid.every(s => s % 2 === 1) ? { modifier: -2, label: 'All Odds -2' } : null;
    },
  },
  {
    id: 'no-bogeys',
    name: 'Clean Sheet',
    description: 'Finish a round with zero bogeys? -3. Spotless.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores, pars }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      const hasBogey = valid.some((s, i) => s > (pars[i] || 4));
      return !hasBogey ? { modifier: -3, label: 'Clean Sheet -3' } : null;
    },
  },
  {
    id: 'the-roller-coaster',
    name: 'Roller Coaster',
    description: 'Biggest gap between your best and worst hole is 5+? +1 for the drama.',
    category: 'penalty',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      if (valid.length < 4) return null;
      const range = Math.max(...valid) - Math.min(...valid);
      return range >= 5 ? { modifier: 1, label: 'Roller Coaster +1' } : null;
    },
  },
  {
    id: 'two-beer-minimum',
    name: 'Two Beer Minimum',
    description: 'Exactly 2 beers? You met the minimum. -1 for compliance.',
    category: 'fun',
    type: 'round',
    apply: ({ beers }) => (beers || 0) === 2 ? { modifier: -1, label: '2 Beer Min -1' } : null,
  },
  {
    id: 'the-jinx',
    name: 'The Jinx',
    description: 'Score 13 total on any 3 consecutive holes. Spooky. +1.',
    category: 'penalty',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      for (let i = 0; i < valid.length - 2; i++) {
        if (valid[i] + valid[i+1] + valid[i+2] === 13) return { modifier: 1, label: 'Jinxed! +1' };
      }
      return null;
    },
  },
  {
    id: 'the-hat-trick',
    name: 'Hat Trick',
    description: 'Same score on 3 holes in a row. -1 for the pattern.',
    category: 'wild',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      for (let i = 0; i < valid.length - 2; i++) {
        if (valid[i] === valid[i+1] && valid[i+1] === valid[i+2]) {
          return { modifier: -1, label: `Hat Trick (${valid[i]}s) -1` };
        }
      }
      return null;
    },
  },
  {
    id: 'bogey-free-back-nine',
    name: 'Bogey-Free Back 9',
    description: 'No bogeys on holes 10-18? -2. Strong finish.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores, pars }) => {
      const scores = holeScores || [];
      const p = pars || [];
      if (scores.length < 18) return null;
      const backNineBogey = scores.slice(9, 18).some((s, i) => s > (p[i + 9] || 4));
      return !backNineBogey ? { modifier: -2, label: 'Clean Back 9 -2' } : null;
    },
  },
  {
    id: 'the-double-down',
    name: 'Double Down',
    description: 'Score exactly double par on a hole. Impressively bad. +2.',
    category: 'penalty',
    type: 'hole',
    apply: ({ score, par }) => score === par * 2 ? { modifier: 2, label: 'Double Down +2' } : null,
  },
  {
    id: 'beer-bogey-combo',
    name: 'Beer Bogey Combo',
    description: 'Bogey a hole but have 3+ beers logged? No penalty, the beer softens the blow. -1.',
    category: 'fun',
    type: 'hole',
    apply: ({ score, par, beers }) => (score === par + 1 && (beers || 0) >= 3) ? { modifier: -1, label: 'Beer Bogey -1' } : null,
  },
  {
    id: 'the-staircase',
    name: 'The Staircase',
    description: '3+ holes in a row where each score goes up by exactly 1. Going up! +1.',
    category: 'penalty',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      let streak = 1;
      for (let i = 1; i < valid.length; i++) {
        if (valid[i] === valid[i-1] + 1) { streak++; if (streak >= 3) return { modifier: 1, label: `Staircase +1` }; }
        else { streak = 1; }
      }
      return null;
    },
  },
  {
    id: 'the-slide',
    name: 'The Slide',
    description: '3+ holes in a row where each score goes down by exactly 1. Wheee! -2.',
    category: 'bonus',
    type: 'round',
    apply: ({ holeScores }) => {
      const valid = (holeScores || []).filter(s => s !== null && s !== undefined);
      let streak = 1;
      for (let i = 1; i < valid.length; i++) {
        if (valid[i] === valid[i-1] - 1) { streak++; if (streak >= 3) return { modifier: -2, label: `The Slide -2` }; }
        else { streak = 1; }
      }
      return null;
    },
  },
  {
    id: 'the-perfect-ten',
    name: 'The Perfect 10',
    description: 'Score a 10 on any hole. We admire the commitment. Free beer.',
    category: 'fun',
    type: 'hole',
    apply: ({ score }) => score === 10 ? { modifier: 0, label: '🍺 Perfect 10 beer!', beerBonus: 1 } : null,
  },
];

/**
 * Apply hole-level rules to a single hole score
 */
export function applyHoleRules(activeRuleIds, score, hole, par, playerName, beers) {
  const results = [];
  for (const rule of RULES_LIBRARY) {
    if (rule.type !== 'hole') continue;
    if (!activeRuleIds.includes(rule.id)) continue;
    const result = rule.apply({ score, hole, par, playerName, beers });
    if (result) results.push({ ruleId: rule.id, ...result });
  }
  return results;
}

/**
 * Apply round-level rules to a completed round
 */
export function applyRoundRules(activeRuleIds, context) {
  const results = [];
  for (const rule of RULES_LIBRARY) {
    if (rule.type !== 'round') continue;
    if (!activeRuleIds.includes(rule.id)) continue;
    const result = rule.apply(context);
    if (result) results.push({ ruleId: rule.id, ...result });
  }
  return results;
}

/**
 * Get a rule by ID
 */
export function getRule(id) {
  return RULES_LIBRARY.find(r => r.id === id) || null;
}
