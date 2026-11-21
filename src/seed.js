import "dotenv/config";
import { client, col } from "./config/db.js";
import { auth } from "./lib/auth.js";
import { slugify } from "./lib/utils.js";

const day = (n) => new Date(Date.now() + n * 86400000);
const H = "Pure Honey",
  G = "Ghee & Oils",
  K = "Khejurer Gur",
  R = "Rice, Flour & Lentils",
  S = "Spices & Seeds";
const inStock = (name, category, price, unit, stock, description) => ({
  name,
  category,
  price,
  unit,
  stock,
  description,
  saleType: "instock",
});
const preOrder = (
  name,
  category,
  price,
  unit,
  quota,
  booked,
  days,
  pct,
  description,
) => ({
  name,
  category,
  price,
  unit,
  description,
  saleType: "preorder",
  preorderQuota: quota,
  preorderBooked: booked,
  expectedDeliveryDate: day(days),
  advancePercent: pct,
});

const products = [
  inStock(
    "Mustard Flower Honey",
    H,
    650,
    "kg",
    60,
    "Raw honey collected from mustard fields. Light golden colour with a mild, floral sweetness.",
  ),
  inStock(
    "Litchi Flower Honey",
    H,
    780,
    "kg",
    45,
    "Naturally crystallising litchi honey with a fruity aroma, packed without heating.",
  ),
  inStock(
    "Black Seed (Kalojira) Honey",
    H,
    950,
    "kg",
    30,
    "Dark, bold honey from kalojira blossoms. Popular as a daily wellness spoonful.",
  ),
  inStock(
    "Desi Cow Ghee",
    G,
    1450,
    "kg",
    40,
    "Slow-simmered ghee from cultured butter. Granular texture and a nutty aroma.",
  ),
  inStock(
    "Cold-pressed Mustard Oil",
    G,
    380,
    "litre",
    80,
    "Kachi ghani mustard oil, pressed at low temperature to keep its pungency.",
  ),
  inStock(
    "Virgin Coconut Oil",
    G,
    650,
    "litre",
    35,
    "Cold-pressed from fresh coconuts of the coastal belt. Good for cooking and skin.",
  ),
  inStock(
    "Dry Khejur Gur Pieces",
    K,
    420,
    "kg",
    8,
    "Hand-cut pieces of sun-dried date palm jaggery, easy to store and use.",
  ),
  inStock(
    "Whole Wheat Atta",
    R,
    70,
    "kg",
    200,
    "Stone-ground whole wheat flour with the bran intact.",
  ),
  inStock(
    "Moong Dal (Husked)",
    R,
    180,
    "kg",
    90,
    "Clean, sorted husked moong dal that cooks soft in 15 minutes.",
  ),
  inStock(
    "Masoor Dal",
    R,
    140,
    "kg",
    120,
    "Red lentils sourced directly from Pabna farmers.",
  ),
  inStock(
    "Turmeric Powder",
    S,
    380,
    "kg",
    50,
    "Sun-dried and stone-ground turmeric with deep colour and no added dye.",
  ),
  inStock(
    "Dry Red Chilli Powder",
    S,
    520,
    "kg",
    45,
    "Hot, bright chilli powder from Bogura chillies, ground in small batches.",
  ),
  inStock(
    "Whole Kalojira (Black Cumin)",
    S,
    900,
    "kg",
    25,
    "Plump black cumin seeds for pickles, parathas and tempering.",
  ),
  inStock(
    "Coriander Seeds",
    S,
    300,
    "kg",
    55,
    "Whole coriander seeds with a citrusy fragrance, cleaned and sorted.",
  ),
  preOrder(
    "Sundarban Spring-Harvest Honey",
    H,
    1250,
    "kg",
    120,
    74,
    35,
    30,
    "Wild honey from the spring harvest of Sundarban honey collectors. Limited batch.",
  ),
  preOrder(
    "New-crop Mustard Oil",
    G,
    420,
    "litre",
    200,
    96,
    28,
    30,
    "Pressed from this winter's mustard crop right after harvest.",
  ),
  preOrder(
    "Khejurer Jhola Gur (Winter)",
    K,
    520,
    "kg",
    150,
    118,
    42,
    30,
    "Liquid date palm jaggery tapped in winter mornings from Jashore.",
  ),
  preOrder(
    "Khejurer Patali Gur (Winter)",
    K,
    640,
    "kg",
    100,
    100,
    45,
    30,
    "Solid patali jaggery, set by hand in clay moulds. Quota is already full.",
  ),
  preOrder(
    "New Aman Rice",
    R,
    78,
    "kg",
    500,
    210,
    30,
    25,
    "Freshly harvested aman paddy, milled on order and delivered within a week.",
  ),
  preOrder(
    "Chinigura Aromatic Rice",
    R,
    135,
    "kg",
    300,
    65,
    38,
    25,
    "Short-grain fragrant rice for polao and payesh, from the new harvest.",
  ),
];

