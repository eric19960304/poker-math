"use client";

import { useEffect, useMemo, useState } from "react";
import { GameState, Outcome, phaseLabel, playAction, startHand } from "../lib/game";
import { Card, cardName, evaluateHand, riverProbabilities } from "../lib/poker";

type Stats = { bankroll: number; wins: number; losses: number; ties: number; hands: number };
type HistoryEntry = { handNo: number; outcome: Outcome; profit: number; hand: string; detail: string };
type View = "play" | "learn" | "history";

const STORAGE_KEY = "river-lab-v1";
const STARTING_BANKROLL = 10_000;
const defaultStats: Stats = { bankroll: STARTING_BANKROLL, wins: 0, losses: 0, ties: 0, hands: 0 };
const probabilityColors = ["#c7bda8", "#e2bd5d", "#d98965", "#9e78c8", "#64b895", "#4f9bc7", "#cf8f79", "#8071a5", "#d8a73b"];

function money(value: number): string {
  return `$${Math.abs(value).toLocaleString()}`;
}

function formatProbability(value: number): string {
  return value > 0 && value < 0.005 ? "<0.01" : value.toFixed(2);
}

function CardView({ card, hidden = false }: { card?: Card; hidden?: boolean }) {
  if (!card || hidden) return <div className="playing-card card-back" aria-label="Hidden card"><span>RL</span></div>;
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className={`playing-card ${red ? "red" : ""}`} aria-label={cardName(card)}>
      <strong>{card.rank === "T" ? "10" : card.rank}</strong><span>{card.suit}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}

