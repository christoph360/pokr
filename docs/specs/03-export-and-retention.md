# F03: Export and retention

- Status: Draft
- Depends on: F02
- Owners: backend-dev (expiry, export), frontend-dev (UI), devops-engineer (alarms/cron config if needed)

## Goal

Rooms are ephemeral: they are deleted after a period of inactivity. Before that, results can be
taken away as a file or pasted into another tool.

## Acceptance criteria

### Retention
- **F03-AC1** A room expires 7 days after its last activity. Activity means any participant
  message or join.
- **F03-AC2** On expiry, all room data (settings, participants, stories, votes) is permanently
  deleted. Expiry is implemented with a Durable Object alarm, not a scan over all rooms.
- **F03-AC3** The room shows when it will expire ("This room will be deleted on 19 Oct if
  unused"). The banner becomes prominent in the last 24 hours.
- **F03-AC4** The facilitator can delete a room immediately (with confirmation). Connected
  participants see "this room was deleted".
- **F03-AC5** After expiry or deletion, the room link shows the "room not found" page (F01-AC6).

### Export
- **F03-AC6** Any participant can export the room results:
  - **CSV**: one row per story. Columns: order, title, link, tracker key, status, final
    estimate, then one column per participant with their vote in the accepted round.
  - **Markdown**: a table with title, link, and final estimate, plus the total for numeric
    decks.
  - **Copy to clipboard**: the Markdown version.
- **F03-AC7** In "free topic" mode, export contains one row per revealed round (topic, votes,
  average) for the room's lifetime.
- **F03-AC8** Export is generated server-side from room state, so it is identical for every
  participant. Exported files are named `pokr-<room-name>-<yyyy-mm-dd>.<ext>`.
- **F03-AC9** CSV is RFC 4180 compliant, UTF-8 with BOM (so Excel opens it correctly), and
  neutralizes formula injection (cells starting with `=`, `+`, `-`, `@` are prefixed with `'`).

## Out of scope for F03

Configurable retention period, scheduled exports, PDF export.
