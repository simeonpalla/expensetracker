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
        if (fn === 'categories') return json(route, CATEGORIES);
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
    await expect(page.locator('#total-income')).toHaveText('₹50000.00');
    await expect(page.locator('#total-expenses')).toHaveText('₹1650.00');
    await expect(page.locator('#net-balance')).toHaveText('₹48350.00');

    // The new transaction is listed with its details.
    const list = page.locator('#transactions-list');
    await expect(list).toContainText('Grocery Store');
    await expect(list).toContainText('450.00');

    // Charts rendered (Chart.js attaches to the canvases).
    await expect(page.locator('#chart')).toBeVisible();
    const hasCharts = await page.evaluate(() =>
        Boolean(window.app && window.app.chart && window.app.expenseDonutChart)
    );
    expect(hasCharts).toBe(true);

    // Projection card computed something (engine ran without errors).
    await expect(page.locator('#run-rate')).not.toHaveText('Calculating...');
});

test('accounts page: add a card, use it on a transaction, then remove it', async ({ page }) => {
    const state = { loggedIn: true, transactions: fixtureTransactions() };
    await stubApi(page, state);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    await page.click('.nav-tab[data-page="accounts"]');
    await page.fill('#account-name', 'HDFC Millennia');
    await page.selectOption('#account-type', 'credit-card');
    await page.click('#account-form button[type="submit"]');
    await expect(page.locator('#accounts-display')).toContainText('HDFC Millennia');

    // The new card is available as a source-details option on the add form.
    await page.click('.nav-tab[data-page="add-transaction"]');
    await page.selectOption('#payment-source', 'credit-card');
    await expect(page.locator('#source-details')).toContainText('HDFC Millennia');

    // Remove it again.
    await page.click('.nav-tab[data-page="accounts"]');
    await page.click('#accounts-display .account-delete-btn[aria-label="Remove HDFC Millennia"]');
    await expect(page.locator('#accounts-display')).not.toContainText('HDFC Millennia');
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
    await expect(page.locator('#offering-warning')).toContainText('Offering');
    await expect(page.locator('#offering-warning')).toContainText('more to reach floor');
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

    await page.click('.nav-tab[data-page="ai-insights"]');
    await page.click('#generate-local-ai-btn');

    const result = page.locator('#local-ai-result');
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
