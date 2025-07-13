import { MetaFunction } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";

export const meta: MetaFunction = () => {
  return [{ title: "Voter SL - Register" }];
};

const locationSets = [
  {
    id: "kegalle",
    administration: "25 - Kegalle",
    electoral: "22 - Kegalle",
    polling: "B - Galigamuwa",
    gn: "74 D - Panakawa - 54",
  },
  {
    id: "colombo",
    administration: "11 - Colombo",
    electoral: "01 - Colombo",
    polling: "A - Colombo Central",
    gn: "03 A - Fort - 12",
  },
];

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(locationSets[0]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"success" | "error" | "">("");
  const [fingerprintStatus, setFingerprintStatus] = useState<"idle" | "scanning" | "success" | "fail">("idle");
  const [fingerprintTemplate, setFingerprintTemplate] = useState("");

  useEffect(() => {
    const emailParam = searchParams.get("email");
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (fingerprintStatus === "scanning") {
      interval = setInterval(async () => {
        try {
          const res = await fetch("http://localhost:8000/api/fingerprint/scan");
          const data = await res.json();

          if (data.fingerprint) {
            setFingerprintTemplate(data.fingerprint);
            setFingerprintStatus("success");
            setMessage("✅ Fingerprint captured successfully.");
            setStatus("success");
            clearInterval(interval);
          }
        } catch (err) {
          setFingerprintStatus("fail");
          setMessage("❌ Failed to connect to fingerprint server.");
          setStatus("error");
          clearInterval(interval);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [fingerprintStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setStatus("");

    if (!fingerprintTemplate) {
      setMessage("❌ Please scan and include fingerprint.");
      setStatus("error");
      return;
    }

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = {
      full_name: formData.get("full_name"),
      nic: formData.get("nic"),
      dob: formData.get("dob"),
      gender: formData.get("gender"),
      household: formData.get("household"),
      mobile: formData.get("mobile"),
      email: formData.get("email"),
      fingerprint: fingerprintTemplate,
      location_id: selectedLocation.id,
      administration: selectedLocation.administration,
      electoral: selectedLocation.electoral,
      polling: selectedLocation.polling,
      gn: selectedLocation.gn,
    };

    try {
      const res = await fetch("http://localhost:8000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();
      setMessage(result.message);
      setStatus(result.status === "success" ? "success" : "error");

      if (result.status === "success") {
        setFingerprintStatus("idle");
        setFingerprintTemplate("");
        form.reset();
      }
    } catch (err) {
      setMessage("❌ Unexpected error. Please try again.");
      setStatus("error");
    }
  };

  const handleFingerprintScan = () => {
    setFingerprintTemplate("");
    setFingerprintStatus("scanning");
    setMessage("🔄 Waiting for fingerprint scan from device...");
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-6 py-10">
      <h1 className="text-3xl font-semibold text-black mb-6">Voter SL</h1>

      {message && (
        <div
          className={`w-full max-w-xl px-4 py-3 mb-6 rounded-lg text-sm font-medium transition-all ${
            status === "success"
              ? "bg-green-100 text-green-800 border border-green-300"
              : "bg-red-100 text-red-800 border border-red-300"
          }`}
        >
          {message}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-10 w-full max-w-7xl">
        {/* Location Picker */}
        <div className="flex flex-col gap-6 w-full lg:w-1/2">
          {locationSets.map((loc) => (
            <button
              key={loc.id}
              type="button"
              role="radio"
              aria-checked={selectedLocation?.id === loc.id}
              onClick={() => setSelectedLocation(loc)}
              className={`text-left cursor-pointer p-6 rounded-lg border shadow-md transition w-full ${
                selectedLocation?.id === loc.id
                  ? "border-black bg-gray-50"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <p className="text-sm font-semibold text-black">Administration District</p>
              <p className="text-xl font-semibold text-black">{loc.administration}</p>
              <p className="mt-2 text-sm font-semibold text-black">Electoral District</p>
              <p className="text-xl font-semibold text-black">{loc.electoral}</p>
              <p className="mt-2 text-sm font-semibold text-black">Polling Division</p>
              <p className="text-xl font-semibold text-black">{loc.polling}</p>
              <p className="mt-2 text-sm font-semibold text-black">GN Division</p>
              <p className="text-xl font-semibold text-black">{loc.gn}</p>
            </button>
          ))}
        </div>

        {/* Form */}
        <form className="w-full lg:w-1/2 flex flex-col gap-4" onSubmit={handleSubmit}>
          <input name="full_name" type="text" placeholder="Full Name (with Surname)" className="input" required />
          <input name="nic" type="text" placeholder="NIC / SLIN No" className="input" required />
          <input name="dob" type="date" className="input" required />
          <input name="gender" type="text" placeholder="Gender" className="input" required />
          <input name="household" type="text" placeholder="Household" className="input" required />
          <input name="mobile" type="text" placeholder="Mobile Number" className="input" required />
          <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" required />

          {/* Fingerprint Status */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleFingerprintScan}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Scan Fingerprint
            </button>
            <p className="text-sm text-zinc-700">
              Status:{" "}
              {fingerprintStatus === "idle" && "Not scanned"}
              {fingerprintStatus === "scanning" && "Scanning..."}
              {fingerprintStatus === "success" && "Captured ✅"}
              {fingerprintStatus === "fail" && "Failed ❌"}
            </p>
          </div>

          <p className="text-sm text-center text-zinc-500">
            By clicking Submit, you agree to our{" "}
            <span className="text-black underline">Terms</span> and{" "}
            <span className="text-black underline">Privacy Policy</span>.
          </p>

          <button type="submit" className="bg-black text-white text-lg font-medium py-2 rounded-lg hover:bg-neutral-800 transition">
            Submit
          </button>
        </form>
      </div>
    </div>
  );
}
