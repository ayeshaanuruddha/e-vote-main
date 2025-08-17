import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useSearchParams } from "@remix-run/react";
import { api } from "../utils/api.server";

interface Party {
  id: number;
  name: string;
  code?: string | null;
  symbol_url?: string | null; // Add symbol/logo URL from API
}
interface VoteDetail {
  id: number;
  title: string;
  description?: string | null;
}
interface VotePublicResponse {
  vote: VoteDetail;
  parties: Party[];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const res = (await api(
    request,
    `/api/vote/${params.id}/public`
  )) as VotePublicResponse;
  return json(res);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form = await request.formData();
  const party_id = Number(form.get("party_id"));
  const fingerprint = String(form.get("fingerprint") || "").trim();
  await api(request, "/api/vote/cast_mpc", {
    method: "POST",
    body: JSON.stringify({
      fingerprint,
      vote_id: Number(params.id),
      party_id,
    }),
  });
  return redirect(`/vote/${params.id}?success=1`);
}

export default function VotePublicPage() {
  const data = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{data.vote.title}</h1>
      <p className="text-sm text-gray-600">{data.vote.description}</p>

      {sp.get("success") && (
        <div className="rounded-md bg-green-50 p-3 text-green-700">
          ✅ Vote recorded successfully.
        </div>
      )}

      <Form method="post" className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.parties.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 rounded-lg border p-3 hover:border-blue-400 transition cursor-pointer"
            >
              <input type="radio" name="party_id" value={p.id} required />
              {p.symbol_url && (
                <img
                  src={p.symbol_url}
                  alt={`${p.name} symbol`}
                  className="w-10 h-10 object-contain border rounded-md"
                />
              )}
              <div>
                <span className="block font-medium">{p.name}</span>
                {p.code && (
                  <span className="text-sm text-gray-500">({p.code})</span>
                )}
              </div>
            </label>
          ))}
        </div>

        <label className="block text-sm font-medium">
          Fingerprint
          <input
            name="fingerprint"
            required
            placeholder="Scan value"
            className="mt-1 w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
          />
        </label>

        <button className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800">
          Cast Vote
        </button>
      </Form>
    </div>
  );
}
