// app/routes/admin.votes.$id.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { api, BACKEND_BASE } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";

type Vote = {
  id: number;
  title: string;
  description?: string | null;
  status: "draft" | "open" | "closed" | "archived";
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
};

type VoteDetailResponse = {
  vote: Vote;
  stats: { total_votes: number };
  recent_voters: Array<{ user_id: number; full_name: string; nic: string; voted_at: string | null }>;
};

type Party = { id: number; name: string; code?: string | null; symbol_url?: string | null; is_active: boolean };

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const id = Number(params.id);
  if (!id) throw new Response("Bad Request", { status: 400 });

  // Vote detail (uses backend: GET /api/votes/:id)
  const data = (await api(request, `/api/votes/${id}`)) as VoteDetailResponse;

  // Parties are optional; try to fetch but don’t crash if 404/missing
  let parties: Party[] = [];
  try {
    const res = await fetch(`${BACKEND_BASE}/api/parties/${id}`, { headers: { accept: "application/json" } });
    if (res.ok) {
      const j = (await res.json()) as { parties?: Party[] };
      parties = j.parties || [];
    }
  } catch {
    // ignore if the endpoint isn't implemented yet
  }

  return json({ vote: data.vote, parties });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const id = Number(params.id);
  if (!id) throw new Response("Bad Request", { status: 400 });

  const form = await request.formData();
  const status = String(form.get("status") || "").toLowerCase();

  // Update status (matches backend: POST /api/votes/:id/status)
  await api(request, `/api/votes/${id}/status`, {
    method: "POST",
    headers: { "x-admin-id": String(admin.id) },
    body: JSON.stringify({ status }),
  });

  return redirect(`/admin/votes/${id}`);
}

export default function VoteDetailPage() {
  const { vote, parties } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{vote.title}</h1>
        <Link to="/admin/votes" className="underline">
          Back to list
        </Link>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        {vote.description && <div className="mb-2 text-sm text-gray-600">{vote.description}</div>}
        <div className="text-sm">
          Status: <span className="font-medium">{vote.status}</span>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
          <div>
            Start: <span className="font-medium">{vote.start_at || "-"}</span>
          </div>
          <div>
            End: <span className="font-medium">{vote.end_at || "-"}</span>
          </div>
        </div>

        <div className="mt-4">
          <Form method="post" className="flex gap-2">
            <select name="status" defaultValue={vote.status} className="rounded-md border-gray-300">
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
            </select>
            <button className="rounded-md border px-3 py-2 text-sm">Update Status</button>
          </Form>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Parties</h2>
          <Link to={`./parties`} className="underline">
            Manage Parties
          </Link>
        </div>
        {parties.length === 0 ? (
          <p className="text-sm text-gray-600">No parties (or parties API not implemented).</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {parties.map((p) => (
              <li key={p.id}>
                {p.name} {p.code ? `(${p.code})` : ""} {p.is_active ? "" : "[inactive]"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
