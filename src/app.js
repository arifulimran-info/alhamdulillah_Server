import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { init } from "./config/db.js";
import jwtRoutes from "./routes/jwt.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes, { webhookHandler } from "./routes/payments.js";
import userRoutes from "./routes/users.js";
import adminRoutes from "./routes/admin.js";

const app = express();
app.set("trust proxy", 1);

const allowed = [process.env.CLIENT_URL, "http://localhost:3000"].filter(
  Boolean,
);
app.use(
  cors({
    origin: (o, cb) => cb(null, !o || allowed.includes(o)),
    credentials: true,
  }),
);

// Order matters: Stripe webhook needs the raw body, BetterAuth must run before express.json()
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler,
);
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // SSLCommerz posts form data
app.use(async (_req, _res, next) => {
  try {
    await init();
    next();
  } catch (e) {
    next(e);
  }
});

app.get("/", (_req, res) => res.json({ name: "AgroBazar API", status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/jwt", jwtRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);

app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.message || "Server error" });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`AgroBazar API running on :${port}`));
}
export default app;
