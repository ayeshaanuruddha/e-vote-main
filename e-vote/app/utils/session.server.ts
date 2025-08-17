import { createCookieSessionStorage, redirect } from "@remix-run/node";

const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change";

export const storage = createCookieSessionStorage({
  cookie: {
    name: "__admin",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [sessionSecret],
    secure: process.env.NODE_ENV === "production",
  },
});

export async function getAdmin(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const admin = session.get("admin") as { id: number; full_name: string } | undefined;
  return admin || null;
}

export async function requireAdmin(request: Request) {
  const admin = await getAdmin(request);
  if (!admin) throw redirect("/login");
  return admin;
}

export async function createAdminSession(admin: { admin_id: number; full_name: string }) {
  const session = await storage.getSession();
  session.set("admin", { id: admin.admin_id, full_name: admin.full_name });
  return redirect("/admin", {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function logout(request: Request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/", { headers: { "Set-Cookie": await storage.destroySession(session) } });
}