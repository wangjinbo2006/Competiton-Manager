export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: "POST",
    credentials: "include"
  };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPostText<T>(path: string, body: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "text/csv; charset=utf-8" },
    body,
    credentials: "include"
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: "PATCH",
    credentials: "include"
  };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "include"
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
