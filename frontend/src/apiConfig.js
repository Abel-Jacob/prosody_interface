// Central API Configuration
// Supports:
// 1. localStorage override ("backendDomain")
// 2. Vite environment variable: import.meta.env.VITE_BACKEND_DOMAIN or VITE_API_URL
// 3. Fallback to same host (local dev via Vite proxy)

function safeGetStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota or security errors
  }
}

const envDomain = ((import.meta.env.VITE_BACKEND_DOMAIN || import.meta.env.VITE_API_URL || "") + "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/^wss?:\/\//, "")
  .split('/')[0];

export let BACKEND_DOMAIN = safeGetStorage("backendDomain") || envDomain || "";

export function setBackendDomain(domain) {
  const cleanDomain = (domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^wss?:\/\//, "")
    .split('/')[0];
  BACKEND_DOMAIN = cleanDomain;
  safeSetStorage("backendDomain", cleanDomain);
}

export function getWsUrl(path) {
  const normalizedPath = (path || "").startsWith('/') ? path : `/${path || ''}`;
  if (BACKEND_DOMAIN) {
    const isLocal = /^localhost(:\d+)?$/i.test(BACKEND_DOMAIN) || /^127\.0\.0\.1(:\d+)?$/.test(BACKEND_DOMAIN);
    const proto = isLocal ? 'ws:' : 'wss:';
    return `${proto}//${BACKEND_DOMAIN}${normalizedPath}`;
  }
  // Fallback: same host (local Vite dev proxy or same-origin deployment)
  const protocol = (typeof window !== 'undefined' && window.location?.protocol === "https:") ? "wss:" : "ws:";
  const host = (typeof window !== 'undefined' && window.location?.host) ? window.location.host : 'localhost:8000';
  return `${protocol}//${host}${normalizedPath}`;
}

export function getHttpUrl(path) {
  const normalizedPath = (path || "").startsWith('/') ? path : `/${path || ''}`;
  if (BACKEND_DOMAIN) {
    const isLocal = /^localhost(:\d+)?$/i.test(BACKEND_DOMAIN) || /^127\.0\.0\.1(:\d+)?$/.test(BACKEND_DOMAIN);
    const proto = isLocal ? 'http:' : 'https:';
    return `${proto}//${BACKEND_DOMAIN}${normalizedPath}`;
  }
  return normalizedPath;
}


