import type { FrameRecorder } from './ws-recorder';

/**
 * F01-AC11 helper. Returns the frames of `recorder` (received only) that contain any of
 * `forbidden`, after removing the parts that legitimately carry the tokens:
 * the deck definition (`settings.deck`) and the recipient's own `myVote`.
 */
export function framesLeaking(
  recorder: FrameRecorder,
  forbidden: readonly string[],
  fromMark = 0,
): { text: string; token: string }[] {
  const hits: { text: string; token: string }[] = [];
  for (const f of recorder.since(fromMark)) {
    if (f.dir !== 'in') continue;
    let haystack = f.text;
    try {
      const json = JSON.parse(f.text) as { type?: string; state?: Record<string, unknown> };
      if (json.type === 'state' && json.state) {
        const settings = json.state['settings'] as Record<string, unknown> | undefined;
        if (settings) delete settings['deck'];
        delete json.state['myVote'];
      }
      haystack = JSON.stringify(json);
    } catch {
      // Not JSON: search the raw text.
    }
    for (const token of forbidden) {
      if (haystack.includes(token)) hits.push({ text: f.text, token });
    }
  }
  return hits;
}
