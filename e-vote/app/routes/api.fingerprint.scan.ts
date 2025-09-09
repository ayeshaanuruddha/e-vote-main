// app/routes/api.fingerprint.scan.ts
import { json } from "@remix-run/node";

/**
 * Same-origin proxy for the browser to poll fingerprint value.
 * Forwards to FastAPI: {BACKEND_BASE}/api/fingerprint/scan
 * Set BACKEND_BASE in server env (defaults to http://localhost:8000).
 */
export async function loader() {
  const BACKEND_BASE = process.env.BACKEND_BASE ?? "http://localhost:8000";

  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/fingerprint/scan`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const text = await upstream.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return json(data, { status: upstream.status });
  } catch {
    // Surface as 502 so UI can show "Failed to reach scanner"
    return json({ error: "Upstream unreachable" }, { status: 502 });
  }
}
