# Build notes — Capitulation Recovery (btc-race-24h-20261118-1444)

## Strategy

Long-only, one position at a time, full size (100% of cash on every buy).
The bot trades one shape and one shape only: a washout below the recent
average that starts to recover.

- **Reference:** the 60-bar simple moving average of closes.
- **Arm:** a bar closes at least 150 bps below that average. From the arm on,
  the bot tracks the lowest close seen.
- **Buy:** a later bar closes at least 30 bps above that lowest close **and**
  closes up on the previous bar. The recovery bar itself has to be an up bar,
  so a flat drift above the low does not trigger a buy. The buy spends all
  cash, with `max_slippage_bps` 200 measured from the latest close.
- **Sell (first to hit):** the close reaches +200 bps above the close the buy
  was decided on (take profit), or −100 bps below it (stop loss), or −150 bps
  below the highest close since the buy (trailing stop). The sell is the whole
  position.
- **Disarm:** if a bar closes back above the average while armed and no
  recovery has fired, the arm is dropped.
- **Retry:** the arm stays up until a buy fill is confirmed in the account the
  next batch carries, so a buy rejected at its fill (e.g. `max_slippage`)
  simply retries on the next recovery instead of stranding the bot flat.

The entry and exit references are the closes the orders were decided on, not
the fill prices, so the bot's decisions are a pure function of the bars it
has been sent. All comparisons are integer basis-point math on bigints.

## Why this shape

The dev window (1,440 one-minute bars) falls about 2.8% from first close to
last, with its moves coming in legs of roughly 100–160 bps separated by chop;
the median absolute one-minute move is about 2.5 bps. A full-size round trip
pays about 26 bps (4 bps fee + 2 bps slippage each way, plus ~7 bps of price
impact each way at the frozen pool depth), so any signal whose edge is smaller
than that is a guaranteed bleed.

A sweep of fresh strategy families against an exact-model backtest, all on
the same dev window, found exactly that:

- **EMA crosses (5/13 through 90/240) with target/stop exits:** −$5 to −$175,
  4–112 trades. The crosses fire in the chop and each whipsaw pays the
  round-trip cost.
- **Z-score mean reversion vs a 20–120 bar SMA:** −$27 to −$134. Buying the
  dip into a falling window keeps catching a falling knife.
- **Donchian breakouts (30–240 bars):** −$3 to −$82. Breakouts of a 1-minute
  range are noise, not trend.
- **15/30-minute aggregated EMA crosses and Donchian:** −$36 to +$8, 2–18
  trades. Aggregation filters some noise but the entries still land late.
  (The best aggregated variant, a 30-minute EMA 6/18 with a +100 bps target,
  made +$7.82 on 2 trades — again a single leg, and smaller than the
  dip-recovery's.)
- **RSI(10–21) oversold bounces:** −$50 to −$141, 36–84 trades.
- **Dip-recovery (this bot):** the only family with a broad plateau of
  positive results — 270 of 729 parameter combinations around it end positive
  on the dev window, all on the same single round trip (buy near the
  63,366 low, sell into the 65,190 high), which is why the entry is set where
  it is: the entry bar is unchanged across dip 120–180 bps and recovery
  25–40 bps, and the exit is unchanged across stop 80–120 bps and trailing
  120–200 bps.

Second triggers tested and rejected: a 15-minute EMA 4/12 cross and a
240-bar SMA reclaim were each added as a second entry with their own exits.
Both lost money on the dev window (−$6 to −$14 each) and cut the total PnL,
so the shipped bot carries only the one trigger. The profit on the dev window
is therefore one round trip; that is stated plainly here rather than dressed
up as diversification.

## Parameters

| Parameter | Value |
|---|---|
| SMA window | 60 closes |
| Arm (dip below SMA) | 150 bps |
| Buy (recovery above armed low) | 30 bps, plus an up bar |
| Take profit | +200 bps vs decided close |
| Stop loss | −100 bps vs decided close |
| Trailing stop | −150 bps vs peak close since buy |
| Buy size | 100% of cash |
| `max_slippage_bps` | 200 |

## Backtest results (dev window, exact fill model)

Driver: `../work/driver.mjs` — a fresh driver written for this entry that
feeds the kit's frozen 1,440-bar dev window to `node main.ts` over the
`agent-fun/bars-replay/v1` protocol and applies the `RULES.txt` fill model
with integer math: 4 bps fee on every fill, 2 bps slippage (buy fills 2 bps
above the open, sell 2 bps below), constant-product price impact against the
fill bar's open depth (fills at one open walk the pool in reply order),
`max_slippage_bps` honoured, everything still held sold at the last close
against that close's depth. No warm-up bars are in this window.

| Metric | Value |
|---|---|
| Net PnL | **+17,838,114 micro-USDC (+$17.838114)** |
| Final cash | $1,017.838114 (from $1,000) |
| Trades (filled orders) | 2 (1 buy + 1 sell) |
| Fees paid | $0.807299 |
| Maximum drawdown | $15.080105 (0.1508% of starting cash) |
| Bars | 1,440 |

Fills:

| Bar (fill) | Side | Notional | Fill price |
|---|---|---|---|
| 1794931080000 | buy | $1,000.00 | $63,870.54 |
| 1794957180000 | sell | $1,017.84 | $65,061.94 |

The buy was decided on the bar closing at 63,800.03, after the window's low
of 63,366; the sell was decided when the close reached the +200 bps target
and filled into the leg's high near 65,190. The gate needs net PnL strictly
above $0; this entry clears it by $17.84. The maximum drawdown of $15.08 is a peak-to-trough swing inside the one
trade: the position first ran up to about $1,007.79 as the recovery leg
reached 64,394 (bar 85), then gave it all back and more, falling to $992.71
at the 63,430 low (bar 133), before the leg resumed toward the target. The
position was never stopped out on that dip — the dip stayed above the
−100 bps stop from the entry close — but the drawdown shows the cost of
holding a full-size position through a choppy leg.

## Determinism

The driver was run three times on the dev window (once before and twice
after the up-bar confirmation was added to the buy). All three action logs
(1,440 replies, one per batch) are byte-identical (`cmp` clean), and all
three summaries agree to the micro-USDC. The bot uses no clock, no
environment, and no randomness — only the prices in the hello message and
each batch.

## Risks and limits

- The dev profit is a single round trip. On the race window the same trigger
  may fire zero, one, or several times; a window with no 150 bps washout
  means no trade at all.
- The strategy is long-only and holds through the recovery leg, so a leg that
  reverses before the +200 bps target gives the gain back to the trailing
  stop (−150 bps from the peak) or the stop (−100 bps from entry).
- `max_slippage_bps` 200 is wide: a fill may land up to 200 bps from the
  latest close in a one-minute jump. It almost never binds (the 99th
  percentile absolute one-minute move is about 26 bps); it is a guard against
  a flash move, not a tuning lever.
