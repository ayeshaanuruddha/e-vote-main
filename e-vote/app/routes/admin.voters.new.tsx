import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireAdmin } from "../utils/session.server";
import { api, BACKEND_BASE } from "../utils/api.server";

/* ---------- Types ---------- */
type FieldErrors = Partial<Record<
  | "full_name"
  | "nic"
  | "dob"
  | "gender"
  | "household"
  | "mobile"
  | "email"
  | "location_id"
  | "administration"
  | "electoral"
  | "polling"
  | "gn"
  | "fingerprint",
  string
>>;

type ActionData = {
  ok?: boolean;
  message?: string;
  fields?: Record<string, string>;
  errors?: FieldErrors;
};

/* ---------- Loader ---------- */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  return json({});
}

/* ---------- Validation ---------- */
function validate(fields: Record<string, string>): FieldErrors {
  const errors: FieldErrors = {};
  const req = (k: keyof FieldErrors, label: string) => {
    if (!fields[k] || !String(fields[k]).trim()) errors[k] = `${label} is required`;
  };

  req("full_name", "Full name");
  req("nic", "NIC");
  req("dob", "Date of birth");
  req("fingerprint", "Fingerprint");

  // Location must be explicitly selected (no default)
  if (!fields.location_id) errors.location_id = "Please select a location preset";
  (["administration", "electoral", "polling", "gn"] as const).forEach((k) => {
    if (!fields[k]) errors[k] = "Location preset is incomplete";
  });

  // Shapes
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = "Invalid email format";
  if (fields.mobile && !/^[0-9+()\-\s]{7,20}$/.test(fields.mobile)) errors.mobile = "Invalid mobile format";
  if (fields.dob && isNaN(Date.parse(fields.dob))) errors.dob = "Invalid date";

  return errors;
}

/* ---------- Action ---------- */
export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);

  const form = await request.formData();
  const fields = Object.fromEntries(form) as Record<string, string>;
  const errors = validate(fields);

  if (Object.keys(errors).length > 0) {
    return json<ActionData>({ ok: false, message: "Please fix the errors below.", fields, errors }, { status: 400 });
  }

  try {
    // If your backend doesn't require the header, remove x-admin-id
    await api(request, "/api/admin/voters", {
      method: "POST",
      headers: { "x-admin-id": "1" },
      body: JSON.stringify(fields),
    });
    return redirect("/admin/voters");
  } catch {
    return json<ActionData>(
      { ok: false, message: "Failed to create voter. Please try again.", fields },
      { status: 500 }
    );
  }
}

/* ---------- Location Presets (explicit selection required) ---------- */
const locationSets = [
  {
    id: "kegalle",
    administration: "25 - Kegalle",
    electoral: "22 - Kegalle",
    polling: "B - Galigamuwa",
    gn: "74 D - Panakawa - 54",
  },
  {
    id: "colombo",
    administration: "11 - Colombo",
    electoral: "01 - Colombo",
    polling: "A - Colombo Central",
    gn: "03 A - Fort - 12",
  },
] as const;

type FingerStatus = "idle" | "scanning" | "success" | "fail";

