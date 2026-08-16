import { Card, compareHands, createDeck, evaluateHand, Rank, shuffleDeck } from "./poker";

export type Phase = "preflop" | "flop" | "turn" | "river";
export type Outcome = "win" | "loss" | "tie";

export type Player = {
  id: string;
  name: string;
  initials: string;
  isUser: boolean;
  stack: number;
  hole: Card[];
  folded: boolean;
  roundBet: number;
  accent: string;
};

export type HandSummary = {
  outcome: Outcome;
  headline: string;
  detail: string;
  profit: number;
  winnerIds: string[];
  winningHand: string;
};

export type GameState = {
  players: Player[];
  deck: Card[];
  board: Card[];
  pot: number;
  currentBet: number;
  phase: Phase;
  handNo: number;
  dealerIndex: number;
  status: "playing" | "complete";
  log: string[];
  startingHeroStack: number;
  summary: HandSummary | null;
};

const OPPONENTS = [
  { id: "mira", name: "Mira", initials: "MR", accent: "#d6b96f" },
  { id: "rook", name: "Rook", initials: "RK", accent: "#92b5ad" },
  { id: "vale", name: "Vale", initials: "VA", accent: "#c8907f" },
  { id: "sage", name: "Sage", initials: "SG", accent: "#9ba77c" },
  { id: "nova", name: "Nova", initials: "NV", accent: "#aa94bd" },
];

