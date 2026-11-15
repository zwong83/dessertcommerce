export async function authRequest<T = unknown>(path: string, payload: object, options: {
  method?: "POST" | "PUT";
  csrfToken?: string;
} = {}): Promise<T> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.csrfToken) headers.set("X-CSRF-Token", options.csrfToken);
  const response = await fetch("/api/v1/" + path, {
    method: options.method ?? "POST", headers, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? "The service is temporarily unavailable. Try again.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function authPost<T = unknown>(path: string, payload: object): Promise<T> {
  return authRequest<T>(path, payload);
}
