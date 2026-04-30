# Work Log

### 2026-04-29 - LAB-001: Bootstrap stored XSS lab repository
- **Status**: Completed
- **Description**: Created the Docker Compose lab, project memory, application scaffolding, vulnerable and mitigated modes, and end-to-end verification flow from the specification document.
- **URL**: N/A
- **Notes**: Verified public isolation, worker access to the internal backend, stored XSS JWT theft from `localStorage`, HTML exfiltration, and mitigation behavior with `LAB_MODE=mitigated`.

### 2026-04-29 - LAB-002: Migrate internal auth to explicit JWT discovery flow
- **Status**: Completed
- **Description**: Replaced session-cookie auth in the internal backend with explicit JWT auth so the lab can demonstrate token theft first and explicit replay against `/admin` and `/admin/messages` afterwards.
- **URL**: N/A
- **Notes**: Validated that the worker steals a JWT-accessible browser context, `fetch('/')` returns the login page without forced credential suppression, and protected routes still work when the token is replayed explicitly.
