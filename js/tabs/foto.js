/**
 * tabs/foto.js -- deliberately NOT a real tab, just a launcher for the
 * existing google-apps-script/Upload.gs deployment. See that file and
 * this repo's README for why photo upload stays on GAS (Drive write
 * access needs an authorized server context a static site can't provide
 * without exposing a real credential client-side).
 */

const FotoTab = (function () {
  const STORAGE_KEY = 'chaotic_storage_foto_url_v1';
  const openBtn = document.getElementById('fotoOpenBtn');
  const urlInput = document.getElementById('fotoUrlInput');
  const saveBtn = document.getElementById('fotoSaveUrlBtn');

  function loadUrl() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  openBtn.addEventListener('click', function () {
    const url = loadUrl();
    if (!url) {
      alert('Todavía no has guardado la URL de tu despliegue de Upload.gs -- pégala abajo y presiona Guardar.');
      return;
    }
    window.open(url, '_blank');
  });

  saveBtn.addEventListener('click', function () {
    const url = urlInput.value.trim();
    if (!url) return;
    localStorage.setItem(STORAGE_KEY, url);
    alert('Guardado.');
  });

  return {
    show: function () {
      urlInput.value = loadUrl();
    },
    hide: function () {},
  };
})();
