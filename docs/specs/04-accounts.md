# F04: Accounts

- Status: Draft
- Depends on: F01
- Owners: backend-dev (auth, sessions, account storage), frontend-dev (sign-in UI), devops-engineer (OAuth app registration per environment, secrets, D1/KV bindings)
- Requires ADR: account and session storage, session mechanism

## Goal

Optional sign-in with GitHub or Google. Everything in F01–F03 keeps working without an account.
An account adds a stable identity across devices, a "my rooms" list, and is the prerequisite
for tracker integrations.

## Acceptance criteria

### Sign-in
- **F04-AC1** The header shows "Sign in". The sign-in page offers "Continue with GitHub" and
  "Continue with Google".
- **F04-AC2** Sign-in uses the OAuth 2.0 authorization code flow with PKCE and a `state`
  parameter. On first sign-in, an account is created with provider, provider user ID, display
  name, avatar URL, and email.
- **F04-AC3** One account per provider identity. Signing in with GitHub and with Google using
  the same email creates two separate accounts in v1. No automatic linking by email.
- **F04-AC4** Sessions use an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Session lifetime is
  30 days, sliding. State-changing HTTP endpoints are protected against CSRF.
- **F04-AC5** Signing out ends the session server-side and clears the cookie.

### Identity in rooms
- **F04-AC6** Signed-in users join rooms with their account name and avatar. They can override
  the display name per room.
- **F04-AC7** When a guest signs in while in a room, their participant in that room is upgraded
  to the account. Votes and the facilitator role are kept.
- **F04-AC8** A signed-in user who opens a room on another device rejoins as the same
  participant (same vote, same role).

### My rooms
- **F04-AC9** Signed-in users see "My rooms": rooms they created or joined that haven't expired,
  with name, their role, last activity, and expiry date. Expired rooms disappear from the list.
- **F04-AC10** A user can remove a room from their list without affecting the room.

### Account management
- **F04-AC11** The account page shows the profile data and connected trackers (F05, F06).
- **F04-AC12** Deleting the account removes the account, sessions, tracker connections and
  tokens, and the "my rooms" list. In active rooms, the user's participants become guests.

## Out of scope for F04

Email/password, magic links, linking multiple providers to one account, teams/organizations.
