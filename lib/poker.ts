export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export type Card = {
  rank: Rank;
  suit: Suit;
  id: string;
};

export type HandEvaluation = {
  category: number;
  label: string;
  tiebreak: number[];
};

export const HAND_LABELS = [
  "High card",
  "One pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ rank, suit, id: `${rank}${suit}` })),
  );
}

export function shuffleDeck(cards: Card[]): Card[] {
  const deck = [...cards];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2;
}

function scoreFive(cards: Card[]): HandEvaluation {
  const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(values)];
  const flush = cards.every((card) => card.suit === cards[0].suit);
  let straightHigh = 0;
  if (unique.length === 5 && unique[0] - unique[4] === 4) straightHigh = unique[0];
  if (unique.join(",") === "14,5,4,3,2") straightHigh = 5;

  if (flush && straightHigh) return { category: 8, label: HAND_LABELS[8], tiebreak: [straightHigh] };
  if (groups[0][1] === 4) return { category: 7, label: HAND_LABELS[7], tiebreak: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 6, label: HAND_LABELS[6], tiebreak: [groups[0][0], groups[1][0]] };
  if (flush) return { category: 5, label: HAND_LABELS[5], tiebreak: values };
  if (straightHigh) return { category: 4, label: HAND_LABELS[4], tiebreak: [straightHigh] };
  if (groups[0][1] === 3) {
    return { category: 3, label: HAND_LABELS[3], tiebreak: [groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)] };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return { category: 2, label: HAND_LABELS[2], tiebreak: [...pairs, groups[2][0]] };
  }
  if (groups[0][1] === 2) {
    return { category: 1, label: HAND_LABELS[1], tiebreak: [groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)] };
  }
  return { category: 0, label: HAND_LABELS[0], tiebreak: values };
}

function combinations<T>(items: T[], choose: number): T[][] {
  if (choose === 0) return [[]];
  if (choose === 1) return items.map((item) => [item]);
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length === choose) {
      result.push(picked);
      return;
    }
    for (let index = start; index <= items.length - (choose - picked.length); index += 1) {
      walk(index + 1, [...picked, items[index]]);
    }
  };
  walk(0, []);
  return result;
}

export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    const values = cards.map((card) => rankValue(card.rank));
    const counts = new Map<number, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const maxCount = groups[0]?.[1] ?? 1;
    const pairCount = groups.filter(([, count]) => count === 2).length;
    const category = maxCount === 4 ? 7 : maxCount === 3 ? 3 : pairCount >= 2 ? 2 : pairCount === 1 ? 1 : 0;
    return { category, label: HAND_LABELS[category], tiebreak: groups.flatMap(([value, count]) => [count, value]) };
  }

  let best: HandEvaluation | null = null;
  combinations(cards, 5).forEach((combo) => {
    const score = scoreFive(combo);
    if (!best || compareHands(score, best) > 0) best = score;
  });
  return best ?? { category: 0, label: HAND_LABELS[0], tiebreak: [] };
}

export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.tiebreak[index] ?? 0) - (b.tiebreak[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type ProbabilityRow = {
  category: number;
  label: string;
  count: number;
  probability: number;
};

const STRAIGHT_MASKS = [
  0b11111,
  0b11111 << 1,
  0b11111 << 2,
  0b11111 << 3,
  0b11111 << 4,
  0b11111 << 5,
  0b11111 << 6,
  0b11111 << 7,
  0b11111 << 8,
  (1 << 12) | 0b1111,
];

function hasStraight(rankMask: number): boolean {
  return STRAIGHT_MASKS.some((mask) => (rankMask & mask) === mask);
}

function categoryFromCounts(
  rankCounts: Uint8Array,
  suitCounts: Uint8Array,
  suitRankMasks: Uint16Array,
  rankMask: number,
): number {
  let flush = false;
  for (let suit = 0; suit < SUITS.length; suit += 1) {
    if (suitCounts[suit] < 5) continue;
    if (hasStraight(suitRankMasks[suit])) return 8;
    flush = true;
  }

  let hasQuads = false;
  let trips = 0;
  let pairsOrBetter = 0;
  for (let rank = 0; rank < RANKS.length; rank += 1) {
    const count = rankCounts[rank];
    if (count === 4) hasQuads = true;
    if (count >= 3) trips += 1;
    if (count >= 2) pairsOrBetter += 1;
  }

  if (hasQuads) return 7;
  if (trips >= 1 && pairsOrBetter >= 2) return 6;
  if (flush) return 5;
  if (hasStraight(rankMask)) return 4;
  if (trips >= 1) return 3;
  if (pairsOrBetter >= 2) return 2;
  if (pairsOrBetter === 1) return 1;
  return 0;
}

export function riverProbabilities(
  hole: Card[],
  board: Card[],
  remainingDeck: Card[],
  actual: boolean,
): { rows: ProbabilityRow[]; total: number; cardsToCome: number } {
  const knownIds = new Set([...hole, ...board].map((card) => card.id));
  const pool = actual ? remainingDeck : createDeck().filter((card) => !knownIds.has(card.id));
  const cardsToCome = Math.max(0, 5 - board.length);
  const counts = Array.from({ length: HAND_LABELS.length }, () => 0);
  const rankCounts = new Uint8Array(RANKS.length);
  const suitCounts = new Uint8Array(SUITS.length);
  const suitRankMasks = new Uint16Array(SUITS.length);
  let rankMask = 0;
  let total = 0;

  [...hole, ...board].forEach((card) => {
    const rank = rankValue(card.rank) - 2;
    const suit = SUITS.indexOf(card.suit);
    rankCounts[rank] += 1;
    suitCounts[suit] += 1;
    rankMask |= 1 << rank;
    suitRankMasks[suit] |= 1 << rank;
  });

  const visit = (start: number, needed: number) => {
    if (needed === 0) {
      counts[categoryFromCounts(rankCounts, suitCounts, suitRankMasks, rankMask)] += 1;
      total += 1;
      return;
    }

    for (let index = start; index <= pool.length - needed; index += 1) {
      const card = pool[index];
      const rank = rankValue(card.rank) - 2;
      const suit = SUITS.indexOf(card.suit);
      const rankBit = 1 << rank;
      rankCounts[rank] += 1;
      suitCounts[suit] += 1;
      rankMask |= rankBit;
      suitRankMasks[suit] |= rankBit;

      visit(index + 1, needed - 1);

      rankCounts[rank] -= 1;
      suitCounts[suit] -= 1;
      if (rankCounts[rank] === 0) rankMask &= ~rankBit;
      suitRankMasks[suit] &= ~rankBit;
    }
  };

  visit(0, cardsToCome);
  const outcomeTotal = total || 1;
  return {
    rows: HAND_LABELS.map((label, category) => ({
      category,
      label,
      count: counts[category],
      probability: (counts[category] / outcomeTotal) * 100,
    })).reverse(),
    total: outcomeTotal,
    cardsToCome,
  };
}

export function cardName(card: Card): string {
  const names: Record<Rank, string> = { "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Nine", T: "Ten", J: "Jack", Q: "Queen", K: "King", A: "Ace" };
  const suits: Record<Suit, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
  return `${names[card.rank]} of ${suits[card.suit]}`;
}
