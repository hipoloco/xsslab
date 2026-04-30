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

### 2026-04-30 - LAB-003: Split documentation into bilingual guides
- **Status**: Completed
- **Description**: Reframed the repository as a general stored XSS lab, rewrote the README into separate Spanish and English blocks, and split the walkthrough into dedicated English and Spanish documents.
- **URL**: N/A
- **Notes**: Added a short guide index file, normalized language consistency in the English walkthrough, and kept helper payload names aligned with the current JWT-based lab flow.
