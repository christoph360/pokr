# 0002: EU data residency

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

pokr stores personal data: display names, votes, and later account profiles (name, email,
avatar) and issue tracker tokens. The target audience includes teams in the EU, where GDPR
applies and many companies require EU data residency before a tool can be used.

Cloudflare places Durable Objects and D1 databases near whoever first accesses them, which can
be anywhere in the world. Both products let you restrict storage to a jurisdiction, but only at
creation time: a Durable Object never moves after it is created, and a D1 database's
jurisdiction can't be changed later. Deciding after launch would mean migrating every room and
the account database.

Should pokr restrict where data is stored, and if so, how?

## Decision drivers

- Make pokr usable for EU companies that require EU data residency.
- Decide before the first room exists, because the choice can't be changed in place.
- Stay on standard Cloudflare products and plans (no Enterprise add-ons).
- Keep latency acceptable for the main audience.

## Considered options

1. **EU jurisdiction** for all stores of personal data
2. **Location hints** (`locationHint: "weur"` / `"eeur"`)
3. **No restriction** (default placement)
4. **Per-room choice** (EU or global, chosen at room creation)

## Decision outcome

Chosen option: **EU jurisdiction for every store that holds personal data.**

### Rules that follow from this decision

- **Durable Objects:** always obtain room stubs through the EU sub-namespace, e.g.
  `env.ROOM.jurisdiction("eu").idFromName(roomId)`. Never call `idFromName` / `newUniqueId` on the
  unrestricted namespace. Wrap this in a single helper; other code must not call the binding
  directly. The same name produces different IDs with and without a jurisdiction, so mixing them
  would silently create a second, empty room.
- **Room IDs** stay short random slugs (F01-AC2) mapped with `idFromName`. Durable Object IDs
  are never exposed in URLs.
- **D1:** every database is created with `wrangler d1 create <name> --jurisdiction eu`, in every
  environment (dev, staging, production), so environments behave the same.
- **KV** has no jurisdiction option. It may only hold non-personal data (e.g. feature flags,
  cached public metadata), never sessions, tokens, names, or emails.
- **R2**, if used later, buckets are created with the EU jurisdiction.
- **Logs:** don't log personal data (names, emails, story content, tokens). Log IDs only. Worker
  logs are not covered by the storage jurisdiction.
- A backend test asserts that room stubs carry `id.jurisdiction === "eu"`.

### Consequences

- Good: all persisted personal data stays in EU data centers, which is a common procurement
  requirement and simplifies GDPR documentation.
- Good: no migration later; costs and APIs are the same as unrestricted storage.
- Bad: participants far from Europe get higher latency, roughly 100–250 ms extra round trip
  from the Americas or Asia-Pacific. Acceptable for voting, where messages are rare and small.
- Bad: rules out KV for sessions. Feeds into the F04 ADR (account and session storage), where
  EU-jurisdiction D1 or Durable Objects are the remaining options.
- Neutral: Worker code still runs at the edge location nearest the user, so requests pass
  through (but aren't stored at) non-EU locations. Restricting processing as well would need
  Cloudflare's Data Localization Suite, an Enterprise add-on. Out of scope.
- Neutral: data residency is one part of GDPR compliance, not all of it. A privacy policy,
  Cloudflare's data processing addendum, and records of processing are still needed before
  public launch. Get legal review for those.

## Pros and cons of the options

### EU jurisdiction (chosen)
- Good: enforced guarantee for storage and Durable Object execution, available on standard
  plans.
- Bad: higher latency outside Europe; can't be relaxed per room later.

### Location hints
- Good: lower latency for EU users without hard constraints.
- Bad: best effort only, no guarantee, so it doesn't satisfy a residency requirement.

### No restriction
- Good: lowest latency worldwide.
- Bad: rooms may be stored outside the EU; blocks adoption by EU companies, and can't be fixed
  without migrating data.

### Per-room choice
- Good: global teams could opt out of EU residency.
- Bad: every room lookup must know the room's jurisdiction (encoded in the ID or a lookup
  table), and account data would still need one fixed location. Complexity with no current
  demand.

## Revisit when

- A significant non-EU user base complains about latency. Consider per-room choice, encoding
  the jurisdiction in the room ID.
- Cloudflare adds jurisdiction support to KV, or makes processing-level localization available
  on standard plans.

## References

- [Durable Objects: data location and jurisdictions](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- [D1: data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- [D1 changelog: jurisdiction support (2025-11-05)](https://developers.cloudflare.com/changelog/2025-11-05-d1-jurisdiction/)
