// Central API Configuration
// Supports:
// 1. localStorage override ("backendDomain")
// 2. Vite environment variable: import.meta.env.VITE_BACKEND_DOMAIN or VITE_API_URL
// 3. Fallback to same host (local dev via Vite proxy)

const envDomain = ((import.meta.env.VITE_BACKEND_DOMAIN || import.meta.env.VITE_API_URL || "") + "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/^wss?:\/\//, "")
  .replace(/\/$/, "");

export let BACKEND_DOMAIN = localStorage.getItem("backendDomain") || envDomain || "";

export function setBackendDomain(domain) {
  const cleanDomain = (domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^wss?:\/\//, "")
    .replace(/\/$/, "");
  BACKEND_DOMAIN = cleanDomain;
  if (cleanDomain) {
    localStorage.setItem("backendDomain", cleanDomain);
  } else {
    localStorage.removeItem("backendDomain");
  }
}

export function getWsUrl(path) {
  const normalizedPath = (path || "").startsWith('/') ? path : `/${path || ''}`;
  if (BACKEND_DOMAIN) {
    // Direct connection to the remote tunnel / server (works on Vercel and local)
    return `wss://${BACKEND_DOMAIN}${normalizedPath}`;
  }
  // Fallback: same host (local Vite dev proxy or same-origin deployment)
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${normalizedPath}`;
}

export function getHttpUrl(path) {
  const normalizedPath = (path || "").startsWith('/') ? path : `/${path || ''}`;
  if (BACKEND_DOMAIN) {
    return `https://${BACKEND_DOMAIN}${normalizedPath}`;
  }
  return normalizedPath;
}

