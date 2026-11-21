import { ObjectId } from "mongodb";

export const CATEGORIES = [
  "Pure Honey",
  "Ghee & Oils",
  "Khejurer Gur",
  "Rice, Flour & Lentils",
  "Spices & Seeds",
];
export const UNITS = ["kg", "litre", "piece"];
export const STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];
export const PHONE_RE = /^(?:\+?88)?01[3-9]\d{8}$/;

export const normalizePhone = (p) =>
  String(p || "")
    .replace(/[\s-]/g, "")
    .replace(/^\+?88/, "");
export const deliveryCharge = (district) =>
  String(district).trim().toLowerCase() === "dhaka" ? 60 : 120;
export const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
export const escapeRegex = (s) =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const makeOrderNumber = () =>
  "AB-" +
  Date.now().toString(36).toUpperCase() +
  Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0");
