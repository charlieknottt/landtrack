"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  onClose: () => void;
  onAuth: () => void;
}

export default function AuthModal({ onClose, onAuth }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (mode === "login") {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
      onAuth();
      onClose();
    } else {
      const { error: err } = await supabase.auth.signUp({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
      setSignupDone(true);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[360px] max-w-[calc(100vw-2rem)] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#0a0a0a]">
            {mode === "login" ? "Sign In" : "Create Account"}
          </h2>
          <button onClick={onClose} className="text-[#a1a1aa] hover:text-[#0a0a0a] text-xl leading-none">&times;</button>
        </div>

        {signupDone ? (
          <div className="text-center py-4">
            <div className="text-[#16a34a] text-2xl mb-2">&#10003;</div>
            <p className="text-sm text-[#3f3f46] mb-1">Check your email to confirm your account.</p>
            <p className="text-xs text-[#a1a1aa]">{email}</p>
            <button onClick={onClose} className="mt-4 px-4 py-1.5 bg-[#0a0a0a] text-white text-sm rounded-lg">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[11px] text-[#71717a] font-medium uppercase tracking-wider mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-[#e4e4e7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e97316]"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#71717a] font-medium uppercase tracking-wider mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 text-sm border border-[#e4e4e7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e97316]"
                placeholder="Min 6 characters"
              />
            </div>
            {error && <div className="text-xs text-[#ef4444] bg-[#fef2f2] border border-[#fecaca] rounded px-3 py-2">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-[#e97316] text-white text-sm font-medium rounded-lg hover:bg-[#c2410c] transition-colors disabled:opacity-50"
            >
              {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
                className="text-xs text-[#71717a] hover:text-[#e97316] transition-colors"
              >
                {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
