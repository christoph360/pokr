import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { makeStoryRoom, sp } from '../fixtures/story-room';
import { addStory, expectOk, selectStory } from '../helpers/stories';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

/** Hosts that must never be contacted: a request to one means the renderer fetched content. */
const EVIL = 'evil.example';

interface Payload {
  name: string;
  markdown: string;
  /** Text that must be visible literally (HTML is escaped, not stripped silently). */
  literal?: string;
  /** Also run on firefox / webkit / mobile (sanitizer and DOM differences per engine). */
  everywhere?: boolean;
}

/** F02-AC8 XSS corpus. Each payload is used as a description and, separately, as a title. */
const XSS: Payload[] = [
  {
    name: 'script tag',
    everywhere: true,
    markdown: '<script>window.__xss=1;alert(1)</script>',
    literal: '<script>',
  },
  {
    name: 'img onerror',
    everywhere: true,
    markdown: '<img src=x onerror="window.__xss=1;alert(1)">',
    literal: '<img',
  },
  { name: 'svg onload', markdown: '<svg onload="window.__xss=1"></svg>', literal: '<svg' },
  {
    name: 'iframe',
    markdown: '<iframe src="https://evil.example/frame"></iframe>',
    literal: '<iframe',
  },
  { name: 'javascript link', everywhere: true, markdown: '[click me](javascript:window.__xss=1)' },
  { name: 'mixed-case javascript link', markdown: '[click me](JaVaScRiPt:window.__xss=1)' },
  {
    name: 'entity-encoded javascript link',
    markdown: '[click me](jav&#x61;script:window.__xss=1)',
  },
  {
    name: 'data link',
    markdown: '[click me](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  },
  { name: 'vbscript link', markdown: '[click me](vbscript:msgbox(1))' },
  { name: 'javascript autolink', markdown: '<javascript:window.__xss=1>' },
  {
    name: 'html anchor with javascript',
    everywhere: true,
    markdown: '<a href="javascript:window.__xss=1">x</a>',
    literal: '<a href',
  },
  {
    name: 'image from a third party',
    everywhere: true,
    markdown: `![tracking pixel](https://${EVIL}/pixel.png)`,
  },
  {
    name: 'raw html image from a third party',
    markdown: `<img src="https://${EVIL}/pixel.png">`,
    literal: '<img',
  },
  { name: 'style tag', markdown: '<style>body{display:none}</style>', literal: '<style>' },
  {
    name: 'form',
    markdown: `<form action="https://${EVIL}/steal"><input name=x></form>`,
    literal: '<form',
  },
  {
    name: 'meta refresh',
    markdown: `<meta http-equiv="refresh" content="0;url=https://${EVIL}">`,
    literal: '<meta',
  },
  { name: 'base tag', markdown: `<base href="https://${EVIL}/">`, literal: '<base' },
  {
    name: 'event handler attribute',
    everywhere: true,
    markdown: '<div onmouseover="window.__xss=1" style="position:fixed;inset:0">x</div>',
    literal: '<div',
  },
  {
    name: 'html inside link text',
    markdown: '[<img src=x onerror=window.__xss=1>](https://example.com)',
  },
  {
    name: 'nested malformed markdown',
    markdown: '[[[x](y)](z)](javascript:window.__xss=1) **<b>*`',
  },
];

async function assertInert(
  page: Page,
  area: ReturnType<typeof sp>['activeStory'],
  requests: string[],
): Promise<void> {
  // No active content or resource-loading element inside the story area.
  await expect(
    area.locator('script, iframe, img, style, form, object, embed, link, meta, base, svg, input'),
  ).toHaveCount(0);
  const hasHandler = await area.evaluate((el) =>
    [el, ...Array.from(el.querySelectorAll('*'))].some((n) =>
      Array.from(n.attributes).some(
        (a) => a.name.toLowerCase().startsWith('on') || a.name === 'style',
      ),
    ),
  );
  expect(hasHandler, 'no on* or style attribute inside the story area').toBe(false);
  const hrefs = await area
    .locator('a[href]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  for (const href of hrefs) expect(href).toMatch(/^https?:\/\//i);
  const links = area.locator('a[href]');
  const n = await links.count();
  for (let i = 0; i < n; i++) {
    await expect(links.nth(i)).toHaveAttribute('target', '_blank');
    await expect(links.nth(i)).toHaveAttribute('rel', /noopener/);
    await expect(links.nth(i)).toHaveAttribute('rel', /noreferrer/);
    await expect(links.nth(i)).toHaveAttribute('rel', /nofollow/);
  }
  expect(
    await page.evaluate(() => (globalThis as unknown as { __xss?: unknown }).__xss),
  ).toBeUndefined();
  expect(
    requests.filter((u) => u.includes(EVIL)),
    'third-party requests',
  ).toEqual([]);
}

function watch(page: Page): { requests: string[]; problems: string[] } {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => {
    problems.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { requests, problems };
}

test.describe('F02 Markdown rendering (AC8)', () => {
  for (const p of XSS) {
    test(
      `F02-AC8: ${p.name} is rendered inert as a description and as a title`,
      p.everywhere ? cross : chromiumOnly,
      async ({ world }) => {
        const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
          titles: ['Placeholder'],
        });
        const vera = others[0]!;
        const seen = watch(vera.page);
        const seenFac = watch(fac.page);
        const titleId = await addStory(raw, p.markdown.slice(0, 200));
        expectOk(
          await raw.command('edit_story', {
            storyId: ids['Placeholder']!,
            description: p.markdown,
          }),
        );
        expectOk(await selectStory(raw, ids['Placeholder']!));
        await expect(sp(vera).activeTitle).toHaveText('Placeholder');
        await expect(sp(vera).activeDescription).toBeVisible();
        await assertInert(vera.page, sp(vera).activeStory, seen.requests);
        if (p.literal) await expect(sp(vera).activeDescription).toContainText(p.literal);
        // As a title (plain text, shown in the agenda and as the active title).
        expectOk(await selectStory(raw, titleId));
        await expect(sp(vera).activeTitle).toContainText(p.markdown.slice(0, 20));
        await assertInert(vera.page, sp(vera).activeStory, seen.requests);
        await expect(
          sp(vera).agenda.locator('img, script, iframe, form, style, a[href^="javascript" i]'),
        ).toHaveCount(0);
        // The facilitator's view is just as inert.
        await assertInert(fac.page, sp(fac).activeStory, seenFac.requests);
        expect(seen.problems).toEqual([]);
        expect(seenFac.problems).toEqual([]);
      },
    );
  }

  test(
    'F02-AC8: the supported Markdown subset renders; headings never become page-level headings; images are never shown',
    cross,
    async ({ world }) => {
      const { others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story'],
      });
      const vera = others[0]!;
      const md = [
        '# Heading one',
        '',
        'A paragraph with **strong**, *emphasis*, ~~strike~~ and `inline code`.',
        '',
        '- item one',
        '- item two',
        '',
        '1. first',
        '2. second',
        '',
        '> quoted text',
        '',
        '```',
        'fenced code',
        '```',
        '',
        '---',
        '',
        '![alt text only](https://evil.example/pic.png)',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
      ].join('\n');
      expectOk(await raw.command('edit_story', { storyId: ids['Story']!, description: md }));
      expectOk(await selectStory(raw, ids['Story']!));
      const d = sp(vera).activeDescription;
      await expect(d.locator('strong')).toHaveText('strong');
      await expect(d.locator('em')).toHaveText('emphasis');
      await expect(d.locator('del, s')).toHaveText('strike');
      await expect(d.locator('code').first()).toBeAttached();
      await expect(d.locator('pre')).toContainText('fenced code');
      await expect(d.locator('ul li')).toHaveCount(2);
      await expect(d.locator('ol li')).toHaveCount(2);
      await expect(d.locator('blockquote')).toContainText('quoted text');
      await expect(d.locator('hr')).toHaveCount(1);
      // Headings render as styled text, at most h4, never h1 to h3.
      await expect(d.locator('h1, h2, h3')).toHaveCount(0);
      await expect(d).toContainText('Heading one');
      // No images, no tables.
      await expect(d.locator('img, table')).toHaveCount(0);
      await expect(d).toContainText('alt text only');
    },
  );

  test(
    'F02-AC8: links open in a new tab with noopener noreferrer nofollow and say so in text; the story link follows the same rules',
    cross,
    async ({ world }) => {
      const { others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story'],
      });
      const vera = others[0]!;
      expectOk(
        await raw.command('edit_story', {
          storyId: ids['Story']!,
          description: 'See [the docs](https://docs.example/page) and <https://auto.example/x>.',
          link: 'https://tracker.example/issue/9',
        }),
      );
      expectOk(await selectStory(raw, ids['Story']!));
      const docs = sp(vera).activeDescription.getByRole('link', { name: /the docs/ });
      await expect(docs).toHaveAttribute('href', 'https://docs.example/page');
      for (const link of [
        docs,
        sp(vera).activeDescription.locator('a[href^="https://auto.example"]'),
        sp(vera).activeLink,
      ]) {
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
        await expect(link).toHaveAttribute('rel', /noreferrer/);
        await expect(link).toHaveAttribute('rel', /nofollow/);
        await expect(link).toContainText(/opens in new tab/i);
      }
    },
  );

  test('F02-AC8: a title is plain text, never Markdown', cross, async ({ world }) => {
    const { others, raw } = await makeStoryRoom(world, [{ name: 'Vera' }], {});
    const vera = others[0]!;
    const id = await addStory(raw, '**not bold** [not a link](https://example.com) `x`');
    expectOk(await selectStory(raw, id));
    await expect(sp(vera).activeTitle).toHaveText(
      '**not bold** [not a link](https://example.com) `x`',
    );
    await expect(sp(vera).activeTitle.locator('strong, a, code')).toHaveCount(0);
  });

  test(
    'F02-AC8: pathological Markdown renders without freezing the page',
    chromiumOnly,
    async ({ world }) => {
      const { others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['A', 'B', 'C', 'D'],
      });
      const vera = others[0]!;
      const bombs = ['>'.repeat(5_000), '['.repeat(5_000), '- '.repeat(2_500), '*'.repeat(5_000)];
      for (const [i, title] of ['A', 'B', 'C', 'D'].entries()) {
        expectOk(await raw.command('edit_story', { storyId: ids[title]!, description: bombs[i]! }));
        expectOk(await selectStory(raw, ids[title]!));
        await expect(sp(vera).activeTitle).toHaveText(title);
        await expect(sp(vera).activeStory).toBeVisible();
        const started = Date.now();
        // The page still answers script evaluation quickly.
        await vera.page.evaluate(() => 1 + 1);
        expect(Date.now() - started).toBeLessThan(2_000);
      }
    },
  );

  test(
    'F02-AC8: a long description is limited in height with a Show more toggle and the cards stay reachable',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story'],
      });
      const vera = others[0]!;
      const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
      expectOk(await raw.command('edit_story', { storyId: ids['Story']!, description: long }));
      expectOk(await selectStory(raw, ids['Story']!));
      await expect(sp(vera).descriptionToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(vera.room.card('5')).toBeInViewport();
      await sp(vera).descriptionToggle.click();
      await expect(sp(vera).descriptionToggle).toHaveAttribute('aria-expanded', 'true');
      await sp(vera).descriptionToggle.click();
      await expect(sp(vera).descriptionToggle).toHaveAttribute('aria-expanded', 'false');
      // A short description needs no toggle.
      expectOk(await raw.command('edit_story', { storyId: ids['Story']!, description: 'short' }));
      await expect(sp(vera).descriptionToggle).toHaveCount(0);
      await expect(sp(fac).activeDescription).toContainText('short');
    },
  );
});
