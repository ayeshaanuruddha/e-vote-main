export const BACKEND_BASE = process.env.BACKEND_BASE || "http://localhost:8000"; // coordinator URL

export async function api(request: Request, path: string, init?: RequestInit) {
  const url = `${BACKEND_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Response(text || res.statusText, { status: res.status });
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}