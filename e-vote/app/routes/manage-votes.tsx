import { useEffect, useState } from "react";

// Define the structure of a vote
type Vote = {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  created_at?: string;
};

export default function ManageVotesPage() {
  const [votes, setVotes] = useState<Vote[]>([]);

  useEffect(() => {
    const fetchVotes = async () => {
      const token = localStorage.getItem("token");
      try {
        const res = await fetch("http://localhost:8000/api/votes", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        setVotes(data.votes || []);
      } catch (err) {
        console.error("Failed to fetch votes", err);
      }
    };

    fetchVotes();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Manage Votes</h2>
      <div className="grid gap-4">
        {votes.map((vote: Vote) => (
          <div
            key={vote.id}
            className="p-4 border rounded bg-white shadow-sm hover:shadow-md transition"
          >
            <h3 className="text-lg font-bold">{vote.title}</h3>
            <p className="text-sm text-gray-700">{vote.description}</p>
            <p className="text-xs text-gray-500 mt-1">
              Created at: {vote.created_at || "N/A"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
