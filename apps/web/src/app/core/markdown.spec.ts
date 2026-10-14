import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MarkdownNodes } from '../room/markdown-nodes';
import { MarkdownRenderer, safeHttpUrl } from './markdown';
import type { MdNode } from './markdown';

@Component({
  selector: 'app-md-host',
  imports: [MarkdownNodes],
  template: `<div id="out"><app-markdown-nodes [nodes]="nodes" /></div>`,
})
class Host {
  nodes: readonly MdNode[] = [];
}

/** Render Markdown through the real renderer and component, like the active-story area does. */
function html(source: string): HTMLElement {
  const nodes = TestBed.inject(MarkdownRenderer).render(source);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.nodes = nodes;
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('#out') as HTMLElement;
}

const FORBIDDEN_TAGS = [
  'script',
  'img',
  'svg',
  'iframe',
  'style',
  'form',
  'meta',
  'base',
  'table',
  'object',
  'embed',
  'input',
  'link',
];

function expectInert(el: HTMLElement) {
  for (const tag of FORBIDDEN_TAGS) expect(el.querySelector(tag), tag).toBeNull();
  for (const node of Array.from(el.querySelectorAll('*'))) {
    for (const attr of Array.from(node.attributes)) {
      expect(attr.name.startsWith('on'), `${node.tagName} ${attr.name}`).toBe(false);
    }
  }
  for (const a of Array.from(el.querySelectorAll('a'))) {
    expect(a.getAttribute('href')).toMatch(/^https?:\/\//);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  }
  for (const h of Array.from(el.querySelectorAll('h1,h2,h3,h5,h6'))) {
    throw new Error(`unexpected heading ${h.tagName}`);
  }
}

describe('MarkdownRenderer allow-list', () => {
  it('F02-AC8 renders paragraphs, emphasis, strong, strikethrough, code, lists, quotes and rules', () => {
    const el = html(
      [
        'Plain *em* and **strong** and ~~gone~~ and `code`.',
        '',
        '- one',
        '- two',
        '',
        '3. three',
        '4. four',
        '',
        '> quoted',
        '',
        '---',
        '',
        '```',
        'fenced <b>',
        '```',
      ].join('\n'),
    );
    expect(el.querySelector('em')?.textContent).toBe('em');
    expect(el.querySelector('strong')?.textContent).toBe('strong');
    expect(el.querySelector('s')?.textContent).toBe('gone');
    expect(el.querySelector('p code')?.textContent).toBe('code');
    expect(el.querySelectorAll('ul li')).toHaveLength(2);
    expect(el.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(el.querySelector('blockquote')?.textContent).toContain('quoted');
    expect(el.querySelector('hr')).not.toBeNull();
    expect(el.querySelector('pre code')?.textContent).toBe('fenced <b>');
  });

  it('F02-AC8 keeps single newlines as line breaks and adjacent inline text unspaced', () => {
    const el = html('a*b*c\nnext line');
    expect(el.querySelector('p')?.textContent).toBe('abcnext line');
    expect(el.querySelector('br')).not.toBeNull();
  });

  it('F02-AC8 headings render as h4 at most, whatever the level', () => {
    const el = html('# one\n\n## two\n\n###### six\n\nSetext\n===');
    expect(el.querySelectorAll('h4')).toHaveLength(4);
    expectInert(el);
  });

  it('F02-AC8 images show alt text only and are never fetched', () => {
    const el = html('![tracking pixel](https://tracker.example/pixel.png)');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('tracking pixel');
    expect(el.querySelector('a')).toBeNull();
  });

  it('F02-AC8 tables are not parsed', () => {
    const el = html('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(el.querySelector('table')).toBeNull();
    expect(el.textContent).toContain('| a | b |');
  });

  it('F02-AC8 http(s) links get rel, target and a hidden "(opens in new tab)"', () => {
    const el = html('[docs](https://docs.example/a?b=1) and <https://auto.example/>');
    const links = Array.from(el.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    expectInert(el);
    expect(links[0]!.textContent).toContain('docs');
    expect(links[0]!.querySelector('.visually-hidden')?.textContent).toContain('opens in new tab');
  });

  it('F02-AC8 reference links work when http(s)', () => {
    const el = html('[x][1]\n\n[1]: https://ref.example/');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://ref.example/');
  });
});

describe('MarkdownRenderer XSS corpus', () => {
  const dangerousSchemes = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'jav&#x61;script:alert(1)',
    'jav&#97;script:alert(1)',
    '&#106;avascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://files.example/x',
    '//evil.example/x',
    '/relative',
    'example.com',
    ' javascript:alert(1)',
    'java%0ascript:alert(1)',
  ];

  for (const target of dangerousSchemes) {
    it(`F02-AC8 inline link to ${JSON.stringify(target)} is plain text`, () => {
      const el = html(`[click](${target}) and [angle](<${target}>)`);
      expectInert(el);
      expect(el.querySelector('a')).toBeNull();
      expect(el.textContent).toContain('click');
    });

    it(`F02-AC8 reference link to ${JSON.stringify(target)} is plain text`, () => {
      const el = html(`[click][r]\n\n[r]: <${target}>`);
      expectInert(el);
      expect(el.querySelector('a')).toBeNull();
    });
  }

  it('F02-AC8 autolinks with dangerous schemes are not links', () => {
    for (const src of [
      '<javascript:alert(1)>',
      '<data:text/html,x>',
      '<vbscript:x>',
      '<mailto:a@b.c>',
    ]) {
      const el = html(src);
      expectInert(el);
      expect(el.querySelector('a'), src).toBeNull();
    }
  });

  const rawHtml = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)></svg>',
    '<iframe src="https://evil.example"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<style>body{display:none}</style>',
    '<form action="https://evil.example"><input name=x></form>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
    '<div onclick="alert(1)">hi</div>',
    '<details open ontoggle=alert(1)>',
    'text <b>bold</b> inline <img src=x onerror=alert(1)> end',
    '[<img src=x onerror=alert(1)>](https://ok.example/)',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  ];

  for (const src of rawHtml) {
    it(`F02-AC8 raw HTML is escaped as text: ${src.slice(0, 40)}`, () => {
      const el = html(src);
      expectInert(el);
      // The markup is shown, not interpreted.
      expect(el.textContent).toMatch(/[<&]/);
    });
  }

  it('F02-AC8 raw HTML inside code stays literal', () => {
    const el = html('`<script>x</script>`\n\n```html\n<img src=x onerror=alert(1)>\n```');
    expectInert(el);
    expect(el.textContent).toContain('<script>x</script>');
  });

  it('F02-AC8 entities decode to text, never to markup', () => {
    const el = html('&lt;b&gt;not bold&lt;/b&gt; &amp; &#60;i&#62;');
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('i')).toBeNull();
    expect(el.textContent).toContain('<b>not bold</b>');
  });

  it('F02-AC8 pathological input renders quickly', () => {
    for (const src of [
      '>'.repeat(5000),
      '['.repeat(5000),
      '- '.repeat(2000),
      '*'.repeat(5000),
      '`'.repeat(5000),
    ]) {
      const start = performance.now();
      const el = html(src);
      expect(performance.now() - start).toBeLessThan(1000);
      expectInert(el);
    }
  });

  it('F02-AC8 blank or markup-free input yields no nodes or plain text', () => {
    expect(TestBed.inject(MarkdownRenderer).render('   \n ')).toEqual([]);
    expect(html('just text').textContent?.trim()).toBe('just text');
  });
});

describe('safeHttpUrl', () => {
  it('F02-AC2 accepts absolute http(s) URLs only', () => {
    expect(safeHttpUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHttpUrl('HTTP://a.example')).toBe('http://a.example/');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/plain,x',
      'ftp://a.example',
      '//a.example',
      'a.example',
      'https://',
      'https://a.example/ x',
      '',
    ]) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
  });
});
