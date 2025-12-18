## Expense Tracker – Salary Cycle + Financial Insights

A personal finance tracker built with **vanilla HTML/CSS/JS** and **Supabase**.  
It:

- Tracks **income & expenses** with categories, payment sources, and descriptions  
- Uses your **Salary transactions to define “salary cycles”** (from one salary date to the day before the next)  
- Shows a **dashboard**: totals, remaining budget, streaks, charts, and transaction list  
- Includes a **Financial Insights**  that analyses your historical data and:
  - Finds where money is leaking
  - Shows when and where you overspend
  - Suggests concrete ways to improve your financial health

---

### Tech Stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Charts:** [Chart.js](https://www.chartjs.org/)
- **Backend as a Service:** [Supabase](https://supabase.com/)
- **Auth:** Supabase Auth (email/password)
- **Database:** Supabase Postgres
- **Financial Insights:** Local “rule-based” analytics (no external LLM calls)

---

### Project Structure

```bash
.
├── index.html          # Main UI: auth, forms, dashboard, categories, AI Coach
├── style.css           # Styling
├── script.js           # App logic + AI coach + charts + Supabase queries
├── supabase-config.js  # Supabase client config (URL & anon key)
└── assets/
    └── favicon-32x32.png
