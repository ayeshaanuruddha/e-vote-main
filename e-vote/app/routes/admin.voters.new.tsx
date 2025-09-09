// app/routes/admin.voters.new.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { requireAdmin } from "../utils/session.server";
import { api } from "../utils/api.server";

/* ---------- Types ---------- */
type ActionData = {
  ok?: boolean;
  message?: string;
  fields?: Record<string, string>;
};

/* ---------- Loader ---------- */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return json({});
}

/* ---------- Action (no validation for testing) ---------- */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);

  const form = await request.formData();
  const fields = Object.fromEntries(form) as Record<string, string>;

  try {
    await api(request, "/api/admin/voters", {
      method: "POST",
      headers: { "x-admin-id": "1" },
      body: JSON.stringify(fields),
    });
    return redirect("/admin/voters");
  } catch (e) {
    return json<ActionData>(
      { ok: false, message: "Failed to create voter. Please try again.", fields },
      { status: 500 }
    );
  }
}

/* ---------- Page ---------- */
export default function NewVoter() {
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";
  const banner = actionData?.message;

  // Selection + Scan + Manual paste (vanilla JS). The fingerprint input is tied to the form via `form="voter-form"`.
  const inlineScript = `
(function () {
  /* ---------- PRESETS ---------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-preset-card="1"]'));
  var selectEl = document.getElementById('preset-select');
  var locIdEl = document.getElementById('location-id-input');

  var adminEl = document.getElementById('administration-input');
  var electoralEl = document.getElementById('electoral-input');
  var pollingEl = document.getElementById('polling-input');
  var gnEl = document.getElementById('gn-input');

  var summaryId = document.getElementById('summary-id');
  var summaryAdmin = document.getElementById('summary-admin');
  var summaryElectoral = document.getElementById('summary-electoral');
  var summaryPolling = document.getElementById('summary-polling');
  var summaryGn = document.getElementById('summary-gn');

  function applyPresetByData(dataset) {
    if (!dataset) return;
    var id = dataset.id || '';
    var administration = dataset.administration || '';
    var electoral = dataset.electoral || '';
    var polling = dataset.polling || '';
    var gn = dataset.gn || '';

    if (locIdEl) locIdEl.value = id;
    if (adminEl) adminEl.value = administration;
    if (electoralEl) electoralEl.value = electoral;
    if (pollingEl) pollingEl.value = polling;
    if (gnEl) gnEl.value = gn;

    if (summaryId) summaryId.textContent = id || '-';
    if (summaryAdmin) summaryAdmin.textContent = administration || '-';
    if (summaryElectoral) summaryElectoral.textContent = electoral || '-';
    if (summaryPolling) summaryPolling.textContent = polling || '-';
    if (summaryGn) summaryGn.textContent = gn || '-';

    if (selectEl && selectEl.value !== id) selectEl.value = id;

    cards.forEach(function (card) {
      if (card.dataset.id === id) {
        card.classList.add('selected-card');
      } else {
        card.classList.remove('selected-card');
      }
    });
  }

  function applyPresetById(id) {
    var card = cards.find(function(c){ return c.dataset.id === id; });
    if (card) applyPresetByData(card.dataset);
  }

  cards.forEach(function(card) {
    card.addEventListener('click', function () { applyPresetByData(card.dataset); });
  });

  if (selectEl) {
    selectEl.addEventListener('change', function () { applyPresetById(selectEl.value); });
  }

  var initialId = (locIdEl && locIdEl.value) || (selectEl && selectEl.value) || '';
  if (initialId) applyPresetById(initialId);

  /* ---------- SCAN BUTTON + MANUAL INPUT ---------- */
  var btn = document.getElementById("scan-btn");
  var statusEl = document.getElementById("scan-status");
  var msgEl = document.getElementById("scan-msg");
  var fpEl = document.getElementById("fingerprint-input"); // NOTE: has name="fingerprint" + form="voter-form"
  var clearEl = document.getElementById("fingerprint-clear");
  var bar = document.getElementById("scan-bar");
  var innerBar = document.getElementById("scan-bar-inner");

  function setStatus(t){ if(statusEl) statusEl.textContent = t; }
  function setMsg(t){ if(msgEl) msgEl.textContent = t; }
  function setBar(active){ if(bar && innerBar){ bar.style.visibility = active ? "visible" : "hidden"; innerBar.style.width = "0%"; } }

  // Manual input (e.g., typing '1') is accepted as Captured
  if (fpEl) {
    var markManual = function() {
      var v = fpEl.value.trim();
      if (v) {
        if (btn) { btn.dataset.mode = "idle"; btn.textContent = "Start Scan"; btn.classList.remove("stop"); }
        setBar(false);
        setStatus("Captured ✅");
        setMsg("Manual fingerprint set.");
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

  if (btn && statusEl && msgEl && fpEl && bar && innerBar) {
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
    }

    async function pollOnce(mySession) {
      if (Date.now() - startAt > TIMEOUT_MS) {
        setStatus("Failed ❌");
        setMsg("Timed out. Please try again.");
        stop();
        return;
      }
      var elapsed = Date.now() - startAt;
      if (innerBar) innerBar.style.width = Math.min(100, Math.round((elapsed / TIMEOUT_MS) * 100)) + "%";

      try {
        var res = await fetch(endpoint + "?t=" + Date.now(), { method: "GET", headers: { "Accept":"application/json" }, cache: "no-store" });
        if (session !== mySession) return;
        if (!res.ok) {
          setStatus("Failed ❌");
          setMsg("GET failed (" + res.status + ")");
          stop();
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

    btn.addEventListener("click", async function () {
      if (btn.dataset.mode === "scanning") {
        setStatus("Idle");
        setMsg("Scan stopped.");
        stop();
        return;
      }

      session++;
      var mySession = session;
      try { await fetch(endpoint, { method:"DELETE", headers: { "Accept":"application/json" } }); } catch (_) {}

      fpEl.value = "";
      btn.dataset.mode = "scanning";
      btn.textContent = "Stop";
      btn.classList.add("stop");
      setBar(true);
      setStatus("Scanning…");
      setMsg("Place finger on the reader…");
      startAt = Date.now();

      await pollOnce(mySession);
      timer = setInterval(function () { pollOnce(mySession); }, POLL_MS);
    });
  }
})();
  `.trim();

  return (
    <div className="max-w-6xl">
      <h1 className="mb-5 text-2xl font-semibold tracking-tight">Add Voter</h1>

      {banner && (
        <div
          className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
            actionData?.ok === false
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-green-300 bg-green-50 text-green-800"
          }`}
        >
          {banner}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* LEFT: Location Presets + Fingerprint */}
        <div className="space-y-5">
          {/* Location Presets */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Location Presets</div>
              <select
                id="preset-select"
                aria-label="Select location preset"
                defaultValue={actionData?.fields?.location_id || ""}
                className="rounded-md border-gray-300 text-sm"
              >
                <option value="">Choose…</option>
                <option value="kegalle">25 - Kegalle · 22 - Kegalle</option>
                <option value="colombo">11 - Colombo · 01 - Colombo</option>
              </select>
            </div>

            {/* Clickable cards with data-* so script can read values */}
            <div className="grid gap-3">
              <button
                type="button"
                data-preset-card="1"
                data-id="kegalle"
                data-administration="25 - Kegalle"
                data-electoral="22 - Kegalle"
                data-polling="B - Galigamuwa"
                data-gn="74 D - Panakawa - 54"
                className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 transition hover:bg-gray-50"
              >
                <div className="text-xs font-semibold text-gray-900">Administration</div>
                <div className="text-lg font-semibold text-gray-900">25 - Kegalle</div>
                <div className="mt-2 text-xs font-semibold text-gray-900">Electoral</div>
                <div className="text-lg font-semibold text-gray-900">22 - Kegalle</div>
                <div className="mt-2 text-xs font-semibold text-gray-900">Polling</div>
                <div className="text-lg font-semibold text-gray-900">B - Galigamuwa</div>
                <div className="mt-2 text-xs font-semibold text-gray-900">GN</div>
                <div className="text-lg font-semibold text-gray-900">74 D - Panakawa - 54</div>
              </button>

              <button
                type="button"
                data-preset-card="1"
                data-id="colombo"
                data-administration="11 - Colombo"
                data-electoral="01 - Colombo"
                data-polling="A - Colombo Central"
                data-gn="03 A - Fort - 12"
                className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 transition hover:bg-gray-50"
              >
                <div className="text-xs font-semibold text-gray-900">Administration</div>
                <div className="text-lg font-semibold text-gray-900">11 - Colombo</div>
                <div className="mt-2 text-xs font-semibold text-gray-900">Electoral</div>
                <div className="text-lg font-semibold text-gray-900">01 - Colombo</div>
                <div className="mt-2 text-xs font-semibold text-gray-900">Polling</div>
                <div className="text-lg font-semibold text-gray-900">A - Colombo Central</div>
                <div className="mt-2 text-xs font-semibold text-gray-900">GN</div>
                <div className="text-lg font-semibold text-gray-900">03 A - Fort - 12</div>
              </button>
            </div>

            {/* Live summary, updated by script */}
            <div className="mt-3 rounded-lg border bg-gray-50 p-3 text-xs text-gray-700">
              <div>
                Selected preset: <b id="summary-id">{actionData?.fields?.location_id || "-"}</b>
              </div>
              <div className="mt-1">
                Admin: <code id="summary-admin">{actionData?.fields?.administration || "-"}</code>
              </div>
              <div>
                Electoral: <code id="summary-electoral">{actionData?.fields?.electoral || "-"}</code>
              </div>
              <div>
                Polling: <code id="summary-polling">{actionData?.fields?.polling || "-"}</code>
              </div>
              <div>
                GN: <code id="summary-gn">{actionData?.fields?.gn || "-"}</code>
              </div>
            </div>
          </section>

          {/* Fingerprint (plain JS button + manual paste support) */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-900">Fingerprint</div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span id="scan-status" className="min-w-[90px] inline-block">Idle</span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                id="scan-btn"
                type="button"
                data-mode="idle"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Start Scan
              </button>

              {/* This input is SUBMITTED with the form via form="voter-form" */}
              <input
                id="fingerprint-input"
                name="fingerprint"
                form="voter-form"
                placeholder="or paste manual fingerprint value (e.g. 1)"
                autoComplete="off"
                className="block w-full rounded-lg border border-gray-300 text-sm"
                defaultValue={actionData?.fields?.fingerprint || ""}
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

            {/* Progress bar + message (managed by the script) */}
            <div className="mt-3">
              <div id="scan-bar" className="h-2 w-full overflow-hidden rounded-full bg-gray-100" style={{ visibility: "hidden" }}>
                <div id="scan-bar-inner" className="h-2 rounded-full bg-gray-500 transition-all" style={{ width: "0%" }} />
              </div>
              <div id="scan-msg" className="mt-2 text-xs text-gray-600" />
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Paste a value to set it immediately, or use <code className="rounded bg-gray-100 px-1 py-0.5">Start Scan</code> to pull from the scanner buffer.
            </p>
          </section>
        </div>

        {/* RIGHT: Main Form (noValidate to force post for testing) */}
        <Form id="voter-form" noValidate method="post" className="grid grid-cols-2 gap-3">
          <Field label="Full Name" name="full_name" defaultValue={actionData?.fields?.full_name} />
          <Field label="NIC" name="nic" defaultValue={actionData?.fields?.nic} />

          <Field label="DOB" name="dob" type="date" defaultValue={actionData?.fields?.dob} />
          <label className="text-sm">
            <span className="text-gray-800 font-medium">Gender</span>
            <select name="gender" defaultValue={actionData?.fields?.gender || ""} className="mt-1 w-full rounded-md border-gray-300">
              <option value=""></option>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </label>

          <Field label="Household" name="household" className="col-span-2" defaultValue={actionData?.fields?.household} />
          <Field label="Mobile" name="mobile" defaultValue={actionData?.fields?.mobile} />
          <Field label="Email" name="email" type="email" defaultValue={actionData?.fields?.email} />

          {/* Hidden location id for submit (script sets this) */}
          <input id="location-id-input" type="hidden" name="location_id" defaultValue={actionData?.fields?.location_id || ""} />

          {/* Readonly mirrors (script writes here so you SEE the selection) */}
          <Field id="administration-input" label="Administration" name="administration" readOnly defaultValue={actionData?.fields?.administration || ""} />
          <Field id="electoral-input" label="Electoral" name="electoral" readOnly defaultValue={actionData?.fields?.electoral || ""} />
          <Field id="polling-input" label="Polling" name="polling" readOnly defaultValue={actionData?.fields?.polling || ""} />
          <Field id="gn-input" label="GN" name="gn" readOnly defaultValue={actionData?.fields?.gn || ""} />

          <div className="col-span-2 mt-2 flex items-center gap-3">
            <button className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-60" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </Form>
      </div>

      {/* Attach the vanilla JS logic at the end so DOM is ready */}
      <script dangerouslySetInnerHTML={{ __html: inlineScript }} />

      <style>{`
        .selected-card { border-color: #000; background: #f9fafb; }
      `}</style>
    </div>
  );
}

/* ---------- Small components ---------- */
function Field({
  id,
  label,
  name,
  type = "text",
  readOnly,
  defaultValue,
  className = "",
}: {
  id?: string;
  label: string;
  name: string;
  type?: "text" | "email" | "date";
  readOnly?: boolean;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <label className={`text-sm ${className}`} htmlFor={id}>
      <span className="text-gray-800 font-medium">{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        readOnly={readOnly}
        defaultValue={defaultValue}
        className={`mt-1 w-full rounded-md ${readOnly ? "bg-gray-50 text-gray-700" : "border-gray-300"} border`}
      />
    </label>
  );
}
