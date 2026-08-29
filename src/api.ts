export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(!["GET", "HEAD", "OPTIONS"].includes(method)
        ? { "X-Green-Link-Request": "1" }
        : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && !path.startsWith("/auth/"))
    window.dispatchEvent(new Event("green-link-auth-expired"));
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.message || "요청을 처리하지 못했습니다.");
  return body;
}
