# The future of Personal OS

> **From a tracker that records the past to a tool that improves your next decision.**

Most expense apps answer *"what did I spend?"* — a question you could answer
with a spreadsheet. The questions that actually change a person's financial life
are different:

- *Will I make it to the next salary — and which day is the risky one?*
- *If I cut this one habit, what does it buy me, and when?*
- *Am I getting better, or just having a good month?*
- *What should I do **today**, and how sure are you?*

The whole app should be judged by one test: **did the user make a better
decision because of it?** Everything below is in service of that.

---

## 1. Where we are today

Built and shipping (see [README](../README.md)):

| Layer | What exists |
|---|---|
| **Capture** | Fast entry, on-device bill scanning, recurring templates, your own accounts/cards |
| **Understand** | Salary-cycle model, health score with a transparent breakdown, category variance vs *your* usual, pace-vs-usual chart, forecast, credit-card dues |
| **Act** | "What to do next": ranked, rupee-quantified actions with evidence |
| **Trust** | Per-user settings, export/delete, password reset, RLS, no third-party AI, local analytics |

That is a strong **descriptive + lightly prescriptive** base. The future is
**predictive → prescriptive → behavioral → learning**.

## 2. Design principles for a decision tool

Every insight the app shows must pass these:

1. **So what?** It ends in something the user can do, not just a number.
2. **How much?** It carries a rupee (or days, or percent) impact so choices can be compared.
3. **How sure?** Forecasts show ranges and a track record, never false precision.
4. **Why?** Anything computed can be explained in one plain sentence with the underlying entries.
5. **No shame, no dark patterns.** Nudges respect autonomy: the user can dismiss, snooze, or override.
6. **Private by default.** Analytics stay on the device or in the user's own account; sharing is opt-in.
7. **Measured.** We track whether advice was followed and whether it helped (privately, per user).

## 3. Roadmap of advanced analytics

Ordered roughly by (value to the user) ÷ (effort), grounded in data the app already collects.

### Next — make it predictive and actionable

- **Cash-flow calendar & tight-day warning.** Combine known recurring bills, card due dates and your typical daily spend to show the *expected balance path* to the next salary and flag "day 24 is your tightest day". The single most useful screen for a salaried person.
- **What-if simulator.** Sliders per category ("Dining −20%, Shopping −10%") that instantly show the new savings rate, projected balance, and the date a goal is reached. Turns advice into a choice the user owns.
- **Goals with funding pace.** "₹1,20,000 emergency fund by March" → the per-cycle amount needed, whether you're on pace, and which category to fund it from.
- **Forecast honesty.** Prediction *ranges* instead of a single number, plus a visible **backtest score** ("last 6 cycles our forecast was within ±7%"). Compare the current OLS trend against simple baselines and seasonal models and show the winner.
- **Subscription & price-creep detection.** Find recurring charges you did not flag, and recurring amounts that quietly rose.
- **Credit-card cycle awareness.** Statement and due dates, "amount to set aside now", utilisation, and interest-avoidance reminders.
- **Statement import (CSV/PDF).** Removes typing entirely for many users and unlocks back-filling history, which makes every analysis above better.

### Later — understand behaviour, not just totals

- **Payday-effect analysis.** Spending by day-of-cycle: how front-loaded you are, and how much of the cycle's discretionary spend happens in the first week. Behavioural finance calls out this pattern; personalised, it is actionable ("you spend 41% of discretionary money in the first 5 days").
- **Essential vs discretionary, learned from your data.** Categories with stable amounts behave as essentials; volatile ones as discretionary. No manual tagging, and it sharpens every recommendation.
- **Robust anomaly detection.** Median/MAD-based outliers, duplicate charges, unusual merchants, and "one-off vs new habit" classification.
- **Seasonality.** Festival months, insurance/tax months, annual bills — pre-warn before the spike instead of explaining it after.
- **Debt payoff planner.** Avalanche vs snowball with real dates and interest saved (needs liabilities).
- **Net worth & runway.** Add balances and assets to turn the "tracked cushion" estimate into a real months-of-runway figure.
- **Weekly review.** A 60-second guided recap: what changed, one thing to fix, one thing to celebrate.
- **Income analytics** for variable earners: volatility, safe-to-spend baseline, bonus detection.

### Horizon — a learning system

- **Personalised nudges that learn.** Track which kinds of advice each user actually acts on and adapt timing and framing.
- **Plain-language explanations.** "Why was March expensive?" answered from your own entries, with the evidence a tap away. Optional, on-device or user-consented models only.
- **Automatic data via consent.** India's Account Aggregator framework for bank data with explicit consent, replacing manual entry (regulated; plan for compliance and partner selection).
- **Opt-in anonymous benchmarks.** "Households like yours" comparisons using k-anonymity; strictly opt-in and aggregate-only.
- **Household mode.** Shared budgets and goals between partners, with per-person privacy.
- **Private vault mode** — see §5.

## 4. How we will know it works

A decision tool must prove it changes decisions. Per user (private, on their account):

- **Savings-rate trend** and **budget-adherence trend** over cycles
- **Shortfall avoidance:** cycles ending with a deficit, before vs after adopting advice
- **Advice follow-through:** actions shown vs actions taken, and the measured effect
- **Forecast accuracy** (backtest error) — trust is earned with a track record
- Product health: weekly active use, entries per week, retention after 3 cycles

## 5. Deferred on purpose: data encryption

Decided to postpone; recorded here so it is not lost.

- **Stage A — server-side field encryption:** encrypt amount, payee, description and category in the functions (AES-GCM), keep date/type/user id in the clear. Hides data from the database dashboard, backups and a database leak; not from someone holding the server key. Needs a careful, backed-up migration of existing rows and a dual-read transition.
- **Stage B — optional private vault (end-to-end):** browser-side encryption with a user-held passphrase and recovery key, so not even the operator can read the data. Trade-offs: lost passphrase means lost data, password reset cannot restore access, and no server-side processing of the encrypted fields. Best offered as an opt-in premium mode.
- Design constraint to keep in mind now: all analytics already run in the browser, so encrypted fields will not block the roadmap above. Avoid adding server-side features that need to read entry contents.

## 6. Monetisation that follows the value

Free: capture, basic dashboard, budgets. Paid: the decision tools — cash-flow
calendar, what-if simulator, goals, forecast ranges, statement import, weekly
review, private vault. Charge for **better decisions**, not for access to your
own data (export and deletion always stay free).

## 7. The north star

A user opens the app on the 12th of the month and, within ten seconds, knows:

- whether they are on track, **and how sure we are**,
- the one thing worth changing, **and what it is worth**,
- what happens if they change it,
- and, over time, that they are measurably **better off than before they started using it.**

Everything we build should make that moment faster, clearer or more trustworthy.
