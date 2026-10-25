import { Injectable } from '@angular/core';
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';

/**
 * The only place that turns story Markdown into something displayable (F02-AC8).
 *
 * Rendering never goes through `innerHTML`: markdown-it parses to tokens (raw HTML disabled, tables
 * disabled), the tokens become a small typed tree of allow-listed nodes, and a component renders
 * that tree with ordinary Angular templates. Anything outside the allow-list becomes text, which
 * Angular escapes. Links are kept only when `safeHttpUrl` accepts them; images are replaced by
 * their alt text and never fetched; every heading becomes an `h4`.
 */

export type MdTag = 'p' | 'em' | 'strong' | 's' | 'blockquote' | 'ul' | 'ol' | 'li' | 'h4';

export type MdNode =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | { kind: 'hr' }
  | { kind: 'code'; text: string }
  | { kind: 'pre'; text: string }
  | { kind: 'link'; href: string; children: MdNode[] }
  | { kind: 'el'; tag: MdTag; start?: number; children: MdNode[] };

/** Most characters of a description the renderer will look at (the server limit is 5,000 graphemes). */
const MAX_SOURCE_UNITS = 20_000;

/**
 * An absolute http(s) URL with a host, no whitespace or control characters. Returns the normalized
 * `href`, or null for everything else (`javascript:`, `data:`, `vbscript:`, relative URLs...).
 */
export function safeHttpUrl(raw: string): string | null {
  if (raw === '' || raw.length > 2048 || /[\s\p{Cc}]/u.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  return url.href;
}

const OPEN_TAGS: Record<string, MdTag> = {
  paragraph_open: 'p',
  bullet_list_open: 'ul',
  ordered_list_open: 'ol',
  list_item_open: 'li',
  blockquote_open: 'blockquote',
  heading_open: 'h4',
  em_open: 'em',
  strong_open: 'strong',
  s_open: 's',
};

interface Frame {
  open: Token;
  node: MdNode | null;
  children: MdNode[];
}

function buildTree(tokens: readonly Token[]): MdNode[] {
  const root: Frame = { open: tokens[0] as Token, node: null, children: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1] as Frame;

  const walk = (list: readonly Token[]) => {
    for (const token of list) {
      if (token.nesting === 1) {
        stack.push({ open: token, node: null, children: [] });
      } else if (token.nesting === -1) {
        if (stack.length <= 1) continue;
        const frame = stack.pop() as Frame;
        top().children.push(...close(frame));
      } else {
        leaf(token);
      }
    }
  };

  const leaf = (token: Token) => {
    const into = top().children;
    switch (token.type) {
      case 'inline':
        walk(token.children ?? []);
        return;
      case 'softbreak':
      case 'hardbreak':
        into.push({ kind: 'br' });
        return;
      case 'hr':
        into.push({ kind: 'hr' });
        return;
      case 'code_inline':
        into.push({ kind: 'code', text: token.content });
        return;
      case 'fence':
      case 'code_block':
        into.push({ kind: 'pre', text: token.content.replace(/\n$/u, '') });
        return;
      default:
        // text, text_special, images (alt text only) and anything unexpected: plain text.
        if (token.content !== '') into.push({ kind: 'text', text: token.content });
    }
  };

  const close = (frame: Frame): MdNode[] => {
    const { open, children } = frame;
    if (open.type === 'link_open') {
      const href = safeHttpUrl(String(open.attrGet('href') ?? ''));
      return href === null ? children : [{ kind: 'link', href, children }];
    }
    const tag = OPEN_TAGS[open.type];
    if (tag === undefined || (open.type === 'paragraph_open' && open.hidden)) return children;
    const node: MdNode = { kind: 'el', tag, children };
    if (tag === 'ol') {
      const start = Number(open.attrGet('start') ?? '1');
      if (Number.isInteger(start) && start > 1 && start < 1_000_000) node.start = start;
    }
    return [node];
  };

  walk(tokens);
  return root.children;
}

@Injectable({ providedIn: 'root' })
export class MarkdownRenderer {
  private readonly md: InstanceType<typeof MarkdownIt> = this.createParser();

  /** Parse Markdown source into allow-listed nodes. Never throws; unparsable input becomes text. */
  render(source: string): MdNode[] {
    const text = source.slice(0, MAX_SOURCE_UNITS);
    if (text.trim() === '') return [];
    try {
      return buildTree(this.md.parse(text, {}));
    } catch {
      return [{ kind: 'el', tag: 'p', children: [{ kind: 'text', text }] }];
    }
  }

  private createParser(): InstanceType<typeof MarkdownIt> {
    // html: false makes raw HTML ordinary text; linkify off so bare URLs stay text.
    const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true });
    md.disable(['table']);
    return md;
  }
}
