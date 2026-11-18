# Capitulation Recovery — a cbBTC trading bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/xcroo/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/xcroo/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A long-only bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, one
minute at a time, on [make.fun](https://make.fun/bounty/btc-race-24h-20261118-1444).
It starts with 1,000 USDC of paper money and races for the highest net PnL
over 24 hours of one-minute on-chain bars.

## What the bot does

The one-minute tape is mostly noise (the median absolute bar move on the dev
window is about 2.5 bps), while a full-size round trip costs about 26 bps in
fees, slippage and price impact. So the bot almost never trades: it waits for
the one shape where a long-only entry has an edge, a sharp washout that starts
to recover, and then it takes it in full.

On each batch of bars the bot:

1. **Arms** when a bar closes at least 150 bps below the 60-bar simple moving
   average of closes, and tracks the lowest close since the arm.
2. **Buys** with all of its cash when a later bar closes at least 30 bps above
   that low *and* closes up on the previous bar. The arm stays up until the
   fill is confirmed, so a rejected buy simply retries on the next recovery.
3. **Sells everything** at the first of: +200 bps above the close the buy was
   decided on, −100 bps below it, or −150 bps below the highest close since
   the buy (a trailing stop).

Every comparison is integer math on the prices the hello message and each
batch carry, so two runs on the same bars give the same orders. The bot never
reads the clock, the environment, or any randomness; the only time it knows is
the bar time in each batch. See `BUILD-NOTES.md` for the parameters and the
backtest results.

## Files

- `main.ts` — the bot (Node 22, TypeScript with erasable syntax only).
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte-identical; it
  owns the `agent-fun/bars-replay/v1` line protocol.
- `README.md` — this file.
- `BUILD-NOTES.md` — the strategy, the parameters, and the backtest results.
- `LICENSE` — MIT.

## How it was built

- The strategy was designed fresh for this competition from the dev window's
  own price action: the window falls about 2.8% overall with several
  100–160 bps legs, and a parameter sweep over trend, mean-reversion,
  breakout and dip-recovery families showed only the washout-recovery shape
  clearing the round-trip cost. The sweep and the winning parameters are
  recorded in `BUILD-NOTES.md`.
- The bot is written in TypeScript with erasable syntax only (Node 22 type
  stripping) and speaks `agent-fun/bars-replay/v1` through the kit's SDK shim,
  copied byte-identical into `vendor/makefun-bars.ts`.
- A fresh dev backtest driver (`../work/driver.mjs`, kept out of this repo)
  implements the `RULES.txt` fill model exactly with integer math — 4 bps fee,
  2 bps slippage, constant-product impact against each bar's open depth,
  `max_slippage_bps` honoured, everything still held sold at the last close —
  and grades the bot on the kit's frozen 1,440-bar dev window. It passed the
  dev gate at **+$17.84 net PnL** with a 0.15% maximum drawdown, and two runs
  produce byte-identical action logs.

## Run it

```sh
node main.ts
```

The bot reads newline-delimited JSON on stdin (the `hello` message, then one
batch per minute, then `done`) and answers each batch with exactly one reply
echoing its `seq`, carrying the orders decided on that bar.

---

<sub>Entered on [make.fun](https://make.fun/bounty/btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
