import { api } from "./api.server";

export async function adminLogin(request: Request, email: string, password: string) {
  return api(request, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}