import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { api } from "../utils/api.server";
import { requireAdmin } from "../utils/session.server";

interface Voter {
  id: number; full_name: string; nic: string; dob?: string; gender?: string|null;
  household?: string|null; mobile?: string|null; email?: string|null;
  location_id?: string|null; administration?: string|null; electoral?: string|null;
  polling?: string|null; gn?: string|null; fingerprint?: string|null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const user = await api(request, `/api/admin/voters/${params.id}`, { headers: { "x-admin-id": "1" } }) as Voter;
  return json({ user });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const payload = Object.fromEntries(form);
  await api(request, `/api/admin/voters/${params.id}`, {
    method: "PUT",
    headers: { "x-admin-id": "1" },
    body: JSON.stringify(payload)
  });
  return redirect("/admin/voters");
}

export default function EditVoter() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Edit Voter</h1>
      <Form method="post" className="grid grid-cols-2 gap-3">
        <label className="text-sm">Full Name<input name="full_name" defaultValue={user.full_name} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">NIC<input name="nic" defaultValue={user.nic} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">DOB<input name="dob" type="date" defaultValue={user.dob?.slice(0,10)} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Gender<select name="gender" defaultValue={user.gender||''} className="mt-1 w-full rounded-md border-gray-300"><option></option><option>M</option><option>F</option></select></label>
        <label className="text-sm col-span-2">Household<input name="household" defaultValue={user.household||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Mobile<input name="mobile" defaultValue={user.mobile||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Email<input name="email" type="email" defaultValue={user.email||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Location ID<input name="location_id" defaultValue={user.location_id||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Administration<input name="administration" defaultValue={user.administration||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Electoral<input name="electoral" defaultValue={user.electoral||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">Polling<input name="polling" defaultValue={user.polling||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm">GN<input name="gn" defaultValue={user.gn||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <label className="text-sm col-span-2">Fingerprint<input name="fingerprint" defaultValue={user.fingerprint||''} className="mt-1 w-full rounded-md border-gray-300"/></label>
        <div className="col-span-2 mt-2 flex gap-2"><button className="rounded-md bg-black px-4 py-2 text-sm text-white">Save</button></div>
      </Form>
    </div>
  );
}