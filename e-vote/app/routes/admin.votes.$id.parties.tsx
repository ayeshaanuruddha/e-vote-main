import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useId, useMemo, useState } from "react";
import { api } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";

/* ---------------- Types ---------------- */
interface VoteDetail { id: number; title: string }
interface Party { id: number; name: string; code?: string|null; symbol_url?: string|null; is_active: boolean }
type ActionIntent = "create" | "update" | "toggle" | "delete";

type ActionData = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Partial<Record<"name"|"code"|"symbol_url", string>>;
};

/* ---------------- Loader ---------------- */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const vote = await api(request, `/api/vote/${params.id}`) as { vote: VoteDetail };
  const parties = await api(request, `/api/parties/${params.id}`) as { parties: Party[] };
  return json({ vote: vote.vote, parties: parties.parties });
}

/* ---------------- Validation ---------------- */
function validateCreateOrUpdate(payload: { name?: string; code?: string; symbol_url?: string }) {
  const errors: ActionData["fieldErrors"] = {};
  if (!payload.name || !payload.name.trim()) errors.name = "Name is required";
  if (payload.code && payload.code.length > 12) errors.code = "Code is too long (max 12)";
  if (payload.symbol_url && !/^https?:\/\/.+/i.test(payload.symbol_url)) errors.symbol_url = "Must be a valid URL (http/https)";
  return errors;
}

