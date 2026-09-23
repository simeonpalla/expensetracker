// E2E flows with the BFF stubbed at the network layer. The frontend runs
// for real (cookie-less here — the stubs simply return 200s), Chart.js and
// the engine modules run for real; only /.netlify/functions/* is faked.
const { test, expect } = require('@playwright/test');

// Local-calendar date helpers matching the app's engine.
function dstr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

const USER = { id: 'u-test', email: 'e2e@example.com' };

const CATEGORIES = [
    { id: 1, name: 'Salary', type: 'income', icon: '💰' },
    { id: 2, name: 'Food', type: 'expense', icon: '🍕' },
    { id: 3, name: 'Offering', type: 'expense', icon: '🙏' }
];

const ACCOUNTS = [{ id: 1, name: 'UBI', type: 'upi' }];

function fixtureTransactions() {
    return [
        {
            id: 't1',
            type: 'income',
            category: 'Salary',
            amount: 50000,
            transaction_date: dstr(-5),
            payment_to: 'Employer',
            payment_source: 'salary',
            source_details: 'UBI',
            is_recurring: false
        },
        {
            id: 't2',
            type: 'expense',
            category: 'Food',
            amount: 1200,
            transaction_date: dstr(-2),
            payment_to: 'Zomato',
            payment_source: 'upi',
            source_details: 'UBI',
            is_recurring: false
        }
    ];
}

