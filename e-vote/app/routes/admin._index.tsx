import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireAdmin } from "../utils/session.server";
import { api } from "../utils/api.server";
import { Card, CardHeader, Stat } from "../components/Card";
import { PageHeader } from "../components/Header";

interface VoteSummary { id: number; title: string; status: "draft"|"open"|"closed"|"archived"; }
interface VotesResponse { votes: VoteSummary[] }

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const votes = await api(request, "/api/votes") as VotesResponse;
  return json({ votes });
}

export default function AdminHome() {
  const { votes } = useLoaderData<typeof loader>();
  const open = votes.votes.filter(v => v.status === "open").length;
  const total = votes.votes.length;
  const closed = votes.votes.filter(v => v.status === "closed").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Admin Dashboard" actions={<>
        <Link to="/admin/votes" className="text-sm underline">Manage Votes</Link>
        <Link to="/admin/voters" className="text-sm underline">Manage Voters</Link>
      </>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Open Votes" value={open} />
        <Stat label="Closed Votes" value={closed} />
        <Stat label="Total Votes" value={total} />
      </div>

      <Card>
        <CardHeader title="Recent Votes" />
        <ul className="list-disc pl-5 text-sm">
          {votes.votes.slice(0,5).map(v => (
            <li key={v.id}><Link className="underline" to={`/admin/votes/${v.id}`}>{v.title}</Link> <span className="text-gray-500">({v.status})</span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}