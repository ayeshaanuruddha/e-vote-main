import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { api } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";
import { PageHeader } from "../components/Header";
import { Table } from "../components/Table";

interface VoterListItem { id: number; full_name: string; nic: string; email?: string|null; mobile?: string|null; fingerprint?: string|null; created_at?: string; }
interface VoterListResponse { items: VoterListItem[]; limit?: number; offset?: number }

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await api(request, `/api/admin/voters${qs}`, { headers: { "x-admin-id": "1" } }) as VoterListResponse;
  return json({ items: res.items, q: q || "" });
}

export default function VotersList() {
  const { items, q } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <PageHeader title="Voters" actions={<Link to="/admin/voters/new" className="rounded-xl bg-black px-3 py-2 text-sm text-white">Add Voter</Link>} />
      <Form method="get" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, NIC, email, mobile" className="w-full rounded-xl border-gray-300"/>
        <button className="rounded-xl border px-3 py-2 text-sm">Search</button>
      </Form>
      <Table>
        <thead className="bg-gray-50"><tr>
          <th className="px-3 py-2 text-left">Name</th>
          <th className="px-3 py-2 text-left">NIC</th>
          <th className="px-3 py-2 text-left">Email</th>
          <th className="px-3 py-2 text-left">Mobile</th>
          <th className="px-3 py-2 text-left">Actions</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(u => (
            <tr key={u.id}>
              <td className="px-3 py-2">{u.full_name}</td>
              <td className="px-3 py-2">{u.nic}</td>
              <td className="px-3 py-2">{u.email||'-'}</td>
              <td className="px-3 py-2">{u.mobile||'-'}</td>
              <td className="px-3 py-2"><Link to={`/admin/voters/${u.id}/edit`} className="underline">Edit</Link></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}