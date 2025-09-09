// app/routes/vote.$id.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

/* ---------- Types ---------- */
interface Party {
  id: number;
  name: string;
  code?: string | null;
  symbol_url?: string | null;
}
interface VoteDetail {
  id: number;
  title: string;
  description?: string | null;
}
interface VotePublicResponse {
  vote: VoteDetail;
  parties: Party[];
}
type FingerStatus = "idle" | "scanning" | "success" | "fail";

/* ---------- Loader (server) ---------- */
export async function loader({ params }: LoaderFunctionArgs) {
  const BASE = process.env.BACKEND_BASE ?? "http://localhost:8000";
  const res = await fetch(`${BASE}/api/vote/${params.id}/public`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Response(await res.text(), { status: res.status });
  }
  const data = (await res.json()) as VotePublicResponse;
  return json(data);
}

/* ---------- Action (server) ---------- */
export async function action({ request, params }: ActionFunctionArgs) {
  const form = await request.formData();
  const party_id = Number(form.get("party_id"));
  const fingerprint = String(form.get("fingerprint") || "").trim();

  // Rely on browser `required`, but still sanity-check
  if (!party_id || !fingerprint) {
    return json({ ok: false, message: "Party and fingerprint are required" }, { status: 400 });
  }

  const BASE = process.env.BACKEND_BASE ?? "http://localhost:8000";
  const post = await fetch(`${BASE}/api/vote/cast_mpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fingerprint, vote_id: Number(params.id), party_id }),
  });

  if (!post.ok) {
    const txt = await post.text().catch(() => "");
    throw new Response(txt || "Failed to cast vote", { status: post.status });
  }

  return redirect(`/vote/${params.id}?success=1`);
}

/* ---------- Page (client) ---------- */
export default function VotePublicPage() {
  const data = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const nav = useNavigation();

  // Hydration debug (proves client JS is active)
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // selection + fingerprint state
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null);
  const [fingerprint, setFingerprint] = useState("");

  // scanning state
  const [fingerStatus, setFingerStatus] = useState<FingerStatus>("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // timers + abort
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanStartRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // config
  const SCAN_POLL_MS = 1000;
  const SCAN_TIMEOUT_MS = 30_000;

  // derived
  const progressPct = Math.min(100, Math.round((elapsed / SCAN_TIMEOUT_MS) * 100));
  const remainingSec = Math.ceil(Math.max(0, SCAN_TIMEOUT_MS - elapsed) / 1000);
  const isSubmitting = nav.state === "submitting";

  // Only disable while submitting or actively scanning; use native `required` for validation.
  const disableSubmit = isSubmitting || fingerStatus === "scanning";

  // scan lifecycle
  useEffect(() => {
    if (fingerStatus !== "scanning") {
      cleanupScan();
      return;
    }

    scanStartRef.current = Date.now();
    setElapsed(0);
    setScanMessage("Place finger on the reader…");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Same-origin proxy route — see app/routes/api.fingerprint.scan.ts
    const scanUrl = `/api/fingerprint/scan`;

    const poll = async () => {
      try {
        // timeout
        if (scanStartRef.current && Date.now() - scanStartRef.current > SCAN_TIMEOUT_MS) {
          setFingerStatus("fail");
          setScanMessage("Timed out. Please try again.");
          cleanupScan();
          return;
        }

        const res = await fetch(scanUrl, {
          method: "GET",
          signal: abortRef.current?.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          // allow more polls instead of failing immediately
          console.warn("[scan] non-OK response", res.status);
          return;
        }

        const j: { fingerprint?: string | null } = await res.json();
        if (j.fingerprint) {
          setFingerprint(String(j.fingerprint));
          setFingerStatus("success");
          setScanMessage("Fingerprint captured ✅");
          cleanupScan();
        }
      } catch (err) {
        if (abortRef.current?.signal.aborted) return; // user stopped
        console.error("[scan] fetch error:", err);
        setFingerStatus("fail");
        setScanMessage("Failed to reach scanner API.");
        cleanupScan();
      }
    };

    // timers
    pollTimerRef.current = setInterval(poll, SCAN_POLL_MS);
    elapsedTimerRef.current = setInterval(() => {
      if (scanStartRef.current) setElapsed(Date.now() - scanStartRef.current);
    }, 150);

    // immediate first poll
    void poll();

    return cleanupScan;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerStatus]);

  function cleanupScan() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    pollTimerRef.current = null;
    elapsedTimerRef.current = null;
    abortRef.current?.abort();
  }

  const startScan = () => {
    // flip immediately so you SEE the UI change even if first poll fails
    setFingerprint("");
    setFingerStatus("scanning");
    setScanMessage("Initializing scan…");
  };

  const stopScan = () => {
    setFingerStatus("idle");
    setScanMessage("Scan stopped.");
    cleanupScan();
  };

  return (
    <div className="space-y-6">
      {/* Top submit progress */}
      {isSubmitting && (
        <div className="h-0.5 w-full overflow-hidden rounded bg-gray-200">
          <div className="h-0.5 w-1/2 animate-[progress_1.2s_ease_infinite] bg-gray-700" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{data.vote.title}</h1>
        {/* hydration debug pill */}
        <span
          className={`text-[10px] rounded px-1.5 py-0.5 ${
            hydrated ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}
          title={hydrated ? "Client JS active" : "Waiting for hydration"}
        >
          {hydrated ? "client:ON" : "client:OFF"}
        </span>
      </div>
      {data.vote.description && <p className="text-sm text-gray-600">{data.vote.description}</p>}

      {sp.get("success") && (
        <div className="rounded-md bg-green-50 p-3 text-green-700" role="status" aria-live="polite">
          ✅ Vote recorded successfully.
        </div>
      )}

      {/* One single form so radios + fingerprint are actually submitted */}
      <Form method="post" className="space-y-5" replace>
        {/* Parties */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Choose a Party</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.parties.map((p) => {
              const checked = selectedPartyId === p.id;
              return (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    checked ? "border-black bg-gray-50" : "hover:border-blue-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="party_id"
                    value={p.id}
                    checked={checked}
                    onChange={(e) => setSelectedPartyId(Number(e.currentTarget.value))}
                    required
                  />
                  {p.symbol_url && (
                    <img
                      src={p.symbol_url}
                      alt={`${p.name} symbol`}
                      className="h-10 w-10 rounded-md border object-contain"
                    />
                  )}
                  <div>
                    <span className="block font-medium">{p.name}</span>
                    {p.code && <span className="text-sm text-gray-500">({p.code})</span>}
                  </div>
                </label>
              );
            })}
            {data.parties.length === 0 && (
              <div className="col-span-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                No parties available for this vote.
              </div>
            )}
          </div>
        </div>

        {/* Fingerprint capture block */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900">Fingerprint</div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <StatusDot status={fingerStatus} />
              <span className="min-w-[90px]">
                {fingerStatus === "idle" && "Idle"}
                {fingerStatus === "scanning" && "Scanning…"}
                {fingerStatus === "success" && "Captured ✅"}
                {fingerStatus === "fail" && "Failed ❌"}
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-3">
            {fingerStatus !== "scanning" ? (
              <button
                type="button"
                onClick={startScan}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                disabled={isSubmitting}
              >
                Start Scan
              </button>
            ) : (
              <button
                type="button"
                onClick={stopScan}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
              >
                Stop
              </button>
            )}

            <input
              name="fingerprint"
              value={fingerprint}
              onChange={(e) => setFingerprint(e.target.value)}
              placeholder="or paste manual fingerprint value"
              className="block w-full rounded-lg border border-gray-300 text-sm"
              aria-label="Fingerprint"
              required
            />
          </div>

          {/* Progress + message */}
          <div className="mt-3">
            <div
              className={`h-2 w-full overflow-hidden rounded-full ${
                fingerStatus === "scanning" ? "bg-gray-100" : "bg-transparent"
              }`}
              aria-hidden
            >
              {fingerStatus === "scanning" && (
                <div className="h-2 rounded-full bg-gray-700 transition-all" style={{ width: `${progressPct}%` }} />
              )}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-600" aria-live="polite">
              {fingerStatus === "scanning" && <Spinner />}
              <span>
                {scanMessage}
                {fingerStatus === "scanning" && remainingSec > 0 ? ` (${remainingSec}s left)` : ""}
              </span>
              {fingerStatus === "fail" && (
                <button
                  type="button"
                  onClick={startScan}
                  className="ml-2 rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                >
                  Retry
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Polls <code className="rounded bg-gray-100 px-1 py-0.5">/api/fingerprint/scan</code> every ~1s for up to 30s.
            </p>
          </div>
        </div>

        {/* Submit section */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
            disabled={disableSubmit}
            aria-disabled={disableSubmit}
          >
            {isSubmitting ? "Submitting…" : "Cast Vote"}
          </button>
        </div>
      </Form>

      {/* Local CSS keyframes for the top progress bar */}
      <style>
        {`
          @keyframes progress {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
          }
          .animate-[progress_1.2s_ease_infinite] {
            animation: progress 1.2s ease-in-out infinite;
          }
        `}
      </style>
    </div>
  );
}

/* ---------- Small UI bits ---------- */
function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-700"
    />
  );
}

function StatusDot({ status }: { status: FingerStatus }) {
  const color =
    status === "success"
      ? "bg-green-500"
      : status === "fail"
      ? "bg-red-500"
      : status === "scanning"
      ? "bg-amber-500"
      : "bg-gray-400";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />;
}
