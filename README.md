## Expense Tracker – Salary Cycle + Financial Insights

> A personal finance tracker that thinks in **salary cycles**, not calendar months.  
> Built with vanilla JS, Supabase, and zero external AI APIs.

## Features

### Core Tracking
- Log income and expenses with categories, payment sources (UPI, credit card, debit card, cash), bank/card details, and descriptions
- Salary-aware form - when you log a salary transaction, payment source auto-locks to your configured salary account
- Category management with custom icons

### Salary Cycle Dashboard
- Cycles are automatically derived from your salary transaction dates - no manual configuration
- Switch between historical cycles with a dropdown
- Per-cycle stats: total income, total expenses, remaining budget, no-spend streak
- **Pattern-aware run-rate projection**: instead of a flat daily average, the projector looks up what you've historically spent on each remaining day of the cycle. Falls back to a recency-weighted burn rate (last 7 days × 0.6 + earlier × 0.4) when history is thin

### Charts
- **Daily spend line chart** with a linear regression trend line - slope tells you if spending is accelerating or tapering
- **Expense donut chart** broken down by payment source - click any segment to drill into categories for that source

### Financial Insights (5-Point Audit)
Runs entirely locally against your transaction history:

1. **The Audit** - compares current cycle spend per category against your N-month historical average. Flags categories with ≥10% and ≥₹500 variance
2. **Corrective Measures** - generates specific spending limits for the top 2 anomalous categories to offset the variance
3. **Run-Rate Status** - RED / CAUTION / GREEN projection using the same pattern-aware model as the dashboard
4. **Target the Leak** - identifies the single highest-spend category and its share of total outflow
5. **Macro Analytics** - savings rate vs 20% benchmark, Pareto concentration risk across top 3 categories

### Auth
- Email/password login via Supabase Auth
- Silent JWT refresh - expired tokens are swapped transparently without logging you out
- Session persisted in localStorage

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Charts | [Chart.js](https://www.chartjs.org/) |
| Backend / DB | [Supabase](https://supabase.com/) (Postgres) |
| Auth | Supabase Auth (email/password + JWT refresh) |
| Hosting | [Netlify](https://netlify.com/) (serverless functions as BFF) |
| Analytics | Local rule-based engine - no external LLM |

---

### Project Structure

```bash
.
├── index.html                  # Auth, add transaction, dashboard, categories, insights
├── style.css                   # All styling
├── script.js                   # App logic, charts, analytics engine, API layer
├── assets/
│   ├── favicon-32x32.png
│   └── favicon.ico
└── netlify/
    └── functions/
        ├── _auth.js            # Auth helpers
        ├── _supabase.js        # Supabase client init
        ├── login.js            # POST /login
        ├── refresh.js          # POST /refresh (silent token refresh)
        ├── categories.js       # GET + POST /categories
        ├── transactions.js     # GET + POST /transactions
        └── health.js           # GET /health

```
## Architecture

This app uses a **BFF (Backend for Frontend)** pattern via Netlify Functions. The frontend never talks to Supabase directly - all requests go through the serverless functions, which hold the service role key server-side.

```
Browser → Netlify Function → Supabase
```

---

## Insights Engine - How Projections Work

### With ≥10 historical expense transactions (Pattern-Aware Mode)
Each past expense is mapped to its **day-of-cycle** number (day 1 = salary date, day 2 = next day, etc.). For each remaining day in the current cycle, the engine looks up the historical average spend for that specific day number across all past cycles. This captures patterns like "I always buy groceries on day 3" or "day 28 is always near-zero."

### With <10 historical transactions (Weighted Recency Mode)
Daily burn rate is split into two windows:
- Last 7 days → weighted at 60%
- Earlier days in the cycle → weighted at 40%

This biases the projection toward your recent momentum rather than your whole-cycle average, which is more predictive when spending patterns shift mid-cycle.

---

## License

MIT