const phaseNames: Record<Phase, string> = {
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

function take(deck: Card[], count: number): Card[] {
  return Array.from({ length: count }, () => deck.pop()).filter(Boolean) as Card[];
}

function pay(player: Player, amount: number): number {
  const paid = Math.min(player.stack, Math.max(0, amount));
  player.stack -= paid;
  player.roundBet += paid;
  return paid;
}

export function startHand(bankroll: number, opponentCount: number, handNo: number): GameState {
  const deck = shuffleDeck(createDeck());
  const players: Player[] = [
    { id: "you", name: "You", initials: "YOU", isUser: true, stack: bankroll, hole: [], folded: false, roundBet: 0, accent: "#f3c969" },
    ...OPPONENTS.slice(0, opponentCount).map((opponent) => ({ ...opponent, isUser: false, stack: 10_000, hole: [], folded: false, roundBet: 0 })),
  ];

  for (let cardIndex = 0; cardIndex < 2; cardIndex += 1) {
    players.forEach((player) => player.hole.push(...take(deck, 1)));
  }

  const dealerIndex = (handNo - 1) % players.length;
  const smallBlindIndex = (dealerIndex + 1) % players.length;
  const bigBlindIndex = (dealerIndex + 2) % players.length;
  const smallBlind = pay(players[smallBlindIndex], 25);
  const bigBlind = pay(players[bigBlindIndex], 50);
  const pot = smallBlind + bigBlind;

  return {
    players,
    deck,
    board: [],
    pot,
    currentBet: Math.max(smallBlind, bigBlind),
    phase: "preflop",
    handNo,
    dealerIndex,
    status: "playing",
    startingHeroStack: bankroll,
    summary: null,
    log: [
      `Hand #${String(handNo).padStart(4, "0")} begins.`,
      `${players[smallBlindIndex].name} posts $${smallBlind}. ${players[bigBlindIndex].name} posts $${bigBlind}.`,
    ],
  };
}

function preflopStrength(cards: Card[]): number {
  const values: Record<Rank, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const high = Math.max(...cards.map((card) => values[card.rank]));
  const low = Math.min(...cards.map((card) => values[card.rank]));
  const pair = cards[0].rank === cards[1].rank;
  const suited = cards[0].suit === cards[1].suit;
  const connected = Math.abs(high - low) <= 2;
  return Math.min(1, high / 22 + (pair ? 0.28 : 0) + (suited ? 0.08 : 0) + (connected ? 0.06 : 0));
}

function playerStrength(player: Player, board: Card[]): number {
  if (board.length < 3) return preflopStrength(player.hole);
  const evaluation = evaluateHand([...player.hole, ...board]);
  return Math.min(1, evaluation.category / 8 + 0.16 + evaluation.tiebreak[0] / 100);
}

function cloneGame(game: GameState): GameState {
  return {
    ...game,
    board: [...game.board],
    deck: [...game.deck],
    players: game.players.map((player) => ({ ...player, hole: [...player.hole] })),
    log: [...game.log],
    summary: game.summary ? { ...game.summary, winnerIds: [...game.summary.winnerIds] } : null,
  };
}

function addLog(game: GameState, entry: string) {
  game.log.push(entry);
  game.log = game.log.slice(-10);
}

function finish(game: GameState, winnerIds: string[], reason: string): GameState {
  const share = Math.floor(game.pot / winnerIds.length);
  const remainder = game.pot - share * winnerIds.length;
  winnerIds.forEach((id, index) => {
    const winner = game.players.find((player) => player.id === id);
    if (winner) winner.stack += share + (index === 0 ? remainder : 0);
  });

  const hero = game.players[0];
  const heroWon = winnerIds.includes(hero.id);
  const outcome: Outcome = heroWon ? (winnerIds.length > 1 ? "tie" : "win") : "loss";
  const winningPlayer = game.players.find((player) => player.id === winnerIds[0]) ?? hero;
  const winningHand = evaluateHand([...winningPlayer.hole, ...game.board]).label;
  const profit = hero.stack - game.startingHeroStack;
  const winnerNames = winnerIds.map((id) => game.players.find((player) => player.id === id)?.name).filter(Boolean).join(" and ");
  game.status = "complete";
  game.summary = {
    outcome,
    profit,
    winnerIds,
    winningHand,
    headline: outcome === "win" ? "You take the pot." : outcome === "tie" ? "The pot is split." : `${winnerNames} wins the hand.`,
    detail: `${reason} · ${winningHand}`,
  };
  addLog(game, `${winnerNames} wins $${game.pot.toLocaleString()} — ${reason}.`);
  return game;
}

function showdown(game: GameState): GameState {
  const active = game.players.filter((player) => !player.folded);
  const scores = active.map((player) => ({ player, score: evaluateHand([...player.hole, ...game.board]) }));
  let best = scores[0].score;
  scores.slice(1).forEach(({ score }) => {
    if (compareHands(score, best) > 0) best = score;
  });
  const winners = scores.filter(({ score }) => compareHands(score, best) === 0).map(({ player }) => player.id);
  return finish(game, winners, winners.length > 1 ? "Showdown tie" : "Showdown");
}

function advanceStreet(game: GameState): GameState {
  game.players.forEach((player) => { player.roundBet = 0; });
  game.currentBet = 0;
  if (game.phase === "preflop") {
    game.board.push(...take(game.deck, 3));
    game.phase = "flop";
  } else if (game.phase === "flop") {
    game.board.push(...take(game.deck, 1));
    game.phase = "turn";
  } else if (game.phase === "turn") {
    game.board.push(...take(game.deck, 1));
    game.phase = "river";
  } else {
    return showdown(game);
  }
  addLog(game, `${phaseNames[game.phase]} dealt. The action is on you.`);
  return game;
}

export type GameAction = "fold" | "call" | "raise";

export function playAction(current: GameState, action: GameAction, raiseBy = 100): GameState {
  const game = cloneGame(current);
  if (game.status !== "playing") return game;
  const hero = game.players[0];

  if (action === "fold") {
    hero.folded = true;
    addLog(game, "You fold.");
    const contenders = game.players.filter((player) => !player.folded);
    const winner = contenders.sort((a, b) => playerStrength(b, game.board) - playerStrength(a, game.board))[0];
    return finish(game, [winner.id], "Won without showdown");
  }

  if (action === "raise") {
    const target = Math.min(game.currentBet + raiseBy, hero.roundBet + hero.stack);
    const paid = pay(hero, target - hero.roundBet);
    game.currentBet = hero.roundBet;
    game.pot += paid;
    addLog(game, `${game.currentBet > raiseBy ? "You raise" : "You bet"} to $${game.currentBet.toLocaleString()}.`);
  } else {
    const needed = Math.max(0, game.currentBet - hero.roundBet);
    const paid = pay(hero, needed);
    game.pot += paid;
    addLog(game, paid > 0 ? `You call $${paid.toLocaleString()}.` : "You check.");
  }

  game.players.slice(1).forEach((player) => {
    if (player.folded) return;
    const needed = Math.max(0, game.currentBet - player.roundBet);
    if (needed === 0) {
      addLog(game, `${player.name} checks.`);
      return;
    }
    const strength = playerStrength(player, game.board);
    const pressure = 0.22 + Math.min(0.42, needed / Math.max(1, game.pot + needed));
    if (strength + Math.random() * 0.48 < pressure) {
      player.folded = true;
      addLog(game, `${player.name} folds.`);
      return;
    }
    const paid = pay(player, needed);
    game.pot += paid;
    addLog(game, paid < needed ? `${player.name} is all-in for $${paid.toLocaleString()}.` : `${player.name} calls $${paid.toLocaleString()}.`);
  });

  const opponents = game.players.slice(1).filter((player) => !player.folded);
  if (opponents.length === 0) return finish(game, [hero.id], "Everyone else folded");
  return advanceStreet(game);
}

export function phaseLabel(game: GameState): string {
  return phaseNames[game.phase];
}