// Wires up every function endpoint. `state` mutates as the test posts data.
async function stubApi(page, state) {
    const json = (route, body, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    await page.route('**/.netlify/functions/**', async route => {
        const url = new URL(route.request().url());
        const fn = url.pathname.replace('/.netlify/functions/', '');
        const method = route.request().method();

        if (fn === 'me')
            return json(
                route,
                state.loggedIn ? { user: USER } : { error: 'Not signed in' },
                state.loggedIn ? 200 : 401
            );
        if (fn === 'refresh') return json(route, { error: 'Not signed in' }, 401);
        if (fn === 'login') {
            const body = route.request().postDataJSON();
            if (body.password === 'correct-horse') {
                state.loggedIn = true;
                return json(route, { user: USER });
            }
            return json(route, { error: 'Invalid email or password.' }, 401);
        }
        if (fn === 'settings') {
            state.settings = state.settings || {
                exists: false,
                salary_account: 'UBI',
                budget_limits: {},
                giving_floor_pct: 5,
                giving_floor_category: '',
                onboarded_at: null
            };
            if (method === 'PUT') {
                Object.assign(state.settings, route.request().postDataJSON(), { exists: true });
                return json(route, { ok: true });
            }
            return json(route, state.settings);
        }
        if (fn === 'onboarding') {
            state.categories = [
                { id: 1, name: 'Salary', type: 'income', icon: '💰' },
                { id: 2, name: 'Groceries', type: 'expense', icon: '🛒' }
            ];
            state.accounts = [{ id: 1, name: 'Cash', type: 'cash' }];
            state.onboardCalls = (state.onboardCalls || 0) + 1;
            return json(route, { ok: true, seeded: true });
        }
        if (fn === 'account') {
            if (method === 'DELETE') {
                state.deleted = route.request().postDataJSON();
                state.loggedIn = false;
                return json(route, { ok: true });
            }
            return json(route, { exported_at: 'now', transactions: state.transactions });
        }
        if (fn === 'forgot-password') {
            state.forgot = route.request().postDataJSON();
            return json(route, { ok: true });
        }
        if (fn === 'reset-password') {
            state.reset = route.request().postDataJSON();
            return json(route, { ok: true });
        }
        if (fn === 'categories') return json(route, state.categories || CATEGORIES);
        if (fn === 'transactions') {
            if (method === 'POST') {
                const tx = route.request().postDataJSON();
                state.transactions.unshift({ ...tx, id: `t${state.transactions.length + 1}` });
                return json(route, { ok: true });
            }
            return json(route, state.transactions);
        }
        if (fn === 'accounts') {
            state.accounts = state.accounts || ACCOUNTS.slice();
            if (method === 'POST') {
                const acc = route.request().postDataJSON();
                state.accounts.push({ ...acc, id: state.accounts.length + 1 });
                return json(route, { ok: true });
            }
            if (method === 'DELETE') {
                const id = Number(url.searchParams.get('id'));
                state.accounts = state.accounts.filter(a => a.id !== id);
                return json(route, { ok: true });
            }
            return json(route, state.accounts);
        }
        if (fn === 'logout') {
            state.loggedIn = false;
            return json(route, { ok: true });
        }
        return json(route, { error: `unstubbed: ${fn}` }, 500);
    });
}

test('login flow: bad password shows an error, good password opens the app', async ({ page }) => {
    const state = { loggedIn: false, transactions: fixtureTransactions() };
    await stubApi(page, state);
    await page.goto('/');

    // Logged out: auth screen visible, app hidden.
    await expect(page.locator('#auth-container')).toBeVisible();
    await expect(page.locator('.container')).toBeHidden();

    // Wrong password -> inline error, still on the auth screen.
    await page.fill('#login-email', USER.email);
    await page.fill('#login-password', 'wrong');
    await page.click('#login-form button[type="submit"]');
    await expect(page.locator('#auth-error')).toContainText('Invalid email or password');

    // Correct password -> reload -> app visible with data loaded.
    await page.fill('#login-password', 'correct-horse');
    await page.click('#login-form button[type="submit"]');
    await expect(page.locator('.container')).toBeVisible();
    await expect(page.locator('#status-text')).toHaveText('Connected');
});

test('add transaction -> dashboard totals, list and charts update', async ({ page }) => {
    const state = { loggedIn: true, transactions: fixtureTransactions() };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    // Fill the Add Transaction form.
    await page.selectOption('#type', 'expense');
    await page.fill('#amount', '450');
    await page.selectOption('#category', 'Food');
    await page.fill('#payment-to', 'Grocery Store');
    await page.selectOption('#payment-source', 'upi');
    await page.selectOption('#source-details', 'UBI');
    await page.click('#transaction-form button[type="submit"]');

    // Toast confirms the save.
    await expect(page.locator('#toast-notification')).toContainText('Transaction saved');

    // Dashboard reflects the new expense: 1200 + 450.
    await page.click('.nav-tab[data-page="dashboard"]');
    const summaryValue = label => page.locator('.summary-row', { hasText: label }).locator('.v').first();
    await expect(summaryValue('Income this cycle')).toHaveText('₹50,000.00');
    await expect(summaryValue('Expenses this cycle')).toHaveText('₹1,650.00');
    await expect(summaryValue('Remaining')).toHaveText('₹48,350.00');

    // The new transaction is listed with its details.
    const list = page.locator('#transactions-list');
    await expect(list).toContainText('Grocery Store');
    await expect(list).toContainText('450.00');

    // Charts rendered (Chart.js attaches to the canvases).
    await expect(page.locator('#dashboard-react-root canvas')).toHaveCount(2);
    await expect(page.locator('#dashboard-react-root canvas').first()).toBeVisible();

    // Projection card computed something (engine ran without errors).
    await expect(page.locator('.predictive-lead')).not.toBeEmpty();
});

test('accounts page: add a card, use it on a transaction, then remove it', async ({ page }) => {
    const state = { loggedIn: true, transactions: fixtureTransactions() };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    // React-ported page (src/react/pages/AccountsPage.tsx) — no ids on the
    // form controls, so these use accessible-name locators scoped to the
    // mount container instead.
    const accountsRoot = page.locator('#accounts-react-root');
    await page.click('.nav-tab[data-page="accounts"]');
    await accountsRoot.getByPlaceholder('e.g., HDFC Millennia').fill('HDFC Millennia');
    await accountsRoot.getByRole('combobox').selectOption('credit-card');
    await accountsRoot.getByRole('button', { name: 'Add' }).click();
    await expect(accountsRoot).toContainText('HDFC Millennia');

    // The new card is available as a source-details option on the add form
    // — proves the React island's resync call (window.app.loadAccounts())
    // reaches the still-vanilla transaction form.
    await page.click('.nav-tab[data-page="add-transaction"]');
    await page.selectOption('#payment-source', 'credit-card');
    await expect(page.locator('#source-details')).toContainText('HDFC Millennia');

    // Remove it again.
    await page.click('.nav-tab[data-page="accounts"]');
    await accountsRoot.getByRole('button', { name: 'Remove HDFC Millennia' }).click();
    await expect(accountsRoot).not.toContainText('HDFC Millennia');
});

test('dashboard warns when the Offering category is under the giving floor', async ({ page }) => {
    const state = {
        loggedIn: true,
        transactions: [
            {
                id: 't1',
                type: 'income',
                category: 'Salary',
                amount: 50000,
                transaction_date: dstr(-5),
                payment_to: 'Employer',
                payment_source: 'salary',
                source_details: 'UBI',
                is_recurring: false
            }
        ]
    };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    // No Offering spend yet against ₹50000 income -> floor warning shows.
    await page.click('.nav-tab[data-page="dashboard"]');
    const floorWarning = page.locator('.budget-warning-item', { hasText: 'more to reach floor' });
    await expect(floorWarning).toContainText('Offering');
});

test('insights never flags the giving-floor category as an overspending anomaly', async ({ page }) => {
    const state = {
        loggedIn: true,
        transactions: [
            // Previous cycle (historical baseline).
            {
                id: 't1',
                type: 'income',
                category: 'Salary',
                amount: 40000,
                transaction_date: dstr(-35),
                payment_to: 'Employer',
                payment_source: 'salary',
                source_details: 'UBI',
                is_recurring: false
            },
            {
                id: 't2',
                type: 'expense',
                category: 'Offering',
                amount: 2000,
                transaction_date: dstr(-30),
                payment_to: 'Church',
                payment_source: 'upi',
                source_details: 'UBI',
                is_recurring: false
            },
            {
                id: 't3',
                type: 'expense',
                category: 'Food',
                amount: 1000,
                transaction_date: dstr(-28),
                payment_to: 'Zomato',
                payment_source: 'upi',
                source_details: 'UBI',
                is_recurring: false
            },
            // Current cycle: Offering grew with income (expected, not a leak);
            // Food genuinely spiked (a real anomaly the detector should still catch).
            {
                id: 't4',
                type: 'income',
                category: 'Salary',
                amount: 50000,
                transaction_date: dstr(-5),
                payment_to: 'Employer',
                payment_source: 'salary',
                source_details: 'UBI',
                is_recurring: false
            },
            {
                id: 't5',
                type: 'expense',
                category: 'Offering',
                amount: 2600,
                transaction_date: dstr(-2),
                payment_to: 'Church',
                payment_source: 'upi',
                source_details: 'UBI',
                is_recurring: false
            },
            {
                id: 't6',
                type: 'expense',
                category: 'Food',
                amount: 3000,
                transaction_date: dstr(-1),
                payment_to: 'Zomato',
                payment_source: 'upi',
                source_details: 'UBI',
                is_recurring: false
            }
        ]
    };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    // React-ported page (src/react/pages/InsightsPage.tsx).
    await page.click('.nav-tab[data-page="ai-insights"]');
    await page.click('button:has-text("Analyze Historical Data")');

    const result = page.locator('#insights-react-root .ai-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Food');
    await expect(result).not.toContainText('Offering');
});

test('recurring suggestions only appear once the monthly due date has arrived', async ({ page }) => {
    const state = {
        loggedIn: true,
        transactions: [
            {
                id: 't1',
                type: 'income',
                category: 'Salary',
                amount: 50000,
                transaction_date: dstr(-5),
                payment_to: 'Employer',
                payment_source: 'salary',
                source_details: 'UBI',
                is_recurring: false
            },
            // Billed 3 days ago -> next due date is ~a month away: not yet due.
            {
                id: 't2',
                type: 'expense',
                category: 'Food',
                amount: 199,
                transaction_date: dstr(-3),
                payment_to: 'Spotify',
                payment_source: 'credit-card',
                source_details: 'ICICI Amazon',
                is_recurring: true
            },
            // Billed 40 days ago -> a month later is already in the past: due now.
            {
                id: 't3',
                type: 'expense',
                category: 'Food',
                amount: 1750,
                transaction_date: dstr(-40),
                payment_to: 'Claude Pro',
                payment_source: 'credit-card',
                source_details: 'ICICI Amazon',
                is_recurring: true
            }
        ]
    };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    const suggestions = page.locator('#recurring-suggestions');
    await expect(suggestions).toContainText('Claude Pro');
    await expect(suggestions).not.toContainText('Spotify');
});

test('the giving-floor category never gets a fixed recurring due-date, even if marked recurring', async ({
    page
}) => {
    const state = {
        loggedIn: true,
        transactions: [
            {
                id: 't1',
                type: 'income',
                category: 'Salary',
                amount: 50000,
                transaction_date: dstr(-5),
                payment_to: 'Employer',
                payment_source: 'salary',
                source_details: 'UBI',
                is_recurring: false
            },
            // Marked recurring and billed 40 days ago -> by the fixed
            // monthly-due-date math this would read as "due now", but giving
            // is manual/any-day, tracked instead by the giving-floor warning.
            {
                id: 't2',
                type: 'expense',
                category: 'Offering',
                amount: 500,
                transaction_date: dstr(-40),
                payment_to: 'Church',
                payment_source: 'upi',
                source_details: 'UBI',
                is_recurring: true
            }
        ]
    };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    await expect(page.locator('#recurring-suggestions')).not.toContainText('Offering');
    await expect(page.locator('#recurring-suggestions')).not.toContainText('Church');
});

test('settings live on the account: a new browser sees budgets saved elsewhere, and legacy local values are imported once', async ({
    page
}) => {
    const state = {
        loggedIn: true,
        transactions: fixtureTransactions(),
        settings: {
            exists: true,
            salary_account: 'UBI',
            budget_limits: { Food: 1000 },
            giving_floor_pct: 5,
            giving_floor_category: '',
            onboarded_at: 'x'
        }
    };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();
    await expect(page.locator('#status-text')).toHaveText('Connected');
    // Food spend 1200 vs limit 1000 -> over budget, driven purely by server settings.
    await page.click('.nav-tab[data-page="dashboard"]');
    await expect(page.locator('.budget-warning-item', { hasText: 'Over budget' })).toBeVisible();

    // Legacy localStorage values are uploaded once when the account has no row.
    const state2 = { loggedIn: true, transactions: fixtureTransactions() };
    const page2 = await page.context().newPage();
    await page2.addInitScript(() => {
        localStorage.setItem('budgetLimits', JSON.stringify({ Food: 900 }));
        localStorage.setItem('salaryAccount', 'ICICI');
    });
    await stubApi(page2, state2);
    await page2.goto('/');
    await expect(page2.locator('#status-text')).toHaveText('Connected');
    await expect.poll(() => state2.settings && state2.settings.exists).toBe(true);
    expect(state2.settings.budget_limits).toEqual({ Food: 900 });
    expect(state2.settings.salary_account).toBe('ICICI');
});

test('a brand-new account sees onboarding, seeds defaults once, and existing users never see it', async ({
    page
}) => {
    const state = { loggedIn: true, transactions: [], categories: [], accounts: [] };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.onboarding-card')).toBeVisible();
    await page.fill('#onboarding-bank', 'HDFC');
    await page.click('text=Set up with defaults');
    await expect(page.locator('.onboarding-card')).toBeHidden();
    expect(state.onboardCalls).toBe(1);
    expect(state.settings.salary_account).toBe('HDFC');

    const existing = await page.context().newPage();
    const state2 = { loggedIn: true, transactions: fixtureTransactions() };
    await stubApi(existing, state2);
    await existing.goto('/');
    await expect(existing.locator('#status-text')).toHaveText('Connected');
    await expect(existing.locator('.onboarding-card')).toHaveCount(0);
});

test('account page: export downloads a file; delete needs DELETE and signs the user out', async ({
    page
}) => {
    const state = { loggedIn: true, transactions: fixtureTransactions() };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('#status-text')).toHaveText('Connected');
    await page.click('#account-btn');
    await expect(page.locator('#account.active')).toBeVisible();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('text=Download my data')
    ]);
    expect(download.suggestedFilename()).toBe('expense-tracker-export.json');

    const del = page.getByRole('button', { name: /Delete my account/ });
    await expect(del).toBeDisabled();
    await page.fill('#delete-confirm', 'DELETE');
    await del.click();
    await expect(page.locator('#auth-container')).toBeVisible();
    expect(state.deleted).toEqual({ confirm: 'DELETE' });
});

test('password reset: forgot-password request, then a recovery link sets a new password', async ({
    page
}) => {
    const state = { loggedIn: false, transactions: [] };
    await stubApi(page, state);
    await page.goto('/');
    await page.click('#forgot-link');
    await page.fill('#forgot-email', 'e2e@example.com');
    await page.click('#forgot-form button[type="submit"]');
    await expect(page.locator('#auth-success')).toContainText('reset link is on its way');
    expect(state.forgot).toEqual({ email: 'e2e@example.com' });

    await page.goto('/#access_token=recovery.token.value.that.is.long&type=recovery');
    await page.reload();
    await expect(page.locator('#reset-form')).toBeVisible();
    await page.fill('#reset-password', 'new-password-123');
    await page.fill('#reset-confirm', 'new-password-123');
    await page.click('#reset-form button[type="submit"]');
    await expect(page.locator('#auth-success')).toContainText('Password updated');
    expect(state.reset).toEqual({
        access_token: 'recovery.token.value.that.is.long',
        password: 'new-password-123'
    });
    expect(page.url()).not.toContain('access_token');
});
