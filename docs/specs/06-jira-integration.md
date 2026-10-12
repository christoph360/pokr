# F06: Jira Cloud integration

- Status: Draft
- Depends on: F02, F04; reuses the shared tracker behavior (T-AC1 to T-AC10) from [F05](05-github-integration.md#shared-tracker-behavior-also-applies-to-f06)
- Owners: backend-dev, frontend-dev, devops-engineer (Atlassian app registration, secrets)

## Goal

Same flow as GitHub: import Jira issues, estimate, and write story points back after confirmation.

## Acceptance criteria

### Connect
- **F06-AC1** On the account page, the user connects Jira Cloud via Atlassian OAuth 2.0 (3LO)
  and picks one or more sites they have access to. Tokens are refreshed automatically.
- **F06-AC2** The user can disconnect Jira, which deletes the stored tokens.

### Import
- **F06-AC3** Import sources:
  - **Board**: choose a site and board, then backlog or a sprint (active/future).
  - **JQL**: enter a JQL query. Errors from Jira are shown inline.
  - **Issue keys**: paste keys, e.g. `PROJ-12, PROJ-15`.
- **F06-AC4** The preview list has checkboxes (max 100 per import). Imported stories store site,
  issue key, URL, summary, and description. Jira's rich-text description format (ADF) is
  converted to Markdown.
- **F06-AC5** Sub-tasks are excluded by default; a checkbox includes them.

### Write-back
- **F06-AC6** The estimate field is detected per project: "Story point estimate" for team-managed
  projects, the "Story Points" custom field for company-managed projects. If detection fails or is
  ambiguous, the facilitator picks the field from the numeric fields on the issue's edit screen.
- **F06-AC7** If the field isn't on the issue's edit screen, write-back for that story fails with
  "Story points field isn't available for this issue type in Jira. Ask your Jira admin to add it."

## Out of scope for F06

Jira Data Center/Server, writing comments, multiple estimate fields, time tracking estimates.
