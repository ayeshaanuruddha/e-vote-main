// app/routes/vote.$id.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";

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

  // minimal guard; let the backend decide the rest
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
  const isSubmitting = nav.state === "submitting";

  // Vanilla JS to drive scanning + manual entry (no React onClick required)
  const inlineScript = `
  (function(){
    var btn = document.getElementById("scan-btn");
    var submitBtn = document.getElementById("submit-btn");
    var statusEl = document.getElementById("scan-status");
    var msgEl = document.getElementById("scan-msg");
    var fpEl = document.getElementById("fingerprint-input");
    var clearEl = document.getElementById("fingerprint-clear");
    var bar = document.getElementById("scan-bar");
    var innerBar = document.getElementById("scan-bar-inner");

    function setStatus(t){ if(statusEl) statusEl.textContent = t; }
    function setMsg(t){ if(msgEl) msgEl.textContent = t; }
    function setBar(active){ if(bar && innerBar){ bar.style.visibility = active ? "visible" : "hidden"; innerBar.style.width = "0%"; } }
    function setSubmitDisabled(disabled){ if(submitBtn){ submitBtn.disabled = !!disabled; submitBtn.setAttribute('aria-disabled', disabled ? 'true':'false'); } }

    // Manual input: treat any non-empty value as "Captured"
    if (fpEl) {
      var markManual = function(){
        var v = fpEl.value.trim();
        if (v) {
          if (btn) { btn.dataset.mode = "idle"; btn.textContent = "Start Scan"; btn.classList.remove("stop"); }
          setBar(false);
          setStatus("Captured ✅");
          setMsg("Manual fingerprint set.");
          setSubmitDisabled(false);
        } else {
          setStatus("Idle");
          setMsg("");
        }
      };
      fpEl.addEventListener("input", markManual);
      fpEl.addEventListener("paste", function(){ setTimeout(markManual, 0); });
    }

    if (clearEl && fpEl) {
      clearEl.addEventListener("click", function(){
        fpEl.value = "";
        setStatus("Idle");
        setMsg("Cleared.");
      });
    }

    if (btn && fpEl && statusEl && msgEl && bar && innerBar) {
      var endpoint = "/api/fingerprint/scan";
      var POLL_MS = 1000;
      var TIMEOUT_MS = 30000;
      var timer = null;
      var startAt = 0;
      var session = 0;

      function stop() {
        session++;
        if (timer) clearInterval(timer);
        timer = null;
        btn.dataset.mode = "idle";
        btn.textContent = "Start Scan";
        btn.classList.remove("stop");
        setBar(false);
        setSubmitDisabled(false);
      }

      async function pollOnce(mySession) {
        if (Date.now() - startAt > TIMEOUT_MS) {
          setStatus("Failed ❌");
          setMsg("Timed out. Please try again.");
          stop();
          return;
        }
        var elapsed = Date.now() - startAt;
        innerBar.style.width = Math.min(100, Math.round((elapsed / TIMEOUT_MS) * 100)) + "%";

        try {
          var res = await fetch(endpoint + "?t=" + Date.now(), {
            method: "GET",
            headers: { "Accept":"application/json" },
            cache: "no-store"
          });
          if (session !== mySession) return;
          if (!res.ok) {
            // keep polling; backend may not have a scan yet
            return;
          }
          var j = await res.json();
          if (j && j.fingerprint) {
            fpEl.value = String(j.fingerprint);
            setStatus("Captured ✅");
            setMsg("Fingerprint captured.");
            stop();
          }
        } catch (e) {
          if (session !== mySession) return;
          setStatus("Failed ❌");
          setMsg("Network error.");
          stop();
        }
      }

      btn.addEventListener("click", async function(){
        if (btn.dataset.mode === "scanning") {
          setStatus("Idle");
          setMsg("Scan stopped.");
          stop();
          return;
        }

        session++;
        var mySession = session;
        try { await fetch(endpoint, { method: "DELETE", headers: { "Accept":"application/json" } }); } catch(_){}

        fpEl.value = "";
        btn.dataset.mode = "scanning";
        btn.textContent = "Stop";
        btn.classList.add("stop");
        setBar(true);
        setStatus("Scanning…");
        setMsg("Place finger on the reader…");
        setSubmitDisabled(true);
        startAt = Date.now();

        await pollOnce(mySession);
        timer = setInterval(function(){ pollOnce(mySession); }, POLL_MS);
      });
    }
  })();
  `.trim();

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
      </div>
      {data.vote.description && <p className="text-sm text-gray-600">{data.vote.description}</p>}

      {sp.get("success") && (
        <div className="rounded-md bg-green-50 p-3 text-green-700" role="status" aria-live="polite">
          ✅ Vote recorded successfully.
        </div>
      )}

      {/* One form so radios + fingerprint submit together */}
      <Form method="post" className="space-y-5" replace>
        {/* Parties (uncontrolled radios so they work even without hydration) */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Choose a Party</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.parties.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition hover:border-blue-400"
              >
                <input type="radio" name="party_id" value={p.id} required />
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
            ))}
            {data.parties.length === 0 && (
              <div className="col-span-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                No parties available for this vote.
              </div>
            )}
          </div>
        </div>

        {/* Fingerprint (plain JS button + manual paste support) */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900">Fingerprint</div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span id="scan-status" className="min-w-[90px] inline-block">Idle</span>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <button
              id="scan-btn"
              type="button"
              data-mode="idle"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Start Scan
            </button>

            <input
              id="fingerprint-input"
              name="fingerprint"
              placeholder="or paste manual fingerprint value (e.g. 1)"
              autoComplete="off"
              className="block w-full rounded-lg border border-gray-300 text-sm"
              required
            />

            <button
              id="fingerprint-clear"
              type="button"
              className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
              title="Clear"
            >
              Clear
            </button>
          </div>

          {/* Progress + message (managed by the script) */}
          <div className="mt-3">
            <div id="scan-bar" className="h-2 w-full overflow-hidden rounded-full bg-gray-100" style={{ visibility: "hidden" }}>
              <div id="scan-bar-inner" className="h-2 rounded-full bg-gray-700 transition-all" style={{ width: "0%" }} />
            </div>
            <div id="scan-msg" className="mt-2 text-xs text-gray-600" />
            <p className="mt-2 text-xs text-gray-500">
              Polls <code className="rounded bg-gray-100 px-1 py-0.5">/api/fingerprint/scan</code> every ~1s for up to 30s.
            </p>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            id="submit-btn"
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {isSubmitting ? "Submitting…" : "Cast Vote"}
          </button>
        </div>
      </Form>

      {/* Attach the vanilla JS at the end so the DOM is ready */}
      <script dangerouslySetInnerHTML={{ __html: inlineScript }} />

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
          #scan-btn.stop { background: #111827; }
          #scan-btn:hover { filter: brightness(0.95); }
        `}
      </style>
    </div>
  );
}
