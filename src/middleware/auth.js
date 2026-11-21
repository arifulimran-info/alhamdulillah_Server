import jwt from "jsonwebtoken";
import { col } from "../config/db.js";

export function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Role is re-checked against the database so a demoted admin loses access immediately.
const requireRole = (role) => async (req, res, next) => {
  const user = await col.users.findOne(
    { email: req.user.email },
    { projection: { role: 1 } },
  );
  if (!user || user.role !== role)
    return res.status(403).json({ message: "Forbidden" });
  next();
};
export const verifyAdmin = requireRole("admin");
export const verifyCustomer = requireRole("customer");
