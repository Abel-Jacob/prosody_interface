// Central API Configuration
// Paste your Colab tunnel URL (e.g. "abc-123.trycloudflare.com") into the
// "Tunnel URL" input on the site, or set it here. If blank, defaults to
// the current host (local dev via Vite proxy).

export let BACKEND_DOMAIN = localStorage.getItem("backendDomain") || "";

export function setBackendDomain(domain) {
  const cleanDomain = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^wss?:\/\//, "")
    .replace(/\/$/, "");
  BACKEND_DOMAIN = cleanDomain;
  localStorage.setItem("backendDomain", cleanDomain);
}

export function getWsUrl(path) {
  if (BACKEND_DOMAIN) {
    // Direct connection to the remote tunnel (works on both Vercel and local)
    return `wss://${BACKEND_DOMAIN}${path}`;
  }
  // Fallback: same host (local Vite dev proxy or same-origin deployment)
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function getHttpUrl(path) {
  if (BACKEND_DOMAIN) {
    return `https://${BACKEND_DOMAIN}${path}`;
  }
  return path;
}
