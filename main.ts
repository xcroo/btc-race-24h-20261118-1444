// Capitulation Recovery — a cbBTC (CBBTC) long-only bot for btc-race-24h-20261118-1444.
//
// The idea, in one line: Bitcoin's one-minute tape is mostly noise, but a sharp
// washout below its recent average that then starts to recover is the one place
// a long-only bot can buy with an edge, so this bot waits for exactly that
// shape, buys it in full, and banks it at a fixed target.
//
// How each batch of bars is traded:
//   * The bot keeps the closes of the bars it has seen and the 60-bar simple
//     moving average of those closes.
//   * ARM: when a bar closes at least 150 bps below that average, the bot arms
//     and starts tracking the lowest close since the arm.
//   * BUY: when a later bar closes at least 30 bps above that lowest close,
//     the bot buys with all of its cash (one position, full size). It stays
//     armed until the fill is confirmed, so a rejected buy simply retries.
//   * SELL, once holding: the bot sells everything when the close reaches
//     +200 bps above the close the buy was decided on, or falls 100 bps below
//     it, or falls 150 bps below the highest close seen since the buy
//     (a trailing stop). The first of the three to hit ends the trade.
//   * If a bar closes back above the average while armed and no recovery has
//     fired, the arm is dropped: the washout is over without a trade.
//
// Everything is integer math on the prices the hello message and each batch
// carry (bigint, basis points against the close), so two runs on the same bars
// give the same orders. The bot never reads the clock, the environment or any
// randomness; the only time it knows is the bar time in each batch.
//
// Costs the strategy is built around: a full-size round trip pays about
// 26 bps in fee (4 bps each way), modelled slippage (2 bps each way) and
// price impact against the pool depth, so the +200 bps target and the
// -100 bps stop are both far wider than the round-trip cost, and the entry
// only fires after a 150 bps washout plus a 30 bps recovery, which is a move
// the 1-minute noise (median absolute bar move about 2.5 bps) rarely fakes.
import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Strategy parameters (basis points unless noted).
const SMA_BARS = 60; // closes averaged for the washout reference
const DIP_BPS = 150; // how far below the average a close must fall to arm
const RECOVER_BPS = 30; // recovery above the armed low that triggers the buy
const TARGET_BPS = 200; // take profit above the close the buy was decided on
const STOP_BPS = 100; // stop loss below that close
const TRAIL_BPS = 150; // trailing stop below the highest close since the buy
const MAX_SLIPPAGE_BPS = 200; // cap on the move from the latest close to a fill

const BPS = 10000n;

const closes: bigint[] = [];
let armed = false;
let dipLow = 0n;
let signalClose = 0n; // close the pending/confirmed buy was decided on
let entryClose = 0n; // close the confirmed buy was decided on (0 when flat)
let peakClose = 0n; // highest close since the confirmed buy

function sma(): bigint | null {
  if (closes.length < SMA_BARS) return null;
  let sum = 0n;
  for (let i = closes.length - SMA_BARS; i < closes.length; i++) sum += closes[i]!;
  return sum / BigInt(SMA_BARS);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    const holding = held !== undefined && held.qty > 0n;

    if (holding) {
      // The buy filled: lock in the entry reference the first batch we see it.
      if (entryClose === 0n) {
        entryClose = signalClose;
        peakClose = signalClose;
        armed = false;
      }
      if (close > peakClose) peakClose = close;
      const target = (entryClose * (BPS + BigInt(TARGET_BPS))) / BPS;
      const stop = (entryClose * (BPS - BigInt(STOP_BPS))) / BPS;
      const trail = (peakClose * (BPS - BigInt(TRAIL_BPS))) / BPS;
      if (close >= target || close <= stop || close <= trail) {
        entryClose = 0n;
        peakClose = 0n;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: no position to exit, and a buy decided earlier that never filled
    // leaves the arm up, so it simply retries on the next recovery.
    entryClose = 0n;
    peakClose = 0n;
    const average = sma();
    if (average === null) return [];
    if (!armed) {
      if (close * BPS <= average * (BPS - BigInt(DIP_BPS))) {
        armed = true;
        dipLow = close;
      }
      return [];
    }
    if (close < dipLow) dipLow = close;
    // The recovery bar itself must close up on the previous bar: a flat
    // drift 30 bps above the low is not a recovery, it is still the washout.
    const prevClose = closes.length >= 2 ? closes[closes.length - 2]! : close;
    if (close * BPS >= dipLow * (BPS + BigInt(RECOVER_BPS)) && close > prevClose) {
      signalClose = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (close > average) armed = false;
    return [];
  },
});
