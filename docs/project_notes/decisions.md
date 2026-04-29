# Architectural Decisions

### ADR-001: Use Docker-internal host segregation instead of host firewall rules (2026-04-29)

**Context:**
- The lab must show that `backend.cross.fit` is reachable from internal Docker services but not from the attacker machine.
- The environment should remain reproducible on a single Docker host.

**Decision:**
- Publish only `public-proxy` on port `80`.
- Keep `internal-proxy`, `internal-app`, and `db` unexposed.
- Resolve `backend.cross.fit` only through a Docker network alias on `internal-proxy`.

**Alternatives Considered:**
- Publish the backend on another host port and rely on host firewall rules -> Rejected: less portable and weaker didactic isolation.
- Run both apps in a single process with path-based routing -> Rejected: blurs the trust boundary the lab is meant to explain.

**Consequences:**
- ✅ The trust boundary is visible in Compose and Nginx configuration.
- ✅ The attacker can reach `cross.fit` without reaching `backend.cross.fit`.
- ❌ The lab depends on correct `/etc/hosts` configuration for `cross.fit`.

### ADR-002: Use a lab mode switch to derive mitigations from one control point (2026-04-29)

**Context:**
- The exercise needs to start vulnerable by default and later switch to a mitigated state without editing multiple files manually.
- The mitigation must remain easy to explain during class.

**Decision:**
- Introduce `LAB_MODE=vulnerable|mitigated` as the primary switch.
- Allow explicit overrides for `COOKIE_HTTPONLY`, `ENABLE_CSP`, and `RENDER_UNSAFE_HTML` if a lesson needs partial controls.

**Alternatives Considered:**
- Keep separate vulnerable and fixed branches -> Rejected: adds coordination overhead during live demos.
- Require manual edits in templates and config files -> Rejected: too error-prone for a classroom flow.

**Consequences:**
- ✅ One variable can flip the internal app between modes.
- ✅ Individual defenses can still be demonstrated separately.
- ❌ Internal app logic becomes slightly more complex than the pure pseudocode in the plan.