export default function Home() {
  const [game, setGame] = useState<GameState | null>(null);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [opponentCount, setOpponentCount] = useState(3);
  const [draftOpponents, setDraftOpponents] = useState(3);
  const [mode, setMode] = useState<"theoretical" | "actual">("theoretical");
  const [betSize, setBetSize] = useState(100);
  const [view, setView] = useState<View>("play");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as { game?: GameState; stats?: Stats; history?: HistoryEntry[]; opponentCount?: number };
          const savedCount = Math.min(5, Math.max(1, data.opponentCount ?? 3));
          setOpponentCount(savedCount);
          setDraftOpponents(savedCount);
          setStats(data.stats ?? defaultStats);
          setHistory(data.history ?? []);
          setGame(data.game ?? startHand(data.stats?.bankroll ?? STARTING_BANKROLL, savedCount, 1));
        } else {
          setGame(startHand(STARTING_BANKROLL, 3, 1));
        }
      } catch {
        setGame(startHand(STARTING_BANKROLL, 3, 1));
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || !game) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ game, stats, history, opponentCount }));
  }, [game, stats, history, opponentCount, hydrated]);

  const hero = game?.players[0];
  const odds = useMemo(() => {
    if (!game || !hero) return null;
    return riverProbabilities(hero.hole, game.board, game.deck, mode === "actual");
  }, [game, hero, mode]);

  const currentHand = useMemo(() => {
    if (!game || !hero) return "";
    if (game.board.length < 3) {
      const suited = hero.hole[0]?.suit === hero.hole[1]?.suit ? " suited" : "";
      return `${hero.hole[0]?.rank ?? ""}${hero.hole[1]?.rank ?? ""}${suited}`;
    }
    return evaluateHand([...hero.hole, ...game.board]).label;
  }, [game, hero]);

  const applyAction = (action: "fold" | "call" | "raise") => {
    if (!game || game.status !== "playing") return;
    const next = playAction(game, action, betSize);
    const nextHero = next.players[0];
    setGame(next);
    setStats((previous) => {
      if (game.status === "playing" && next.status === "complete" && next.summary) {
        return {
          bankroll: nextHero.stack,
          hands: previous.hands + 1,
          wins: previous.wins + (next.summary.outcome === "win" ? 1 : 0),
          losses: previous.losses + (next.summary.outcome === "loss" ? 1 : 0),
          ties: previous.ties + (next.summary.outcome === "tie" ? 1 : 0),
        };
      }
      return { ...previous, bankroll: nextHero.stack };
    });
    if (game.status === "playing" && next.status === "complete" && next.summary) {
      const summary = next.summary;
      setHistory((previous) => [{ handNo: next.handNo, outcome: summary.outcome, profit: summary.profit, hand: summary.winningHand, detail: summary.detail }, ...previous].slice(0, 50));
    }
  };

  const dealNextHand = () => {
    if (!game || !hero || hero.stack <= 0) return;
    setMode("theoretical");
    setGame(startHand(hero.stack, opponentCount, game.handNo + 1));
  };

  const resetBankroll = () => {
    const freshStats = { ...defaultStats };
    setStats(freshStats);
    setHistory([]);
    setMode("theoretical");
    setGame(startHand(STARTING_BANKROLL, opponentCount, (game?.handNo ?? 0) + 1));
  };

  const applyOpponentCount = () => {
    const nextCount = Math.min(5, Math.max(1, draftOpponents));
    const bankroll = game?.players[0]?.stack ?? stats.bankroll;
    setOpponentCount(nextCount);
    setGame(startHand(bankroll, nextCount, (game?.handNo ?? 0) + 1));
    setSettingsOpen(false);
    setMode("theoretical");
  };

  if (!game || !hero || !odds) {
    return <main className="loading-room"><span className="brand-mark">P</span><p>Shuffling the deck…</p></main>;
  }

  const callAmount = Math.max(0, game.currentBet - hero.roundBet);
  const bestChance = odds.rows.reduce((best, row) => row.probability > best.probability ? row : best, odds.rows[0]);
  const outcomeUnit = odds.cardsToCome === 0 ? "result" : odds.cardsToCome === 1 ? "out" : "combos";
  const cardsRemainingLabel = odds.cardsToCome === 0 ? "BOARD COMPLETE" : `${odds.cardsToCome} CARD${odds.cardsToCome === 1 ? "" : "S"} TO COME`;
  const winRate = stats.hands ? ((stats.wins / stats.hands) * 100).toFixed(0) : "—";

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("play")} aria-label="The River Lab home"><span className="brand-mark">P</span><span>THE RIVER LAB</span></button>
        <nav aria-label="Primary">
          {(["play", "learn", "history"] as View[]).map((item) => <button key={item} className={view === item ? "nav-active" : ""} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </nav>
        <div className="header-tools">
          <button className="opponent-button" onClick={() => { setDraftOpponents(opponentCount); setSettingsOpen(true); }}>{opponentCount} opponents <span>⌄</span></button>
          <div className="bankroll"><span>Bankroll</span><strong>{money(hero.stack)}</strong></div>
        </div>
      </header>

      {view === "play" && (
        <section className="game-grid">
          <div className="table-wrap">
            <div className="table-meta"><span>NLH · Hand #{String(game.handNo).padStart(4, "0")}</span><span>{phaseLabel(game)} · Blinds $25 / $50 · No timer</span></div>
            <div className="poker-table">
              <div className="pot"><span>POT</span><strong>{money(game.pot)}</strong></div>
              <div className="community">
                {Array.from({ length: 5 }, (_, index) => game.board[index] ? <CardView key={game.board[index].id} card={game.board[index]} /> : <div className="card-slot" key={index}><span>{index < 3 ? "FLOP" : index === 3 ? "TURN" : "RIVER"}</span></div>)}
              </div>
              <div className={`opponent-seats count-${game.players.length - 1}`}>
                {game.players.slice(1).map((player, index) => (
                  <div className={`seat seat-${index} ${player.folded ? "folded" : ""}`} key={player.id}>
                    <div className="opponent-cards"><CardView hidden={game.status !== "complete" || player.folded} card={player.hole[0]}/><CardView hidden={game.status !== "complete" || player.folded} card={player.hole[1]}/></div>
                    <div className="avatar" style={{ borderColor: player.accent }}>{player.initials}<span className={game.dealerIndex === index + 1 ? "dealer-dot visible" : "dealer-dot"}>D</span></div>
                    <strong>{player.name}</strong><span>{money(player.stack)}</span>{player.roundBet > 0 && <em>{money(player.roundBet)} in</em>}
                  </div>
                ))}
              </div>
              <div className={`hero-seat ${hero.folded ? "folded" : ""}`}>
                <div className="hole-cards"><CardView card={hero.hole[0]}/><CardView card={hero.hole[1]}/></div>
                <div className="hero-copy"><div><strong>You</strong><span>{currentHand}</span></div><b>{money(hero.stack)}</b>{hero.roundBet > 0 && <em>{money(hero.roundBet)} in</em>}</div>
                {game.dealerIndex === 0 && <span className="hero-dealer">D</span>}
              </div>
            </div>

            <div className="decision-bar">
              {game.status === "playing" ? (
                <>
                  <div className="turn-copy"><span>YOUR TURN · TAKE YOUR TIME</span><strong>{callAmount ? `${money(callAmount)} to continue` : "What’s your move?"}</strong></div>
                  <div className="bet-presets" aria-label="Bet size">{[100, 250, 500].map((amount) => <button className={betSize === amount ? "active" : ""} key={amount} onClick={() => setBetSize(amount)}>{money(amount)}</button>)}</div>
                  <button className="secondary-action danger" onClick={() => applyAction("fold")}>Fold</button>
                  <button className="secondary-action" onClick={() => applyAction("call")}>{callAmount ? `Call ${money(callAmount)}` : "Check"}</button>
                  <button className="primary-action" onClick={() => applyAction("raise")} disabled={hero.stack <= callAmount}>{game.currentBet ? `Raise +${money(betSize)}` : `Bet ${money(betSize)}`}</button>
                </>
              ) : (
                <div className="result-bar">
                  <div className={`result-mark ${game.summary?.outcome}`}>{game.summary?.outcome === "win" ? "+" : game.summary?.outcome === "tie" ? "=" : "−"}</div>
                  <div><span>{game.summary?.detail}</span><strong>{game.summary?.headline}</strong><p className={(game.summary?.profit ?? 0) >= 0 ? "profit" : "loss"}>{(game.summary?.profit ?? 0) >= 0 ? "+" : "−"}{money(game.summary?.profit ?? 0)} this hand</p></div>
                  {hero.stack > 0 ? <button className="primary-action next-hand" onClick={dealNextHand}>Deal next hand →</button> : <button className="primary-action next-hand" onClick={resetBankroll}>Restart with $10,000</button>}
                </div>
              )}
            </div>
          </div>

          <aside className="math-panel">
            <div className="panel-heading"><div><span className="eyebrow">EVENTUAL RIVER ODDS · {cardsRemainingLabel}</span><h1>{odds.cardsToCome === 0 ? "Final hand." : "See the river."}</h1></div><div className="live-dot"><span/>LIVE</div></div>
            <p className="lede">Exact chance your best five-card hand finishes in each category after all remaining community cards are dealt.</p>
            <div className="mode-switch" role="group" aria-label="Probability information set">
              <button className={mode === "theoretical" ? "selected" : ""} onClick={() => setMode("theoretical")}><strong>Theoretical</strong><span>Known cards only</span></button>
              <button className={mode === "actual" ? "selected" : ""} onClick={() => setMode("actual")}><strong>Actual</strong><span>Full table known</span></button>
            </div>
            <div className="mode-note"><span>{mode === "theoretical" ? "◌" : "◎"}</span><p>{mode === "theoretical" ? "Uses only your cards and the board—the information available to a real player." : `Removes all ${opponentCount * 2} hidden opponent cards from the possible deck for the true, omniscient odds.`}</p></div>
            <div className="odds-list">
              {odds.rows.map((row) => (
                <div className={`odd-row ${row.probability === 0 ? "zero" : ""}`} key={row.label}>
                  <div className="odd-label"><span>{row.label}</span><div><small>{row.count.toLocaleString()} {outcomeUnit}</small><strong>{row.probability === 0 ? "N/A" : `${formatProbability(row.probability)}%`}</strong></div></div>
                  <div className="track"><span style={{ width: `${row.probability}%`, background: probabilityColors[row.category] }}/></div>
                </div>
              ))}
            </div>
            <div className="insight"><span className="insight-icon">↗</span><p><strong>{bestChance.label} is most likely at {formatProbability(bestChance.probability)}%</strong><br/>Calculated across {odds.total.toLocaleString()} possible final river outcomes.</p></div>
            <div className="session-strip"><Stat label="Hands" value={String(stats.hands)}/><Stat label="W–L" value={`${stats.wins}–${stats.losses}`}/><Stat label="Win rate" value={`${winRate}${winRate === "—" ? "" : "%"}`}/></div>
          </aside>
        </section>
      )}

      {view === "learn" && <LearnView onPlay={() => setView("play")}/>} 
      {view === "history" && <HistoryView stats={stats} history={history} onPlay={() => setView("play")} onReset={resetBankroll}/>} 

      {settingsOpen && (
        <div className="modal-layer">
          <button className="modal-backdrop" onClick={() => setSettingsOpen(false)} aria-label="Close table settings" />
          <div className="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="close-button" onClick={() => setSettingsOpen(false)} aria-label="Close">×</button>
            <span className="eyebrow">TABLE SETTINGS</span><h2 id="settings-title">Choose your table.</h2>
            <p>More opponents remove more cards from the actual deck and make each pot harder to win.</p>
            <div className="stepper"><button onClick={() => setDraftOpponents((value) => Math.max(1, value - 1))} aria-label="Remove opponent">−</button><strong>{draftOpponents}<span>computer opponents</span></strong><button onClick={() => setDraftOpponents((value) => Math.min(5, value + 1))} aria-label="Add opponent">+</button></div>
            <div className="table-preview">{Array.from({ length: draftOpponents }, (_, index) => <span key={index} style={{ transform: `rotate(${(index - (draftOpponents - 1) / 2) * 17}deg) translateY(-52px)` }}>{index + 1}</span>)}<b>YOU</b></div>
            <p className="settings-warning">Applying this setting starts a fresh hand. Your current stack and session record stay with you.</p>
            <button className="primary-action apply-settings" onClick={applyOpponentCount}>Apply & deal a new hand</button>
          </div>
        </div>
      )}
    </main>
  );
}

