import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

const API_URL = "https://huggingface.co/spaces/AhmedKing241/Backend";

const AuthPage = () => {
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); // 🚫 prevent reload
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const endpoint = isSignup ? "/signup" : "/login";
      const payload = isSignup ? { username, email, password } : { email, password };

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (Array.isArray(data)) {
          setError(data.map(err => `${err.loc.join(".")}: ${err.msg}`).join(" | "));
        } else {
          setError(data.detail || JSON.stringify(data));
        }
      } else {
        setSuccess(isSignup ? "User created! Redirecting..." : "Login successful! Redirecting...");
        if (data.access_token) localStorage.setItem("token", data.access_token);

        // SPA navigation
        setTimeout(() => navigate("/chat"), 1000);
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#808080]">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="bg-[#808080] text-[#dddddd] border border-[#dddddd] p-10 rounded-2xl shadow-xl w-full max-w-md"
      >
        <h1 className="text-3xl font-bold mb-6 text-center">
          {isSignup ? "Sign Up" : "Login"}
        </h1>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        {success && <p className="text-green-500 text-sm mb-3">{success}</p>}

        <form onSubmit={handleSubmit}>
          {isSignup && (
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full mb-3 px-4 py-2 rounded bg-transparent border border-[#dddddd] focus:outline-none focus:ring-2 focus:ring-[#dddddd]"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-3 px-4 py-2 rounded bg-transparent border border-[#dddddd] focus:outline-none focus:ring-2 focus:ring-[#dddddd]"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-5 px-4 py-2 rounded bg-transparent border border-[#dddddd] focus:outline-none focus:ring-2 focus:ring-[#dddddd]"
          />

          <button
            type="submit"
            className={`w-full py-3 rounded bg-[#dddddd] text-[#808080] font-semibold transition ${
              loading ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-300"
            }`}
            disabled={loading}
          >
            {loading ? "Processing..." : isSignup ? "Sign Up" : "Login"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
          <span
            className="text-white font-semibold cursor-pointer hover:underline"
            onClick={() => setIsSignup(!isSignup)}
          >
            {isSignup ? "Login" : "Sign Up"}
          </span>
        </p>
      </motion.div>
    </div>
  );
};

export default AuthPage;

