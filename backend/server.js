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

import { processPayouts } from "./_payout.js";

const app = express();

const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
  "null", // local file:// development
]);

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  ...configuredOrigins,
  ...LOCAL_ORIGINS,
]);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "100kb" }));

const publicLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const guessLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(publicLimit);

// Pi agent endpoints
app.use("/chat", chatLimit, chatRoute);
app.use("/guess", guessLimit, guessRoute);

// Platform endpoints
app.use("/holdings", holdingsRoute);
app.use("/stats", statsRoute);
app.use("/discoveries", discoveriesRoute);
app.use("/autonomous", autonomousRoute);
app.use("/prize", prizeRoute);

app.get("/", (req, res) => {
  res.json({
    name: "PiVerse",
    tagline: "Infrastructure for Adversarial AI Experiences",
    agent: "Pi v4.0.1",
    endpoints: {
      "POST /chat":          "talk to Pi",
      "POST /guess":         "submit the forgotten word",
      "POST /holdings":      "verify wallet token holdings",
      "GET  /stats":         "live platform stats",
      "GET  /discoveries":   "community-saved fragments",
      "POST /discoveries":   "submit a fragment to the public feed",
      "GET  /autonomous":    "Pi's self-generated posts (live feed)",
      "POST /autonomous":    "agent-runtime pushes new post (requires x-agent-key)",
      "GET  /prize":         "current prize epoch status",
      "GET  /prize/history": "past epoch payouts (transparency)"
    }
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`PiVerse server running on port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════════
// AUTOMATIC PRIZE PAYOUT SCHEDULER
// ═══════════════════════════════════════════════════════════════
// Every 10 minutes, check for closed epochs that need paying out.
// processPayouts() is a no-op unless PAYOUTS_ENABLED=true, so this
// is safe to leave running even before treasury is funded.
// ═══════════════════════════════════════════════════════════════
const PAYOUT_CHECK_MS = 10 * 60 * 1000; // 10 min

async function payoutTick() {
  try {
    const result = await processPayouts();
    if (result.processed > 0) {
      console.log(`[payout-scheduler] processed ${result.processed} epoch(s)`);
    }
  } catch (e) {
    console.error("[payout-scheduler] error:", e.message);
  }
}

// run shortly after boot, then on interval
setTimeout(payoutTick, 30 * 1000);
setInterval(payoutTick, PAYOUT_CHECK_MS);
