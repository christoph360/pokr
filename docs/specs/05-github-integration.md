# F05: GitHub integration

- Status: Draft
- Depends on: F02, F04
- Owners: backend-dev (GitHub API client, import/write-back), frontend-dev (connect, import, and write-back UI), devops-engineer (GitHub app registration, secrets, token encryption key)
- Requires ADR: GitHub App vs OAuth App; tracker token encryption

## Goal

A signed-in facilitator imports GitHub issues into the room's story list and, after estimating,
writes the final estimates back. They confirm each write.

## Shared tracker behavior (also applies to F06)

- **T-AC1** Story source "Issue tracker" requires the facilitator to be signed in with at least
  one connected tracker. Otherwise the option explains what's needed and links to the account
  page.
- **T-AC2** Imported stories join the same story list as manual stories (F02). Manual stories can
  still be added, but can't be written back.
- **T-AC3** Only the importing facilitator's tracker connection is used. Other participants see
  the imported title, description, and link, but never the token, and don't need tracker access.
  The import dialog states that "imported content becomes visible to everyone in this room".
- **T-AC4** Re-importing an issue already in the list updates its title, description and link,
  and keeps its estimate and votes.
- **T-AC5** If the facilitator role moves to someone else, imported stories stay. Write-back is
  only possible for someone with their own connection that has access to those issues.
- **T-AC6** Write-back is only offered for numeric decks in v1.
- **T-AC7** Write-back is always an explicit action: "Save to tracker" per story, or "Save all
  estimated". It's never automatic. A summary lists each story with old value → new value before
  confirming.
- **T-AC8** If the tracker's current value differs from the value seen at import, the summary
  flags it as changed in the tracker, and that story is unchecked by default.
- **T-AC9** Write-back results are shown per story (saved / failed with reason). Failed stories
  can be retried.
- **T-AC10** Tracker API errors (expired token, missing permission, rate limit) show actionable
  messages, such as "Reconnect GitHub" or "You don't have write access to org/repo".

## GitHub specifics

### Connect
- **F05-AC1** On the account page, the user connects GitHub, granting access to the repositories
  and projects they choose. Users who signed in with GitHub still connect explicitly; sign-in
  alone grants no repository access.
- **F05-AC2** The user can disconnect GitHub, which revokes and deletes the stored token.

### Import
- **F05-AC3** Import sources:
  - **Repository + filter**: choose a repository, then filter by open/closed, labels,
    milestone, and assignee.
  - **GitHub Project**: choose a project, then a view or iteration.
  - **Issue URLs**: paste one or more issue URLs.
- **F05-AC4** The import dialog shows a preview list with checkboxes (max 100 per import).
  Imported stories store repo, issue number, URL, title, and body.
- **F05-AC5** Pull requests are excluded from repository imports.

### Write-back
- **F05-AC6** At import, the facilitator chooses the write-back target:
  - **Project number field**: choose a project and a number field such as "Estimate". If the
    issue isn't in that project, it is added.
  - **Label**: applies `estimate: <value>` and removes any other `estimate: *` label. Missing
    labels are created.
  - **None**: import only.
- **F05-AC7** The value seen at import, used for the change check in T-AC8, is the current number
  field value or `estimate:` label.

## Out of scope for F05

GitHub Enterprise Server, writing comments to issues, syncing changes from GitHub to an open
room in real time.
