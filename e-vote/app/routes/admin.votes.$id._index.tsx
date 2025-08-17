import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { api } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";

interface VoteDetail { id: number; title: string; description?: string|null; status: "draft"|"open"|"closed"|"archived"; start_at?: string|null; end_at?: string|null; created_at?: string }
interface Party { id: number; name: string; code?: string|null; symbol_url?: string|null; is_active: boolean }

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const vote = await api(request, `/api/vote/${params.id}`) as { vote: VoteDetail };
  const parties = await api(request, `/api/parties/${params.id}`) as { parties: Party[] };
  return json({ vote: vote.vote, parties: parties.parties });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const status = String(form.get("status"));
  await api(request, `/api/vote/${params.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  return redirect(`/admin/votes/${params.id}`);
}

export default function VoteDetailPage() {
  const { vote, parties } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{vote.title}</h1>
        <Link to={`./parties`} className="underline">Manage Parties</Link>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-2 text-sm text-gray-600">{vote.description}</div>
        <div className="text-sm">Status: <span className="font-medium">{vote.status}</span></div>
        <div className="mt-3">
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
        <h2 className="mb-3 font-medium">Parties</h2>
        <ul className="list-disc pl-5 text-sm">
          {parties.map((p)=> <li key={p.id}>{p.name} {p.code?`(${p.code})`:''} {p.is_active?"":"[inactive]"}</li>)}
        </ul>
      </div>
    </div>
  );
}