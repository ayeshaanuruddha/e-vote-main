import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen p-8 bg-gray-100">
      <h1 className="text-3xl text-black font-bold mb-6">Admin Dashboard</h1>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <button onClick={() => navigate("/create-vote")} className="p-4 bg-blue-600 text-white rounded">
          Create New Voting
        </button>
        <button onClick={() => navigate("/create-admin")} className="p-4 bg-green-600 text-white rounded">
          Create New Admin
        </button>
        <button onClick={() => navigate("/manage-votes")} className="p-4 bg-purple-600 text-white rounded">
          Manage Votes
        </button>
      </div>
    </div>
  );
}