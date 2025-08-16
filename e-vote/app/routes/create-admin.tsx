import { useState } from "react";

export default function CreateAdminPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function handleSubmit() {
    const token = localStorage.getItem("token");
    const res = await fetch("http://localhost:8000/api/admin/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ full_name: fullName, email, password }),
    });
    const data = await res.json();
    setMsg(data.message);
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h2 className="text-2xl font-semibold mb-4">Create New Admin</h2>
      {msg && <p className="text-green-600 text-sm mb-3">{msg}</p>}
      <input
        type="text"
        placeholder="Full Name"
        className="w-full p-2 mb-3 border rounded"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <input
        type="email"
        placeholder="Email"
        className="w-full p-2 mb-3 border rounded"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        className="w-full p-2 mb-3 border rounded"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        onClick={handleSubmit}
        className="bg-green-600 text-white px-4 py-2 rounded"
      >
        Create Admin
      </button>
    </div>
  );
}