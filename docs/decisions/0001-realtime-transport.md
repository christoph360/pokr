# 0001: Real-time transport for voting rooms

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

Participants in a pokr room need to see each other's presence, vote status, the reveal, and
round resets in near real time. The backend runs on Cloudflare Workers, with one Durable Object
per room as the single source of truth for room state.

Which transport should carry real-time traffic between the Angular client and the room?

## Decision drivers

- **Runs on Workers + Durable Objects** without extra infrastructure.
- **Cost of idle rooms**: rooms sit idle between rounds and should cost close to nothing.
- **Bidirectional**: clients send votes and commands; the server broadcasts state.
- **Presence**: knowing who is connected is a core feature.
- **Browser support**, including corporate networks, where planning poker is typically used.
- **Server-side authority**: votes must stay hidden until reveal, so the server mediates every
  message.
- **Traffic profile**: ~5–15 participants, a few small messages per round. Throughput and
  head-of-line blocking are not concerns.

## Considered options

1. WebSockets on Durable Objects (Hibernation API)
2. WebTransport (HTTP/3 / QUIC)
3. Server-Sent Events + HTTP POST
4. HTTP long polling
5. gRPC bidirectional streaming
6. MQTT

## Decision outcome

Chosen option: **WebSockets terminated in the room's Durable Object, using the WebSocket
Hibernation API.** It is the only option that meets every driver without extra infrastructure.

### Rules that follow from this decision

- Message types live in `packages/shared/` and are **transport-agnostic**: plain discriminated
  unions validated with a schema library, with no WebSocket-specific fields.
- Both client and server access the connection through a small interface (connect, send,
  onMessage, onClose). Room logic must not touch the raw WebSocket API directly.
- Use `state.acceptWebSocket()` and the `webSocketMessage` / `webSocketClose` handlers, not
  `ws.accept()`, so the room can hibernate.
- Per-connection data that must survive hibernation goes in `serializeAttachment()`; room
  state goes in Durable Object storage, not only in memory.
- The client reconnects with backoff and resyncs full room state on reconnect, rather than
  replaying missed events.

### Consequences

- Good: idle rooms hibernate and are not billed for duration. Incoming messages are billed at
  20:1, outgoing messages are free.
- Good: one channel for both directions; close events give presence directly.
- Good: no broker, container, or third-party service to operate.
- Bad: if a network blocks WebSockets, users can't join. Mitigation: see "Revisit when".
- Bad: we write reconnect and resync logic ourselves (`EventSource` would have provided some
  of it for free).

## Pros and cons of the options

### WebSockets on Durable Objects (chosen)
- Good: natively supported, hibernation-aware, bidirectional, presence via close events.
- Bad: manual reconnect handling.

### WebTransport
- Good: QUIC streams and datagrams, no head-of-line blocking; Baseline in all major browsers
  since Safari 26.4 (March 2026).
- Bad: Workers has no QUIC/HTTP3 server implementation and maintainers have said it is not on
  the priority list (workerd discussion #6454, July 2026). Would need a self-hosted server
  outside Workers, plus a WebSocket fallback anyway because many corporate networks block
  UDP 443.
- Bad: its strengths don't matter at our traffic volume.

### Server-Sent Events + POST
- Good: works on Workers; `EventSource` auto-reconnects with `Last-Event-ID`; plain HTTP is
  friendly to proxies.
- Bad: server-to-client only, so commands go over separate POSTs (billed 1:1).
- Bad: an open stream is pending I/O, so the Durable Object cannot hibernate during a session.
- Bad: presence relies on noticing cancelled streams.

### HTTP long polling
- Good: works through virtually any proxy.
- Bad: held requests block hibernation; a request per update per client; needs state
  versioning to avoid missing events between polls; presence needs heartbeats and timeouts.

### gRPC bidirectional streaming
- Bad: browsers can't do it. gRPC-Web and Connect support only unary and server-streaming
  calls, because browser `fetch` is not full-duplex.
- Bad: Cloudflare's gRPC support (August 2026) is private beta and aimed at Containers and
  outbound calls, not browser clients. In practice we'd get server streaming, which is SSE
  with heavier tooling.

### MQTT
- Bad: browsers can only use MQTT over WebSockets, so this adds a broker on top of the
  chosen option.
- Bad: Cloudflare Pub/Sub never left private beta and its docs are no longer published, so it
  would need a third-party broker.
- Bad: plain topic pub/sub would leak votes before reveal. A server must mediate anyway,
  which makes the broker redundant.

## Revisit when

- Users report that WebSockets are blocked on their network. Add **SSE + POST** as a fallback
  behind the same connection interface.
- Workers ships inbound WebTransport support. Re-evaluate; the transport-agnostic contract
  keeps the switch contained.
- Room size or message rate grows by an order of magnitude (e.g. large audience voting).

## References

- [Durable Objects: WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/reference/websockets/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)
- [workerd discussion #6454: WebTransport support](https://github.com/cloudflare/workerd/discussions/6454)
- [Cloudflare blog: inbound TCP and gRPC for Workers and Containers](https://blog.cloudflare.com/grpc-workers/)
- [MDN: WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
