// app/routes/admin.votes._index.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { api } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";

interface VoteSummary {
  id: number;
  title: string;
  status: "draft" | "open" | "closed" | "archived";
  start_at?: string | null;
  end_at?: string | null;
}
interface VotesResponse {
  votes: VoteSummary[];
}

type ActionData = {
  ok: boolean;
  message?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const votes = (await api(request, "/api/votes")) as VotesResponse;
  return json({ votes });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdmin(request);

  const form = await request.formData();
  const payload = Object.fromEntries(form) as Record<string, string>;

  // Normalize empty datetime fields
  if (payload.start_at === "") payload.start_at = null as unknown as string;
  if (payload.end_at === "") payload.end_at = null as unknown as string;

  try {
    await api(request, "/api/vote/create", {
      method: "POST",
      headers: { "x-admin-id": String(admin.id) },
      body: JSON.stringify(payload),
    });
    return redirect("/admin/votes");
  } catch (err: unknown) {
    let message = "Failed to create vote. Please try again.";
    if (err instanceof Error && typeof err.message === "string") {
      message = err.message;
    } else if (typeof err === "string") {
      message = err;
    }
    return json<ActionData>({ ok: false, message }, { status: 400 });
  }
}

export default function VotesList() {
  const { votes } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Votes</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Create Vote</h2>

        {actionData?.ok === false && (
          <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionData.message}
          </div>
        )}

        <Form method="post" className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm">
            Title
            <input
              name="title"
              required
              className="mt-1 w-full rounded-md border-gray-300"
              disabled={busy}
            />
          </label>

          <label className="col-span-2 text-sm">
            Description
            <textarea
              name="description"
              className="mt-1 w-full rounded-md border-gray-300"
              disabled={busy}
            />
          </label>

          <label className="text-sm">
            Start
            <input
              name="start_at"
              type="datetime-local"
              className="mt-1 w-full rounded-md border-gray-300"
              disabled={busy}
            />
          </label>

          <label className="text-sm">
            End
            <input
              name="end_at"
              type="datetime-local"
              className="mt-1 w-full rounded-md border-gray-300"
              disabled={busy}
            />
          </label>

          <input type="hidden" name="status" value="draft" />

          <div className="col-span-2">
            <button
              className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={busy}
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </Form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-left">End</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {votes.votes.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2">{v.title}</td>
                <td className="px-3 py-2">{v.status}</td>
                <td className="px-3 py-2">{v.start_at || "-"}</td>
                <td className="px-3 py-2">{v.end_at || "-"}</td>
                <td className="px-3 py-2">
                  <Link className="underline" to={`/admin/votes/${v.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {votes.votes.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                  No votes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