const BN = {
  "Mustard Flower Honey": [
    "সরিষা ফুলের মধু",
    "সরিষা খেতের কাঁচা মধু। হালকা সোনালি রং ও মৃদু ফুলের মিষ্টতা।",
  ],
  "Litchi Flower Honey": [
    "লিচু ফুলের মধু",
    "প্রাকৃতিকভাবে জমে যাওয়া লিচু ফুলের মধু, ফলের সুবাসসহ, গরম না করে প্যাক করা।",
  ],
  "Black Seed (Kalojira) Honey": [
    "কালোজিরা ফুলের মধু",
    "কালোজিরা ফুলের গাঢ় ও ঝাঁঝালো মধু। প্রতিদিনের স্বাস্থ্য-চামচের জন্য জনপ্রিয়।",
  ],
  "Desi Cow Ghee": [
    "দেশি গরুর ঘি",
    "টক-মাখন থেকে ধীরে জ্বাল দেওয়া ঘি। দানাদার গড়ন ও বাদামি সুবাস।",
  ],
  "Cold-pressed Mustard Oil": [
    "কাঁচা ঘানির সরিষার তেল",
    "কম তাপমাত্রায় ঘানিতে পেষা সরিষার তেল, ঝাঁঝ অটুট রেখে।",
  ],
  "Virgin Coconut Oil": [
    "ভার্জিন নারকেল তেল",
    "উপকূলের তাজা নারকেল থেকে কোল্ড-প্রেসড। রান্না ও ত্বকের যত্নে চমৎকার।",
  ],
  "Dry Khejur Gur Pieces": [
    "শুকনো খেজুরের গুড়ের টুকরো",
    "রোদে শুকানো খেজুরের গুড়, হাতে কাটা টুকরো; সংরক্ষণ ও ব্যবহারে সহজ।",
  ],
  "Whole Wheat Atta": ["পুরো গমের আটা", "তুষসহ শিলে পেষা পুরো গমের আটা।"],
  "Moong Dal (Husked)": [
    "মুগ ডাল (খোসা ছাড়ানো)",
    "বাছাই করা পরিষ্কার মুগ ডাল, ১৫ মিনিটে নরম সেদ্ধ হয়।",
  ],
  "Masoor Dal": [
    "মসুর ডাল",
    "পাবনার কৃষকদের কাছ থেকে সরাসরি সংগ্রহ করা মসুর ডাল।",
  ],
  "Turmeric Powder": [
    "হলুদের গুঁড়া",
    "রোদে শুকিয়ে শিলে পেষা হলুদ; গাঢ় রং, কোনো রং মেশানো নয়।",
  ],
  "Dry Red Chilli Powder": [
    "শুকনো মরিচের গুঁড়া",
    "বগুড়ার মরিচ থেকে ছোট ব্যাচে পেষা ঝাল ও উজ্জ্বল মরিচের গুঁড়া।",
  ],
  "Whole Kalojira (Black Cumin)": [
    "আস্ত কালোজিরা",
    "আচার, পরোটা ও ফোড়নের জন্য পুষ্ট কালোজিরা।",
  ],
  "Coriander Seeds": [
    "ধনিয়া বীজ",
    "লেবুর মতো সুবাসযুক্ত আস্ত ধনিয়া, পরিষ্কার ও বাছাই করা।",
  ],
  "Sundarban Spring-Harvest Honey": [
    "সুন্দরবনের বসন্তের মধু",
    "সুন্দরবনের মৌয়ালদের বসন্ত মৌসুমের বনের মধু। সীমিত ব্যাচ।",
  ],
  "New-crop Mustard Oil": [
    "নতুন ফসলের সরিষার তেল",
    "এই শীতের নতুন সরিষা কাটার পরপরই ঘানিতে পেষা তেল।",
  ],
  "Khejurer Jhola Gur (Winter)": [
    "খেজুরের ঝোলা গুড় (শীত)",
    "যশোরের শীতের সকালে ঝরানো তরল খেজুরের গুড়।",
  ],
  "Khejurer Patali Gur (Winter)": [
    "খেজুরের পাটালি গুড় (শীত)",
    "মাটির ছাঁচে হাতে জমানো শক্ত পাটালি গুড়। কোটা ইতিমধ্যে পূর্ণ।",
  ],
  "New Aman Rice": [
    "নতুন আমন চাল",
    "সদ্য কাটা আমন ধান, অর্ডারে মিল করে এক সপ্তাহের মধ্যে ডেলিভারি।",
  ],
  "Chinigura Aromatic Rice": [
    "চিনিগুঁড়া সুগন্ধি চাল",
    "পোলাও ও পায়েশের জন্য ছোট দানার সুগন্ধি চাল, নতুন ফসল থেকে।",
  ],
};

async function ensureUser(name, email, password, phone, role) {
  const existing = await col.users.findOne({ email });
  if (!existing)
    await auth.api.signUpEmail({ body: { name, email, password, phone } });
  await col.users.updateOne({ email }, { $set: { role } });
}

await ensureUser(
  "AgroBazar Admin",
  process.env.SEED_ADMIN_EMAIL,
  process.env.SEED_ADMIN_PASSWORD,
  "01700000001",
  "admin",
);
await ensureUser(
  "Demo Customer",
  process.env.SEED_CUSTOMER_EMAIL,
  process.env.SEED_CUSTOMER_PASSWORD,
  "01700000002",
  "customer",
);

await col.products.deleteMany({});
await col.products.insertMany(
  products.map((p, i) => ({
    stock: null,
    preorderQuota: null,
    preorderBooked: 0,
    expectedDeliveryDate: null,
    advancePercent: null,
    ...p,
    nameBn: BN[p.name]?.[0] || "",
    descriptionBn: BN[p.name]?.[1] || "",
    slug: `${slugify(p.name)}-${i + 1}`,
    image: "",
    isActive: true,
    createdAt: new Date(Date.now() - i * 3600000),
  })),
);
console.log(`Seeded ${products.length} products + admin & demo customer`);
await client.close();
process.exit(0);
