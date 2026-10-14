/**
 * Query by role and accessible name, like a user (and axe) would. Deliberately small: the roles
 * and name sources the story components use. A nameless control fails the lookup, which is the
 * point (F01 lesson: nameless cards and a form without a submit handler passed handler-level tests).
 */
const IMPLICIT: Record<string, string> = {
  button: 'button',
  a: 'link',
  textarea: 'textbox',
  select: 'combobox',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  dialog: 'dialog',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
};

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = el.getAttribute('type') ?? 'text';
    return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'textbox';
  }
  return IMPLICIT[tag] ?? null;
}

function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.getAttribute('aria-hidden') === 'true') return '';
  return Array.from(node.childNodes).map(textOf).join(' ');
}

export function accessibleName(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    return labelledby
      .split(/\s+/)
      .map((id) => root.getElementById?.(id))
      .map((n) => (n ? textOf(n) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const label = el.getAttribute('aria-label');
  if (label) return label.trim();
  const id = el.getAttribute('id');
  if (id) {
    const forLabel = el.ownerDocument.querySelector(`label[for="${id}"]`);
    if (forLabel) return textOf(forLabel).replace(/\s+/g, ' ').trim();
  }
  return textOf(el).replace(/\s+/g, ' ').trim();
}

export function queryAllByRole(
  root: ParentNode,
  role: string,
  name?: string | RegExp,
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
    if (roleOf(el) !== role) return false;
    if (name === undefined) return true;
    const n = accessibleName(el);
    return typeof name === 'string' ? n === name : name.test(n);
  });
}

export function queryByRole(
  root: ParentNode,
  role: string,
  name?: string | RegExp,
): HTMLElement | null {
  return queryAllByRole(root, role, name)[0] ?? null;
}

export function getByRole(root: ParentNode, role: string, name?: string | RegExp): HTMLElement {
  const found = queryAllByRole(root, role, name);
  if (found.length !== 1) {
    const all = queryAllByRole(root, role)
      .map((e) => `"${accessibleName(e)}"`)
      .join(', ');
    throw new Error(
      `Expected one ${role} named ${String(name)}, found ${found.length}. ${role}s: ${all}`,
    );
  }
  return found[0]!;
}

/** Type into a text control the way a user does (value + input event). */
export function typeInto(el: HTMLElement, value: string): void {
  (el as HTMLInputElement | HTMLTextAreaElement).value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
