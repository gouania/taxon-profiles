import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { analyzeTaxon, compareTaxa } from "./services/geminiService.server";

const MAX_INPUT_LENGTH = 150;
const MIN_COMPARE_TAXA = 2;
const MAX_COMPARE_TAXA = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_TRACKED_IPS = 2_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const sanitizeForLog = (value: string): string =>
  value.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").slice(0, 120);

const redactSecrets = (text: string): string =>
  text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]")
    .replace(/(api[_-]?key\s*[:=]\s*)['"]?[^\s'"]+/gi, "$1[redacted]");

const extractClientIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
};

const apiRateLimiter = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  const ip = extractClientIp(req);
  const existing = rateLimitStore.get(ip);

  if (!existing || now >= existing.resetAt) {
    if (rateLimitStore.size >= MAX_TRACKED_IPS) {
      for (const [key, entry] of rateLimitStore.entries()) {
        if (now >= entry.resetAt) {
          rateLimitStore.delete(key);
        }
      }
      if (rateLimitStore.size >= MAX_TRACKED_IPS) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (oldestKey) rateLimitStore.delete(oldestKey);
      }
    }
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: "Too many requests. Please wait a moment before trying again.",
    });
  }

  existing.count += 1;
  return next();
};

const validateOptionalLocality = (
  raw: unknown
): { value?: string; error?: string } => {
  if (raw === undefined || raw === null || raw === "") {
    return { value: undefined };
  }
  if (typeof raw !== "string") {
    return { error: "Invalid locality parameter; expected a text string." };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { value: undefined };
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return {
      error: `Locality must be ${MAX_INPUT_LENGTH} characters or fewer.`,
    };
  }
  return { value: trimmed };
};

const getSafeErrorResponse = (error: unknown): { status: number; message: string } => {
  const errObj = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  const rawMessage = typeof errObj?.message === "string" ? errObj.message : "";
  const lower = rawMessage.toLowerCase();
  const explicitStatus =
    typeof errObj?.status === "number"
      ? errObj.status
      : typeof errObj?.statusCode === "number"
        ? errObj.statusCode
        : undefined;

  if (lower.includes("api key is missing") || explicitStatus === 401) {
    return {
      status: 401,
      message: "API key is missing in the server environment.",
    };
  }
  if (
    explicitStatus === 403 ||
    lower.includes("permission_denied") ||
    lower.includes("api_key_invalid")
  ) {
    return {
      status: 403,
      message: "Upstream API rejected the server credentials or permissions.",
    };
  }
  if (
    explicitStatus === 429 ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota")
  ) {
    return {
      status: 429,
      message: "Upstream API rate limit or quota reached. Please retry shortly.",
    };
  }
  if (explicitStatus === 404 || lower.includes("not_found")) {
    return {
      status: 404,
      message: "Requested AI model or upstream resource was not found.",
    };
  }
  if (explicitStatus === 502 || lower.includes("malformed json")) {
    return {
      status: 502,
      message: "Upstream AI returned an incomplete or malformed JSON response.",
    };
  }
  if (explicitStatus === 503 || lower.includes("unavailable")) {
    return {
      status: 503,
      message: "Upstream AI service is temporarily unavailable.",
    };
  }
  if (explicitStatus === 400) {
    return {
      status: 400,
      message: redactSecrets(rawMessage) || "Invalid request parameters.",
    };
  }

  return {
    status: 500,
    message: "An unexpected server-side error occurred while processing the request.",
  };
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable("x-powered-by");

  // Baseline security headers compatible with embedded preview iframes
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // Bounded JSON Body Parser for incoming search parameters
  app.use(express.json({ limit: "16kb" }));

  // Gracefully reject malformed or oversized JSON payloads
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request payload is too large." });
    }
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "Malformed JSON request body." });
    }
    return next(err);
  });

  // API Routes MUST go BEFORE the Vite / Static middleware setup
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/analyze", apiRateLimiter, async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Invalid request body." });
      }

      const { taxonName, locality } = req.body as Record<string, unknown>;
      if (typeof taxonName !== "string") {
        return res.status(400).json({ error: "Missing or invalid taxonName in request body." });
      }

      const trimmedTaxon = taxonName.trim();
      if (!trimmedTaxon) {
        return res.status(400).json({ error: "Taxon name cannot be blank." });
      }
      if (trimmedTaxon.length > MAX_INPUT_LENGTH) {
        return res.status(400).json({
          error: `Taxon name must be ${MAX_INPUT_LENGTH} characters or fewer.`,
        });
      }

      const localityResult = validateOptionalLocality(locality);
      if (localityResult.error) {
        return res.status(400).json({ error: localityResult.error });
      }

      console.log(
        `Received request to analyze taxon: "${sanitizeForLog(trimmedTaxon)}" (locality: ${
          localityResult.value ? sanitizeForLog(localityResult.value) : "None"
        })`
      );
      const data = await analyzeTaxon(trimmedTaxon, localityResult.value);
      return res.json(data);
    } catch (error: unknown) {
      const safeErr = getSafeErrorResponse(error);
      console.error(
        "Express /api/analyze error:",
        redactSecrets(error instanceof Error ? error.message : String(error))
      );
      return res.status(safeErr.status).json({ error: safeErr.message });
    }
  });

  app.post("/api/compare", apiRateLimiter, async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Invalid request body." });
      }

      const { names, locality } = req.body as Record<string, unknown>;
      if (!Array.isArray(names)) {
        return res.status(400).json({ error: "Missing or invalid names list in request body." });
      }

      if (names.length < MIN_COMPARE_TAXA || names.length > MAX_COMPARE_TAXA) {
        return res.status(400).json({
          error: `Please provide between ${MIN_COMPARE_TAXA} and ${MAX_COMPARE_TAXA} taxa to compare.`,
        });
      }

      const cleanedNames: string[] = [];
      const seenNormalized = new Set<string>();
      for (const item of names) {
        if (typeof item !== "string") {
          return res.status(400).json({ error: "Each taxon name must be a text string." });
        }
        const trimmed = item.trim();
        if (!trimmed) {
          return res.status(400).json({ error: "Taxon names in comparison cannot be blank." });
        }
        if (trimmed.length > MAX_INPUT_LENGTH) {
          return res.status(400).json({
            error: `Each taxon name must be ${MAX_INPUT_LENGTH} characters or fewer.`,
          });
        }
        const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
        if (seenNormalized.has(normalized)) {
          return res.status(400).json({
            error: "Comparison requires distinct taxon names.",
          });
        }
        seenNormalized.add(normalized);
        cleanedNames.push(trimmed);
      }

      const localityResult = validateOptionalLocality(locality);
      if (localityResult.error) {
        return res.status(400).json({ error: localityResult.error });
      }

      console.log(
        `Received request to compare taxa: ${JSON.stringify(
          cleanedNames.map(sanitizeForLog)
        )} (locality: ${localityResult.value ? sanitizeForLog(localityResult.value) : "None"})`
      );
      const data = await compareTaxa(cleanedNames, localityResult.value);
      return res.json(data);
    } catch (error: unknown) {
      const safeErr = getSafeErrorResponse(error);
      console.error(
        "Express /api/compare error:",
        redactSecrets(error instanceof Error ? error.message : String(error))
      );
      return res.status(safeErr.status).json({ error: safeErr.message });
    }
  });

  // Setup Vite Dev Server Middleware or Static Production Build Serving
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully started on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start the Express server:", err);
  process.exit(1);
});
