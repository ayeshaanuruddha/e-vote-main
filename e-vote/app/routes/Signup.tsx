// app/routes/signup.tsx
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => {
  return [{ title: "VoteNow - Create Account" }];
};

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  const handleEmailSignup = () => {
    if (email.trim()) {
      navigate(`/register?email=${encodeURIComponent(email.trim())}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-white">
      <h1 className="text-3xl font-semibold text-black mb-10">VoteNow</h1>

      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-semibold text-black">Create an account</h2>
          <p className="text-base text-black">Enter your email to sign up for this app</p>
        </div>

        <div className="w-full space-y-4">
          <input
            type="email"
            placeholder="email@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 px-4 py-2 rounded-lg border border-neutral-200 text-zinc-500 text-base focus:outline-none"
          />
          <button
            onClick={handleEmailSignup}
            className="w-full h-10 bg-black text-white text-base font-medium rounded-lg hover:bg-neutral-800 transition"
          >
            Sign up with email
          </button>
        </div>

        <div className="flex items-center w-full gap-2">
          <hr className="flex-1 border-neutral-200" />
          <span className="text-zinc-500 text-base">or continue with</span>
          <hr className="flex-1 border-neutral-200" />
        </div>

        <button className="w-full h-10 flex items-center justify-center bg-zinc-100 rounded-lg hover:bg-zinc-200 transition gap-3">
          <i className="fab fa-google text-lg text-[#4285F4]"></i>
          <span className="text-base font-medium text-black">Google</span>
        </button>

        <p className="text-center text-sm text-zinc-500">
          By clicking continue, you agree to our{" "}
          <span className="text-black underline cursor-pointer">Terms of Service</span> and{" "}
          <span className="text-black underline cursor-pointer">Privacy Policy</span>
        </p>
      </div>
    </div>
  );
}