function LearnView({ onPlay }: { onPlay: () => void }) {
  const ranks = ["Straight flush", "Four of a kind", "Full house", "Flush", "Straight", "Three of a kind", "Two pair", "One pair", "High card"];
  return (
    <section className="content-view learn-view">
      <div className="content-hero"><span className="eyebrow">POKER MATH, WITHOUT THE MYSTIQUE</span><h1>The deck is uncertain.<br/>The math isn’t.</h1><p>The River Lab counts every card or card combination that can arrive next, classifies your best five-card hand, and divides by the full possibility space.</p><button className="primary-action" onClick={onPlay}>Back to the table →</button></div>
      <div className="lesson-grid">
        <article><span>01</span><h2>Theoretical odds</h2><p>These are the odds you can honestly use at the table. We remove only cards you can see—your hole cards and the board. Opponents’ cards remain possible because you do not know them.</p><code>favorable outcomes ÷ all unseen outcomes</code></article>
        <article><span>02</span><h2>Actual odds</h2><p>This teaching mode peeks behind the curtain. It also removes every opponent’s hidden cards, revealing the exact chance based on the deck that truly remains.</p><code>favorable outcomes ÷ real deck outcomes</code></article>
        <article><span>03</span><h2>Why they differ</h2><p>If an opponent holds a heart, your real flush chance falls even though your table-legal estimate does not. Toggle between modes to build intuition for hidden-information variance.</p><code>belief vs. reality</code></article>
      </div>
      <div className="rank-board"><div><span className="eyebrow">HAND LADDER</span><h2>Every category, strongest first.</h2><p>Your probability rows are exclusive: each possible completed board is counted once, under the strongest five-card category it creates.</p></div><ol>{ranks.map((rank, index) => <li key={rank}><span>{String(index + 1).padStart(2, "0")}</span><strong>{rank}</strong></li>)}</ol></div>
      <div className="learning-note"><strong>One important detail</strong><p>At every stage, the lab evaluates every possible combination of the community cards still to come. Impossible final categories stay at zero rather than being assigned artificial probability.</p></div>
    </section>
  );
}

