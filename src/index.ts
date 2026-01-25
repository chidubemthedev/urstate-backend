import express from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";

const app = express();
const PORT = 3000;

// 1. CORS Setup (Crucial for Auth)
app.use(
  cors({
    origin: ["http://localhost:3000"], // Your Frontend
    credentials: true, // Allow cookies to be sent
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);

// 2. Mount Better Auth Handler
// NOTE: Must be before express.json() for body parsing reasons in some setups
app.all("/api/auth/*path", toNodeHandler(auth));

// 3. Standard JSON middleware for your OTHER routes
app.use(express.json());

// 4. Example Protected Route
app.get("/api/dashboard", async (req, res) => {
  // Check session
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).send("Unauthorized");
    return;
  }

  res.json({
    message: "Here is your secret data",
    user: session.user,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
