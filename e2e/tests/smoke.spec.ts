import { expect, test } from '@playwright/test';

test('start page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'pokr' })).toBeVisible();
});

test('api health is reachable through the web dev proxy', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ ok: true });
});