function HistoryView({ stats, history, onPlay, onReset }: { stats: Stats; history: HistoryEntry[]; onPlay: () => void; onReset: () => void }) {
  const profit = stats.bankroll - STARTING_BANKROLL;
  return (
    <section className="content-view history-view">
      <div className="history-heading"><div><span className="eyebrow">LOCAL SESSION LEDGER</span><h1>Your decisions,<br/>hand by hand.</h1><p>Saved in this browser only. Nothing leaves your computer.</p></div><button className="primary-action" onClick={onPlay}>Return to table →</button></div>
      <div className="big-stats"><Stat label="Current bankroll" value={money(stats.bankroll)}/><Stat label="Net result" value={`${profit >= 0 ? "+" : "−"}${money(profit)}`}/><Stat label="Hands played" value={String(stats.hands)}/><Stat label="Record" value={`${stats.wins}W · ${stats.losses}L · ${stats.ties}T`}/></div>
      <div className="history-table">
        <div className="history-row history-header"><span>Hand</span><span>Result</span><span>Winning category</span><span>Result detail</span><span>Net</span></div>
        {history.length ? history.map((entry) => <div className="history-row" key={`${entry.handNo}-${entry.detail}`}><span>#{String(entry.handNo).padStart(4, "0")}</span><span><b className={`result-pill ${entry.outcome}`}>{entry.outcome}</b></span><span>{entry.hand}</span><span>{entry.detail}</span><span className={entry.profit >= 0 ? "profit" : "loss"}>{entry.profit >= 0 ? "+" : "−"}{money(entry.profit)}</span></div>) : <div className="empty-history"><span>♤</span><h2>No finished hands yet.</h2><p>Your wins, losses, ties, and bankroll changes will appear here.</p><button onClick={onPlay}>Play the first hand</button></div>}
      </div>
      <button className="reset-link" onClick={onReset}>Reset bankroll and clear local history</button>
    </section>
  );
}
