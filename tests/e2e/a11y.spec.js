// Automated accessibility scan (axe-core) of the login screen and the main
// app pages, run against the production build with a stubbed BFF. The gate
// is on serious/critical violations so the suite stays actionable.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// Kill entry animations (the app honors prefers-reduced-motion) so axe
// measures settled colors, not mid-fade blends.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const USER = { id: 'u-test', email: 'a11y@example.com' };

function dstr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
        2,
        '0'
    )}`;
}

async function stubApi(page, loggedIn) {
    const json = (route, body, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    await page.route('**/.netlify/functions/**', route => {
        const fn = new URL(route.request().url()).pathname.replace('/.netlify/functions/', '');
        if (fn === 'me')
            return json(route, loggedIn ? { user: USER } : { error: 'no' }, loggedIn ? 200 : 401);
        if (fn === 'refresh') return json(route, { error: 'no' }, 401);
        if (fn === 'categories')
            return json(route, [
                { id: 1, name: 'Salary', type: 'income', icon: '💰' },
                { id: 2, name: 'Food', type: 'expense', icon: '🍕' }
            ]);
        if (fn === 'transactions')
            return json(route, [
                {
                    id: 't1',
                    type: 'income',
                    category: 'Salary',
                    amount: 50000,
                    transaction_date: dstr(-5),
                    payment_to: 'Employer',
                    payment_source: 'salary'
                },
                {
                    id: 't2',
                    type: 'expense',
                    category: 'Food',
                    amount: 1200,
                    transaction_date: dstr(-2),
                    payment_to: 'Zomato',
                    payment_source: 'upi'
                }
            ]);
        if (fn === 'timelogs') return json(route, []);
        if (fn === 'workouts') return json(route, []);
        if (fn === 'activetimer') return json(route, null);
        return json(route, {}, 200);
    });
}

async function expectNoSeriousViolations(page, context) {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    const summary = serious.map(
        v =>
            `${v.id} (${v.impact}): ${v.help} -> ` +
            v.nodes
                .map(n => {
                    const data = n.any?.[0]?.data;
                    const detail = data
                        ? ` [fg ${data.fgColor} bg ${data.bgColor} ratio ${data.contrastRatio}]`
                        : '';
                    return n.target.join(' ') + detail;
                })
                .join(' | ')
    );
    expect(summary, `axe violations on ${context}`).toEqual([]);
}

test('login screen has no serious accessibility violations', async ({ page }) => {
    await stubApi(page, false);
    await page.goto('/');
    await expect(page.locator('#auth-container')).toBeVisible();
    await expectNoSeriousViolations(page, 'login screen');
});

test('app pages have no serious accessibility violations', async ({ page }) => {
    await stubApi(page, true);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();
    await expect(page.locator('#status-text')).toHaveText('Connected');

    await expectNoSeriousViolations(page, 'add-transaction page');

    await page.click('.nav-tab[data-page="dashboard"]');
    await expect(page.locator('#transactions-list')).toContainText('Zomato');
    await expectNoSeriousViolations(page, 'dashboard');

    await page.click('.nav-tab[data-page="budgets"]');
    await expectNoSeriousViolations(page, 'budgets page');
});

test('edit modal traps focus and closes on Escape', async ({ page }) => {
    await stubApi(page, true);
    await page.goto('/');
    await page.click('.nav-tab[data-page="dashboard"]');
    await page.locator('.edit-btn').first().click();

    const modal = page.locator('#edit-modal-overlay');
    await expect(modal).toBeVisible();
    // Focus starts inside the dialog.
    const focusedInside = await page.evaluate(() =>
        document.getElementById('edit-modal-overlay').contains(document.activeElement)
    );
    expect(focusedInside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // Focus returns to the opener button.
    const focusRestored = await page.evaluate(() => document.activeElement?.classList.contains('edit-btn'));
    expect(focusRestored).toBe(true);
});

test('tabs support arrow-key navigation', async ({ page }) => {
    await stubApi(page, true);
    await page.goto('/');
    await expect(page.locator('.container')).toBeVisible();

    await page.locator('#tab-add-transaction').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-dashboard')).toBeFocused();
    await expect(page.locator('#tab-dashboard')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#dashboard')).toHaveClass(/active/);

    await page.keyboard.press('End');
    await expect(page.locator('#tab-ai-insights')).toBeFocused();
    await expect(page.locator('#ai-insights')).toHaveClass(/active/);
});
