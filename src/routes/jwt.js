import { Router } from "express";
import jwt from "jsonwebtoken";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { col } from "../config/db.js";

const router = Router();

// Exchanges a valid BetterAuth session cookie for a short-lived JWT.
router.post("/", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) return res.status(401).json({ message: "Not signed in" });
  const user = await col.users.findOne({ email: session.user.email });
  if (!user) return res.status(401).json({ message: "User not found" });
  const token = jwt.sign(
    { email: user.email, role: user.role || "customer" },
    process.env.JWT_SECRET,
    {
      expiresIn: "2h",
    },
  );
  res.json({ token });
});

export default router;