/* ---------------- Action ---------------- */
export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "") as ActionIntent;

  try {
    if (intent === "create") {
      const payload = {
        vote_id: Number(params.id),
        name: String(form.get("name") || ""),
        code: String(form.get("code") || ""),
        symbol_url: String(form.get("symbol_url") || ""),
        is_active: !!form.get("is_active"),
      };
      const fieldErrors = validateCreateOrUpdate(payload);
      if (fieldErrors && Object.keys(fieldErrors).length) {
        return json<ActionData>({ ok: false, message: "Please fix the errors below.", fieldErrors }, { status: 400 });
      }
      await api(request, "/api/party/create", { method: "POST", body: JSON.stringify(payload) });
      return redirect(`/admin/votes/${params.id}/parties`);
    }

    if (intent === "update") {
      const party_id = Number(form.get("party_id"));
      const payload = {
        name: String(form.get("name") || ""),
        code: String(form.get("code") || ""),
        symbol_url: String(form.get("symbol_url") || ""),
        is_active: String(form.get("is_active")) === "1",
      };
      const fieldErrors = validateCreateOrUpdate(payload);
      if (fieldErrors && Object.keys(fieldErrors).length) {
        return json<ActionData>({ ok: false, message: "Please fix the errors below.", fieldErrors }, { status: 400 });
      }
      await api(request, `/api/party/${party_id}`, { method: "PUT", body: JSON.stringify(payload) });
      return redirect(`/admin/votes/${params.id}/parties`);
    }

    if (intent === "toggle") {
      const party_id = Number(form.get("party_id"));
      const is_active = String(form.get("is_active")) === "1";
      await api(request, `/api/party/${party_id}`, { method: "PUT", body: JSON.stringify({ is_active: !is_active }) });
      return redirect(`/admin/votes/${params.id}/parties`);
    }

    if (intent === "delete") {
      const party_id = Number(form.get("party_id"));
      await api(request, `/api/party/${party_id}`, { method: "DELETE" });
      return redirect(`/admin/votes/${params.id}/parties`);
    }

    return json<ActionData>({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (e) {
    return json<ActionData>({ ok: false, message: "Request failed. Please try again." }, { status: 500 });
  }
}

/* ---------------- Page ---------------- */
export default function PartiesPage() {
  const { vote, parties } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Parties for: {vote.title}</h1>

      {actionData?.message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionData.ok === false ? "border-red-300 bg-red-50 text-red-700" : "border-green-300 bg-green-50 text-green-800"
          }`}
        >
          {actionData.message}
        </div>
      )}

      <CreatePartyCard isSubmitting={isSubmitting} fieldErrors={actionData?.fieldErrors} />

      <PartiesTable parties={parties} isSubmitting={isSubmitting} />
    </div>
  );
}

/* ---------------- Create Card ---------------- */
function CreatePartyCard({
  isSubmitting,
  fieldErrors,
}: {
  isSubmitting: boolean;
  fieldErrors?: ActionData["fieldErrors"];
}) {
  const nameId = useId();
  const codeId = useId();
  const urlId = useId();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 font-medium">Add Party</h2>
      <Form method="post" className="grid grid-cols-2 gap-3">
        <input type="hidden" name="intent" value="create" />
        <label htmlFor={nameId} className="text-sm col-span-2">
          Name
          <input id={nameId} name="name" required className={`mt-1 w-full rounded-md ${fieldErrors?.name ? "border-red-300" : "border-gray-300"}`} />
          {fieldErrors?.name && <span className="mt-1 block text-xs text-red-600">{fieldErrors.name}</span>}
        </label>
        <label htmlFor={codeId} className="text-sm">
          Code
          <input id={codeId} name="code" className={`mt-1 w-full rounded-md ${fieldErrors?.code ? "border-red-300" : "border-gray-300"}`} />
          {fieldErrors?.code && <span className="mt-1 block text-xs text-red-600">{fieldErrors.code}</span>}
        </label>
        <label htmlFor={urlId} className="text-sm">
          Symbol URL
          <input id={urlId} name="symbol_url" placeholder="https://…" className={`mt-1 w-full rounded-md ${fieldErrors?.symbol_url ? "border-red-300" : "border-gray-300"}`} />
          {fieldErrors?.symbol_url && <span className="mt-1 block text-xs text-red-600">{fieldErrors.symbol_url}</span>}
        </label>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" name="is_active" defaultChecked /> Active
        </label>
        <div className="col-span-2">
          <button className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-60" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create"}
          </button>
        </div>
      </Form>
    </div>
  );
}

/* ---------------- Parties Table (with inline edit) ---------------- */
function PartiesTable({ parties, isSubmitting }: { parties: Party[]; isSubmitting: boolean }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = useMemo(() => parties.find((p) => p.id === editingId) || null, [editingId, parties]);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left">Symbol</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Active</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {parties.map((p) => (
            <Row
              key={p.id}
              party={p}
              isEditing={editingId === p.id}
              onEdit={() => setEditingId(p.id)}
              onCancel={() => setEditingId(null)}
              isSubmitting={isSubmitting}
            />
          ))}
        </tbody>
      </table>

      {/* Inline edit panel */}
      {editing && (
        <div className="border-t border-gray-200 p-4">
          <InlineEdit party={editing} onDone={() => setEditingId(null)} isSubmitting={isSubmitting} />
        </div>
      )}
    </div>
  );
}

function Row({
  party,
  isEditing,
  onEdit,
  onCancel,
  isSubmitting,
}: {
  party: Party;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  return (
    <tr>
      <td className="px-3 py-2">
        {party.symbol_url ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img src={party.symbol_url} alt={`${party.name} symbol`} className="h-8 w-8 rounded object-cover" />
        ) : (
          <div className="h-8 w-8 rounded bg-gray-100" />
        )}
      </td>
      <td className="px-3 py-2">{party.name}</td>
      <td className="px-3 py-2">{party.code || "-"}</td>
      <td className="px-3 py-2">{party.is_active ? "Yes" : "No"}</td>
      <td className="px-3 py-2">
        {!isEditing ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-md border px-3 py-1"
              onClick={onEdit}
              disabled={isSubmitting}
            >
              Edit
            </button>
            <Form method="post" className="inline">
              <input type="hidden" name="intent" value="toggle" />
              <input type="hidden" name="party_id" value={party.id} />
              <input type="hidden" name="is_active" value={party.is_active ? "1" : "0"} />
              <button className="rounded-md border px-3 py-1" disabled={isSubmitting}>
                {party.is_active ? "Deactivate" : "Activate"}
              </button>
            </Form>
            <Form
              method="post"
              className="inline"
              onSubmit={(e) => {
                if (!confirm("Delete party?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="party_id" value={party.id} />
              <button className="rounded-md bg-red-600 px-3 py-1 text-white" disabled={isSubmitting}>
                Delete
              </button>
            </Form>
          </div>
        ) : (
          <button className="rounded-md border px-3 py-1" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
        )}
      </td>
    </tr>
  );
}

/* ---------------- Inline Edit Form ---------------- */
function InlineEdit({ party, onDone, isSubmitting }: { party: Party; onDone: () => void; isSubmitting: boolean }) {
  const [name, setName] = useState(party.name);
  const [code, setCode] = useState(party.code || "");
  const [symbolUrl, setSymbolUrl] = useState(party.symbol_url || "");
  const [active, setActive] = useState(party.is_active);
  const [error, setError] = useState<string>("");

  const nameId = useId();
  const codeId = useId();
  const urlId = useId();

  function clientValidate(): boolean {
    setError("");
    if (!name.trim()) { setError("Name is required"); return false; }
    if (code && code.length > 12) { setError("Code is too long (max 12)"); return false; }
    if (symbolUrl && !/^https?:\/\/.+/i.test(symbolUrl)) { setError("Symbol URL must start with http/https"); return false; }
    return true;
  }

  return (
    <Form
      method="post"
      onSubmit={(e) => {
        if (!clientValidate()) e.preventDefault();
      }}
      className="grid grid-cols-2 gap-3"
    >
      <input type="hidden" name="intent" value="update" />
      <input type="hidden" name="party_id" value={party.id} />

      <label htmlFor={nameId} className="text-sm">
        Name
        <input id={nameId} name="name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-md border-gray-300" />
      </label>

      <label htmlFor={codeId} className="text-sm">
        Code
        <input id={codeId} name="code" value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded-md border-gray-300" />
      </label>

      <label htmlFor={urlId} className="text-sm col-span-2">
        Symbol URL
        <input id={urlId} name="symbol_url" value={symbolUrl} onChange={(e) => setSymbolUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded-md border-gray-300" />
      </label>

      <label className="text-sm flex items-center gap-2">
        <input type="checkbox" name="is_active" value={active ? "1" : "0"} checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>

      <div className="col-span-2 flex items-center gap-2">
        <button className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-60" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save Changes"}
        </button>
        <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={onDone} disabled={isSubmitting}>
          Close
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
        {/* Preview */}
        {symbolUrl && /^https?:\/\//i.test(symbolUrl) && (
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-gray-600">
            Preview:
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img src={symbolUrl} alt="Symbol preview" className="h-8 w-8 rounded object-cover" />
          </span>
        )}
      </div>
    </Form>
  );
}
