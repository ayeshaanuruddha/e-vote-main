import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { api } from "../utils/api.server";

interface VoteSummary { id: number; title: string; status: "draft"|"open"|"closed"|"archived" }
interface VotesResponse { votes: VoteSummary[] }

export async function loader({ request }: LoaderFunctionArgs) {
  const res = await api(request, "/api/votes") as VotesResponse;
  const open = res.votes.filter((v)=> v.status === 'open');
  return json({ votes: open });
}

export default function VotesPublicList() {
  const { votes } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Open Votes</h1>
      <ul className="list-disc pl-5 text-sm">
        {votes.map((v)=> (
          <li key={v.id}><Link className="underline" to={`/vote/${v.id}`}>{v.title}</Link></li>
        ))}
      </ul>
    </div>
  );
}