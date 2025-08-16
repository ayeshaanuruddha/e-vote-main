import { useEffect, useState } from "react";

type User = {
  id: number;
  full_name: string;
  nic: string;
};

type Vote = {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
};

export default function VotePage() {
  const [user, setUser] = useState<User | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [selectedVoteId, setSelectedVoteId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const fetchFingerprintAndVerify = async () => {
    const res = await fetch("http://localhost:8000/api/fingerprint/scan");
    const data = await res.json();

    if (data.fingerprint) {
      const verifyRes = await fetch("http://localhost:8000/api/fingerprint/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fingerprint: data.fingerprint }),
      });

      const verifyData = await verifyRes.json();
      if (verifyData.status === "success") {
        setUser(verifyData.user);
      } else {
        setMessage("User not found.");
      }
    } else {
      setMessage("Please scan fingerprint.");
    }
  };

  const fetchVotes = async () => {
    const res = await fetch("http://localhost:8000/api/votes");
    const data = await res.json();
    setVotes(data.votes || []);
  };

  const handleVote = async () => {
    if (!selectedVoteId || !user) return;

    const res = await fetch("http://localhost:8000/api/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: user.id,
        vote_id: selectedVoteId,
      }),
    });

    const data = await res.json();
    setMessage(data.message || "Something went wrong");
  };

  useEffect(() => {
    fetchVotes();
    fetchFingerprintAndVerify();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Cast Your Vote</h2>

      {user && (
        <div className="mb-4 text-sm text-gray-600">
          Welcome, <strong>{user.full_name}</strong> ({user.nic})
        </div>
      )}

      <div className="grid gap-4">
        {votes.map((vote) => (
          <label
            key={vote.id}
            className={`border p-4 rounded cursor-pointer ${
              selectedVoteId === vote.id ? "border-blue-500 bg-blue-50" : ""
            }`}
          >
            <input
              type="radio"
              name="vote"
              value={vote.id}
              checked={selectedVoteId === vote.id}
              onChange={() => setSelectedVoteId(vote.id)}
              className="mr-2"
            />
            <strong>{vote.title}</strong> - {vote.description}
          </label>
        ))}
      </div>

      <button
        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={handleVote}
        disabled={!selectedVoteId || !user}
      >
        Submit Vote
      </button>

      {message && <p className="mt-4 text-sm text-red-600">{message}</p>}
    </div>
  );
}
