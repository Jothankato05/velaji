const TOKEN_KEY = 'ncihap.token';
const USER_KEY = 'ncihap.user';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: 'verifier' | 'staff' | 'admin';
}

/**
 * The session lives in localStorage, not sessionStorage, so that it survives the
 * app being closed and reopened. That is what makes the offline shell useful
 * rather than merely openable: sessionStorage dies with the tab, so a health
 * worker who shut the app and reopened it with no signal met a login screen they
 * could not get past, because /api/auth/login needs the network.
 *
 * Persisting a bearer token is a real trade, and it is bounded two ways. The
 * server issues a 12h shift-length token (src/utils/token.ts) and refuses it
 * after that, so a stolen copy has a short life. And readToken() below enforces
 * the same expiry locally, which is the half that only matters offline: with no
 * server to answer 401 there is nothing to bounce off, and without this check
 * the app would render a signed-in UI backed by a token that is already dead.
 *
 * Facility devices are shared, so this is deliberately a shift, not a login that
 * lasts forever. Anyone handing a device on should still sign out.
 */

/** Decode the `exp` from our own token: base64url(JSON payload) + "." + HMAC. */
function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[0];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

function readToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const exp = tokenExpiry(token);
  // No decodable expiry means we cannot vouch for it, so treat it as unusable.
  if (exp === null || exp < Math.floor(Date.now() / 1000)) {
    clearSession();
    return null;
  }
  return token;
}

/**
 * One-time move of anything left in sessionStorage by an earlier build, so the
 * change does not sign out whoever happens to have the app open when it ships.
 */
function migrateLegacySession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const user = sessionStorage.getItem(USER_KEY);
  if (token && user && !localStorage.getItem(TOKEN_KEY)) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, user);
  }
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
migrateLegacySession();

export function getToken(): string | null {
  return readToken();
}
export function getStoredUser(): AuthUser | null {
  // Gate the user on the token, so an expired session cannot present as signed
  // in while offline.
  if (!readToken()) return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    clearSession();
    return null;
  }
}
export function storeSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The server was unreachable: no response at all, as opposed to a response that
 * said no. Distinguishing the two is what lets the UI tell someone their signal
 * is gone rather than implying they typed their password wrong.
 */
export class OfflineError extends Error {
  constructor(message = 'Cannot reach the server.') {
    super(message);
    this.name = 'OfflineError';
  }
}

/**
 * fetch() rejects with a TypeError for DNS failure, connection refused, and a
 * dead radio alike, and never for an HTTP error status. So a rejection here is
 * always a transport failure, which is exactly what OfflineError means.
 */
async function fetchOrOffline(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new OfflineError();
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetchOrOffline(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401 && token) {
    // Token expired or invalid — drop the session and bounce to login.
    clearSession();
    onUnauthorized?.();
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message = (data as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

async function getText(path: string): Promise<string> {
  const token = getToken();
  const res = await fetchOrOffline(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401 && token) {
    clearSession();
    onUnauthorized?.();
  }
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return res.text();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  getText
};
