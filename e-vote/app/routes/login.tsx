import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { adminLogin } from "../utils/auth.server";
import { createAdminSession } from "../utils/session.server";

type ActionData = { error?: string };

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");

  try {
    const res = await adminLogin(request, email, password);
    // On success, create the cookie session and redirect to /admin
    return createAdminSession(res);
  } catch (e) {
    // If backend returns non-200, surface a friendly message
    return json<ActionData>({ error: "Invalid email or password" }, { status: 400 });
  }
}

export default function Login() {
  const data = useActionData<ActionData>();
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">Admin Login</h1>
      {data?.error && (
        <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {data.error}
        </div>
      )}
      <Form method="post" className="space-y-3">
        <label className="block text-sm">
          Email
          <input name="email" type="email" required className="mt-1 w-full rounded-md border-gray-300"/>
        </label>
        <label className="block text-sm">
          Password
          <input name="password" type="password" required className="mt-1 w-full rounded-md border-gray-300"/>
        </label>
        <button className="rounded-md bg-black px-4 py-2 text-sm text-white">Login</button>
      </Form>
    </div>
  );
}