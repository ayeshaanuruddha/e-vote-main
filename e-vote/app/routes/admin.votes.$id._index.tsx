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

type Party = {
  id: number;
  name: string;
  code?: string | null;
  symbol_url?: string | null;
  is_active: boolean;
};

type PartyResult = {
  party_id: number;
  name: string;
  code?: string | null;
  symbol_url?: string | null;
  votes: number;
};

type VoteResultsResponse = {
  vote: Vote;
  results: PartyResult[];
  total_votes: number;
  updated_at?: string | null;
};

type VoteDetailResponse = {
  vote: Vote;
  stats: { total_votes: number };
  recent_voters: Array<{ user_id: number; full_name: string; nic: string; voted_at: string | null }>;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const id = Number(params.id);
  if (!id) throw new Response("Bad Request", { status: 400 });

  // Preferred: dedicated results endpoint
  try {
    const res = await fetch(`${BACKEND_BASE}/api/votes/${id}/results`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const j = (await res.json()) as VoteResultsResponse;
      return json({
        vote: j.vote,
        results: j.results,
        total_votes: j.total_votes,
        updated_at: j.updated_at ?? null,
      });
    }
  } catch {
    // fall through to fallback
  }

  // Fallback if /results is not available yet:
  const detail = (await api(request, `/api/votes/${id}`)) as VoteDetailResponse;

  let parties: Party[] = [];
  try {
    // Optional parties endpoint used elsewhere in your app
    const res = await fetch(`${BACKEND_BASE}/api/parties/${id}`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const j = (await res.json()) as { parties?: Party[] };
      parties = j.parties || [];
    }
  } catch {
    // ignore
  }

  const results: PartyResult[] = (parties || []).map((p) => ({
    party_id: p.id,
    name: p.name,
    code: p.code,
    symbol_url: p.symbol_url || null,
    votes: 0,
  }));

  return json({
    vote: detail.vote,
    results,
    total_votes: detail.stats?.total_votes ?? 0,
    updated_at: null as string | null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);
  const id = Number(params.id);
  if (!id) throw new Response("Bad Request", { status: 400 });

  const form = await request.formData();
  const status = String(form.get("status") || "").toLowerCase();

  await api(request, `/api/votes/${id}/status`, {
    method: "POST",
    headers: { "x-admin-id": String(admin.id) },
    body: JSON.stringify({ status }),
  });

  return redirect(`/admin/votes/${id}`);
}

export default function VoteDetailPage() {
  const { vote, results, total_votes, updated_at } = useLoaderData<typeof loader>();

  // sort by most votes
  const sorted = [...results].sort((a, b) => b.votes - a.votes);
  const total = Math.max(0, Number(total_votes) || 0);

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
          <Form method="post" className="flex flex-wrap items-center gap-2">
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
          <h2 className="font-medium">Results</h2>
          <div className="text-xs text-gray-500">
            {updated_at ? <>Updated: <time dateTime={updated_at}>{updated_at}</time></> : "Live data"}
          </div>
        </div>

        {sorted.length === 0 ? (
          <p className="text-sm text-gray-600">No parties found.</p>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              Total votes: <span className="font-semibold">{total.toLocaleString()}</span>
            </div>

            <ul className="space-y-3">
              {sorted.map((r) => {
                const pct = total > 0 ? Math.round((r.votes / total) * 1000) / 10 : 0; // 0.1% precision
                return (
                  <li key={r.party_id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center gap-3">
                      {r.symbol_url ? (
                        <img
                          src={r.symbol_url}
                          alt={`${r.name} symbol`}
                          className="h-8 w-8 rounded border object-contain"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded border bg-gray-50" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <div className="truncate">
                            <span className="font-medium">{r.name}</span>
                            {r.code ? <span className="text-sm text-gray-500"> ({r.code})</span> : null}
                          </div>
                          <div className="text-sm tabular-nums">
                            <span className="font-medium">{r.votes.toLocaleString()}</span> votes • {pct}%
                          </div>
                        </div>
                        {/* bar */}
                        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-100" aria-hidden>
                          <div
                            className="h-2 rounded bg-gray-800 transition-all"
                            style={{ width: `${pct}%` }}
                            title={`${pct}%`}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Parties</h2>
          <Link to={`./parties`} className="underline">
            Manage Parties
          </Link>
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-600">No parties (or parties API not implemented).</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {sorted.map((p) => (
              <li key={p.party_id}>
                {p.name} {p.code ? `(${p.code})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

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
