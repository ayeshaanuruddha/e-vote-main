import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { api } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";

interface VoteSummary { id: number; title: string; status: "draft"|"open"|"closed"|"archived"; start_at?: string|null; end_at?: string|null }
interface VotesResponse { votes: VoteSummary[] }

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const votes = await api(request, "/api/votes") as VotesResponse;
  return json({ votes });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const payload = Object.fromEntries(form);
  await api(request, "/api/vote/create", { method: "POST", body: JSON.stringify(payload) });
  return redirect("/admin/votes");
}

export default function VotesList() {
  const { votes } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Votes</h1></div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-medium mb-3">Create Vote</h2>
        <Form method="post" className="grid grid-cols-2 gap-3">
          <label className="text-sm col-span-2">Title<input name="title" required className="mt-1 w-full rounded-md border-gray-300"/></label>
          <label className="text-sm col-span-2">Description<textarea name="description" className="mt-1 w-full rounded-md border-gray-300"/></label>
          <label className="text-sm">Start<input name="start_at" type="datetime-local" className="mt-1 w-full rounded-md border-gray-300"/></label>
          <label className="text-sm">End<input name="end_at" type="datetime-local" className="mt-1 w-full rounded-md border-gray-300"/></label>
          <input type="hidden" name="status" value="draft" />
          <div className="col-span-2"><button className="rounded-md bg-black px-4 py-2 text-sm text-white">Create</button></div>
        </Form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="px-3 py-2 text-left">Title</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Start</th>
            <th className="px-3 py-2 text-left">End</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {votes.votes.map((v)=> (
              <tr key={v.id}>
                <td className="px-3 py-2">{v.title}</td>
                <td className="px-3 py-2">{v.status}</td>
                <td className="px-3 py-2">{v.start_at||'-'}</td>
                <td className="px-3 py-2">{v.end_at||'-'}</td>
                <td className="px-3 py-2"><Link className="underline" to={`/admin/votes/${v.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}