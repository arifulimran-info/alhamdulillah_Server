import { Router } from "express";
import { col } from "../config/db.js";
import { verifyToken, verifyCustomer } from "../middleware/auth.js";
import { PHONE_RE } from "../lib/utils.js";

const router = Router();

router.get("/me", verifyToken, async (req, res) => {
  const user = await col.users.findOne({ email: req.user.email });
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
});

router.patch("/me", verifyToken, async (req, res) => {
  const { name, phone, address, image } = req.body || {};
  const $set = {};
  if (name?.trim()) $set.name = name.trim();
  if (phone !== undefined) {
    if (!PHONE_RE.test(String(phone).replace(/[\s-]/g, "")))
      return res.status(400).json({ message: "Invalid phone number" });
    $set.phone = String(phone).replace(/[\s-]/g, "");
  }
  if (address)
    $set.address = {
      division: address.division || "",
      district: address.district || "",
      details: address.details || "",
    };
  if (image !== undefined) $set.image = String(image);
  $set.updatedAt = new Date();
  await col.users.updateOne({ email: req.user.email }, { $set });
  res.json(await col.users.findOne({ email: req.user.email }));
});

router.get("/customer-stats", verifyToken, verifyCustomer, async (req, res) => {
  const orders = await col.orders
    .find(
      { customerEmail: req.user.email },
      { projection: { status: 1, orderType: 1 } },
    )
    .toArray();
  res.json({
    totalOrders: orders.length,
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    deliveredOrders: orders.filter((o) => o.status === "delivered").length,
    activePreorders: orders.filter(
      (o) =>
        o.orderType === "preorder" &&
        !["delivered", "cancelled"].includes(o.status),
    ).length,
  });
});

export default router;
