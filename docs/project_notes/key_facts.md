# Key Facts

Only non-sensitive operational facts belong here.

### Local Domains

- Public app domain: `cross.fit`
- Internal app domain: `backend.cross.fit`
- Public entrypoint: `http://cross.fit`
- Internal admin URL inside Docker: `http://backend.cross.fit`

### Local Development Ports

- Public reverse proxy: `80`
- Public app container port: `3000`
- Internal app container port: `3001`
- PostgreSQL container port: `5432` inside Docker only
- Collector listener on attacker machine: `9000`

### Docker Services

- `public-proxy`
- `internal-proxy`
- `public-app`
- `internal-app`
- `worker`
- `db`

### Lab Operation

- Default lab mode: `vulnerable`
- Runtime overrides live in `.env`
- Admin credentials are documented in the README and seeded through `db/init.sql`
- Same-host validation can reach the host collector from Docker via `172.28.0.1:9000`
