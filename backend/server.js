import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import chatRoute from "./routes/chat.js";
import guessRoute from "./routes/guess.js";
import holdingsRoute from "./routes/holdings.js";
import statsRoute from "./routes/stats.js";
import discoveriesRoute from "./routes/discoveries.js";
import autonomousRoute from "./routes/autonomous.js";
import prizeRoute from "./routes/prize.js";
import authRoute from "./routes/auth.js";
import adminRoute from "./routes/admin.js";
import leaderboardRoute from "./routes/leaderboard.js";
import profileRoute from "./routes/profile.js";
import arenaRoute from "./routes/arena.js";
import { migrateDatabase } from "./_db.js";

const app = express();

app.set("trust proxy", 1);

const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:5500",
  "http://localhost:5501",
  "http://localhost:5502",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://127.0.0.1:5502",
  "null", // local file:// development
]);

const PRODUCTION_ORIGINS = new Set([
  "https://mysteryclaw.xyz",
  "https://www.mysteryclaw.xyz",
  "https://mysteryclaw.vercel.app",
]);

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  ...PRODUCTION_ORIGINS,
  ...configuredOrigins,
  ...LOCAL_ORIGINS,
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-agent-key"],
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
}));
app.options("*", cors());
app.use(express.json({ limit: "250kb" }));

const publicLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const guessLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(publicLimit);

// Mysterio agent endpoints
app.use("/chat", chatLimit, chatRoute);
app.use("/guess", guessLimit, guessRoute);
app.use("/auth", guessLimit, authRoute);

// Platform endpoints
app.use("/holdings", holdingsRoute);
app.use("/stats", statsRoute);
app.use("/discoveries", discoveriesRoute);
app.use("/autonomous", autonomousRoute);
app.use("/prize", prizeRoute);
app.use("/leaderboard", leaderboardRoute);
app.use("/profile", guessLimit, profileRoute);
app.use("/arena", guessLimit, arenaRoute);
app.use("/admin", adminRoute);

app.get("/", (req, res) => {
  res.json({
    name: "MysteryClaw",
    tagline: "The Signal That Guards a Secret",
    agent: "Mysterio v1.0.0",
    endpoints: {
      "POST /chat":          "talk to Mysterio",
      "POST /guess":         "submit the hidden word",
      "POST /auth/nonce":    "create a wallet signature challenge",
      "POST /holdings":      "verify wallet token holdings",
      "GET  /stats":         "live platform stats",
      "GET  /discoveries":   "community-saved fragments",
      "POST /discoveries":   "submit a fragment to the public feed",
      "GET  /autonomous":    "Mysterio's self-generated posts (live feed)",
      "POST /autonomous":    "agent-runtime pushes new post (requires x-agent-key)",
      "GET  /prize":         "current prize epoch status",
      "GET  /prize/epochs/echo": "Echo epoch metadata and X clue timeline",
      "GET  /prize/history": "past epoch payouts (transparency)",
      "GET  /leaderboard":   "current epoch participants and winners",
      "GET  /profile/:wallet": "public wallet profile and game stats",
      "POST /profile":       "signed wallet profile update",
      "GET  /arena":         "ClawPump Arena status and public stats",
      "GET  /arena/leaderboard": "ClawPump Arena leaderboard",
      "POST /arena/runs":    "signed ClawPump Arena run submission",
      "GET  /admin/api/status": "admin system status (requires Authorization)",
      "POST /admin/api/payout": "admin-only payout trigger"
    }
  });
});

const PORT = process.env.PORT || 3000;

if (process.env.AUTO_MIGRATE !== "false") {
  try {
    const migrated = await migrateDatabase();
    if (migrated) console.log("MysteryClaw database schema ready.");
  } catch (err) {
    console.error("MysteryClaw database migration failed:", err.message);
  }
}

app.listen(PORT, () => {
  console.log(`MysteryClaw server running on port ${PORT}`);
});
