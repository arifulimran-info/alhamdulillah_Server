import { Router } from "express";
import { col } from "../config/db.js";
import { escapeRegex, oid } from "../lib/utils.js";

const router = Router();

// Challenge 1: server-side search / filter / sort + pagination (skip & limit)
router.get("/", async (req, res) => {
  const {
    search = "",
    category,
    saleType,
    minPrice,
    maxPrice,
    sort = "newest",
  } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 12));

  const query = { isActive: true };
  if (search.trim())
    query.name = { $regex: escapeRegex(search.trim()), $options: "i" };
  if (category) query.category = category;
  if (["instock", "preorder"].includes(saleType)) query.saleType = saleType;
  if (minPrice || maxPrice) {
    query.price = {};
    if (minPrice) query.price.$gte = Number(minPrice);
    if (maxPrice) query.price.$lte = Number(maxPrice);
  }
  const sorts = {
    newest: { createdAt: -1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
  };

  const [items, total] = await Promise.all([
    col.products
      .find(query)
      .sort(sorts[sort] || sorts.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    col.products.countDocuments(query),
  ]);
  res.json({
    items,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.get("/featured", async (_req, res) => {
  res.json(
    await col.products
      .find({ isActive: true, saleType: "instock" })
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray(),
  );
});

router.get("/preorders", async (_req, res) => {
  res.json(
    await col.products
      .find({ isActive: true, saleType: "preorder" })
      .sort({ expectedDeliveryDate: 1 })
      .limit(12)
      .toArray(),
  );
});

// Used by the cart to refresh prices / stock.
router.post("/by-ids", async (req, res) => {
  const ids = (req.body?.ids || []).map(oid).filter(Boolean).slice(0, 50);
  res.json(await col.products.find({ _id: { $in: ids } }).toArray());
});

router.get("/:slug", async (req, res) => {
  const product = await col.products.findOne({
    slug: req.params.slug,
    isActive: true,
  });
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json(product);
});

export default router;
