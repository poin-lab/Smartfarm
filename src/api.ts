const sessionTokenKey = "green-link-session-token";

export const setSessionToken = (token: string) => {
  try {
    sessionStorage.setItem(sessionTokenKey, token);
  } catch {
    // Cookie auth remains available when storage is blocked.
  }
};

export const clearSessionToken = () => {
  try {
    sessionStorage.removeItem(sessionTokenKey);
  } catch {
    // Ignore storage failures; the server-side session is cleared separately.
  }
};

const sessionToken = () => {
  try {
    return sessionStorage.getItem(sessionTokenKey) || "";
  } catch {
    return "";
  }
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const token = sessionToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(!["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "X-Green-Link-Request": "1" }
        : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && !path.startsWith("/auth/")) {
    clearSessionToken();
    window.dispatchEvent(new Event("green-link-auth-expired"));
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.message || "요청을 처리하지 못했습니다.");
  return body;
}