/* ---------- Page ---------- */
export default function NewVoter() {
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  // Force explicit preset selection (no default picked)
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    (actionData?.fields?.location_id as (typeof locationSets)[number]["id"]) || ""
  );
  const selectedLocation = useMemo(
    () => locationSets.find((l) => l.id === selectedLocationId),
    [selectedLocationId]
  );

  // Fingerprint scanning state
  const [fingerStatus, setFingerStatus] = useState<FingerStatus>("idle");
  const [fingerprint, setFingerprint] = useState<string>(actionData?.fields?.fingerprint || "");
  const [scanMessage, setScanMessage] = useState<string>("");
  const [elapsed, setElapsed] = useState<number>(0);

  // Polling timers
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanStartRef = useRef<number | null>(null);
  const SCAN_POLL_MS = 1200;
  const SCAN_TIMEOUT_MS = 30_000; // 30s

  useEffect(() => {
    if (fingerStatus !== "scanning") {
      stopTimers();
      return;
    }

    scanStartRef.current = Date.now();
    setElapsed(0);
    setScanMessage("Place finger on the reader…");

    const poll = async () => {
      try {
        // timeout
        if (scanStartRef.current && Date.now() - scanStartRef.current > SCAN_TIMEOUT_MS) {
          setFingerStatus("fail");
          setScanMessage("Timed out. Please try again.");
          stopTimers();
          return;
        }

        const res = await fetch(`${BACKEND_BASE}/api/fingerprint/scan`, { method: "GET" });
        if (!res.ok) throw new Error(await res.text());
        const data: { fingerprint?: string | null } = await res.json();

        if (data.fingerprint) {
          setFingerprint(String(data.fingerprint));
          setFingerStatus("success");
          setScanMessage("Fingerprint captured ✅");
          stopTimers();
        }
      } catch {
        setFingerStatus("fail");
        setScanMessage("Failed to reach scanner API.");
        stopTimers();
      }
    };

    // Start timers
    pollTimerRef.current = setInterval(poll, SCAN_POLL_MS);
    elapsedTimerRef.current = setInterval(() => {
      if (scanStartRef.current) setElapsed(Date.now() - scanStartRef.current);
    }, 200);

    // Kick immediately
    void poll();

    return stopTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerStatus]);

  function stopTimers() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    pollTimerRef.current = null;
    elapsedTimerRef.current = null;
  }

  const startScan = () => {
    setFingerprint("");
    setFingerStatus("scanning");
    setScanMessage("Initializing scan…");
  };

  const stopScan = () => {
    setFingerStatus("idle");
    setScanMessage("Scan stopped.");
    stopTimers();
  };

  // UI helpers
  const err = actionData?.errors || {};
  const banner = actionData?.message;
  const disableSave =
    isSubmitting || fingerStatus === "scanning" || !selectedLocationId || !fingerprint.trim();
  const progressPct = Math.min(100, Math.round((elapsed / SCAN_TIMEOUT_MS) * 100));

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
                aria-label="Select location preset"
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="rounded-md border-gray-300 text-sm"
              >
                <option value="">Choose…</option>
                {locationSets.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.administration} · {loc.electoral}
                  </option>
                ))}
              </select>
            </div>

            {/* Cards for quick visual selection */}
            <div className="grid gap-3">
              {locationSets.map((loc) => {
                const active = selectedLocationId === loc.id;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => setSelectedLocationId(loc.id)}
                    className={`w-full text-left rounded-xl border p-4 transition ${
                      active ? "border-black bg-gray-50" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="text-xs font-semibold text-gray-900">Administration</div>
                    <div className="text-lg font-semibold text-gray-900">{loc.administration}</div>
                    <div className="mt-2 text-xs font-semibold text-gray-900">Electoral</div>
                    <div className="text-lg font-semibold text-gray-900">{loc.electoral}</div>
                    <div className="mt-2 text-xs font-semibold text-gray-900">Polling</div>
                    <div className="text-lg font-semibold text-gray-900">{loc.polling}</div>
                    <div className="mt-2 text-xs font-semibold text-gray-900">GN</div>
                    <div className="text-lg font-semibold text-gray-900">{loc.gn}</div>
                  </button>
                );
              })}
            </div>
            {err.location_id && <p className="mt-2 text-xs text-red-600">{err.location_id}</p>}
          </section>

          {/* Fingerprint */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
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

            <div className="mt-3 flex items-center gap-3">
              {fingerStatus !== "scanning" ? (
                <button
                  type="button"
                  onClick={startScan}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
                className={`block w-full rounded-lg border ${
                  err.fingerprint ? "border-red-300" : "border-gray-300"
                } text-sm`}
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
                  <div
                    className="h-2 rounded-full bg-gray-500 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                )}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                {fingerStatus === "scanning" && <Spinner />}
                <span>{scanMessage}</span>
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
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Polls <code className="rounded bg-gray-100 px-1 py-0.5">/api/fingerprint/scan</code> on the coordinator
              until a template is received or timeout (30s).
            </p>
          </section>
        </div>

        {/* RIGHT: Main Form */}
        <Form method="post" className="grid grid-cols-2 gap-3">
          <Field label="Full Name" name="full_name" error={err.full_name} required defaultValue={actionData?.fields?.full_name} />
          <Field label="NIC" name="nic" error={err.nic} required defaultValue={actionData?.fields?.nic} />

          <Field label="DOB" name="dob" type="date" error={err.dob} required defaultValue={actionData?.fields?.dob} />
          <label className="text-sm">
            <span className="text-gray-800 font-medium">Gender</span>
            <select name="gender" defaultValue={actionData?.fields?.gender || ""} className="mt-1 w-full rounded-md border-gray-300">
              <option value=""></option>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
            {err.gender && <span className="mt-1 block text-xs text-red-600">{err.gender}</span>}
          </label>

          <Field label="Household" name="household" defaultValue={actionData?.fields?.household} className="col-span-2" />
          <Field label="Mobile" name="mobile" error={err.mobile} defaultValue={actionData?.fields?.mobile} />
          <Field label="Email" name="email" type="email" error={err.email} defaultValue={actionData?.fields?.email} />

          {/* Preset mirrors (submitted to backend) */}
          <input type="hidden" name="location_id" value={selectedLocation?.id || ""} />
          <Field label="Administration" name="administration" readOnly defaultValue={selectedLocation?.administration || ""} error={err.administration} />
          <Field label="Electoral" name="electoral" readOnly defaultValue={selectedLocation?.electoral || ""} error={err.electoral} />
          <Field label="Polling" name="polling" readOnly defaultValue={selectedLocation?.polling || ""} error={err.polling} />
          <Field label="GN" name="gn" readOnly defaultValue={selectedLocation?.gn || ""} error={err.gn} />

          {/* Hidden mirror for fingerprint to guarantee submit even if left input is cleared */}
          <input type="hidden" name="fingerprint" value={fingerprint} />

          <div className="col-span-2 mt-2 flex items-center gap-3">
            <button
              className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={disableSave}
              title={
                fingerStatus === "scanning"
                  ? "Finish or stop scanning first"
                  : !selectedLocationId
                  ? "Select a location preset"
                  : !fingerprint
                  ? "Fingerprint is required"
                  : undefined
              }
            >
              {isSubmitting ? "Saving…" : "Save"}
            </button>
            {!selectedLocationId && (
              <span className="text-xs text-red-600">Select a location preset to enable saving.</span>
            )}
          </div>
        </Form>
      </div>
    </div>
  );
}

/* ---------- Small components ---------- */
function Field({
  label,
  name,
  type = "text",
  required,
  readOnly,
  defaultValue,
  error,
  className = "",
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "date";
  required?: boolean;
  readOnly?: boolean;
  defaultValue?: string;
  error?: string;
  className?: string;
}) {
  return (
    <label className={`text-sm ${className}`}>
      <span className="text-gray-800 font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        readOnly={readOnly}
        defaultValue={defaultValue}
        className={`mt-1 w-full rounded-md ${error ? "border-red-300" : "border-gray-300"} ${readOnly ? "bg-gray-50 text-gray-700" : ""}`}
      />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

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
    status === "success" ? "bg-green-500" :
    status === "fail" ? "bg-red-500" :
    status === "scanning" ? "bg-amber-500" :
    "bg-gray-400";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />;
}
