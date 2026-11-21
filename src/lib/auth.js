import "dotenv/config";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { db } from "../config/db.js";
import { PHONE_RE } from "./utils.js";

const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

export const auth = betterAuth({
  database: mongodbAdapter(db),
  // Auth is reached through the Next.js rewrite (/api/*), so its public URL is the client URL.
  baseURL: process.env.BETTER_AUTH_URL || clientUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [clientUrl, "http://localhost:3000"],
  user: {
    modelName: "users",
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false,
      },
      phone: { type: "string", required: false },
    },
  },
  emailAndPassword: { enabled: true, minPasswordLength: 6 },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!PHONE_RE.test(String(user.phone || "").replace(/[\s-]/g, ""))) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid Bangladeshi phone number",
            });
          }
          return { data: user };
        },
      },
    },
  },
});
