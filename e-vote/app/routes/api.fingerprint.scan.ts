// app/routes/api.fingerprint.scan.ts
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

/**
 * IMPORTANT:
 * If you prefer .env, set BACKEND_BASE=http://192.168.9.88:8000
 * This file defaults to your IP so it "just works" even without .env.
 */
const BACKEND_BASE =
  process.env.BACKEND_BASE?.replace(/\/+$/, "") ?? "http://localhost:8000";
const UPSTREAM = `${BACKEND_BASE}/api/fingerprint/scan`;

// GET /api/fingerprint/scan -> forwards to FastAPI GET /api/fingerprint/scan
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const qs = url.search ? `?${url.searchParams.toString()}` : "";
  const r = await fetch(`${UPSTREAM}${qs}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: {
      "content-type": r.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}

// DELETE /api/fingerprint/scan -> forwards to FastAPI DELETE /api/fingerprint/scan
// (We also allow POST/PATCH/PUT pass-through just in case.)
export async function action({ request }: ActionFunctionArgs) {
  const method = request.method.toUpperCase();

  const init: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
    },
    cache: "no-store",
  };

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    init.body = await request.text();
  }

  const r = await fetch(UPSTREAM, init);
  const body = await r.text();

  return new Response(body, {
    status: r.status,
    headers: {
      "content-type": r.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}
