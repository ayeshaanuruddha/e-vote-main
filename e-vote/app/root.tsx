import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Links, LiveReload, Meta, Outlet, Scripts, ScrollRestoration, NavLink, useLoaderData } from "@remix-run/react";
import stylesheet from "./tailwind.css";
import { getAdmin } from "./utils/session.server";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
  { rel: "stylesheet", href: stylesheet },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const admin = await getAdmin(request);
  return { admin };
}

export default function App() {
  const { admin } = useLoaderData<typeof loader>();
  return (
    <html lang="en" className="h-full">
      <head>
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-900 [font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <header className="rounded-2xl border border-gray-200 bg-white/70 backdrop-blur px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between">
              <NavLink to="/" className="text-lg font-semibold tracking-tight">MPC Voting</NavLink>
              <nav className="flex items-center gap-4 text-sm">
                <NavLink to="/votes" className={({isActive})=> isActive?"font-semibold":"text-gray-600 hover:text-gray-900"}>Public Votes</NavLink>
                {admin ? (
                  <>
                    <NavLink to="/admin" className={({isActive})=> isActive?"font-semibold":"text-gray-600 hover:text-gray-900"}>Admin</NavLink>
                    <form method="post" action="/logout"><button className="text-red-600 hover:text-red-700">Logout</button></form>
                  </>
                ) : (
                  <NavLink to="/login" className="text-gray-600 hover:text-gray-900">Admin Login</NavLink>
                )}
              </nav>
            </div>
          </header>
          <main className="py-6">
            <Outlet />
          </main>
        </div>
        <ScrollRestoration />
        
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}