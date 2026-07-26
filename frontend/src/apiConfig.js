// Central API Configuration
// When connecting to your cloud backend (e.g. Google Colab GPU via Ngrok),
// set BACKEND_DOMAIN to your Ngrok or Hugging Face URL without http/https (e.g. "sixfold-hyphen-remote.ngrok-free.dev").
// If set to "", it defaults to your local computer / Vite proxy.

export const BACKEND_DOMAIN = "sixfold-hyphen-remote.ngrok-free.dev";

export function getWsUrl(path) {
  if (BACKEND_DOMAIN) {
    const separator = path.includes('?') ? '&' : '?';
    return `wss://${BACKEND_DOMAIN}${path}${separator}ngrok-skip-browser-warning=69420`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function getHttpUrl(path) {
  if (BACKEND_DOMAIN) {
    const separator = path.includes('?') ? '&' : '?';
    return `https://${BACKEND_DOMAIN}${path}${separator}ngrok-skip-browser-warning=69420`;
  }
  return path;
}
