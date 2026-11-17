import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { analyzeTaxon, compareTaxa } from "./services/geminiService.server";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON Body Parser for handling incoming search parameters
  app.use(express.json());

  // API Routes MUST go BEFORE the Vite / Static middleware setup
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { taxonName, locality } = req.body;
      if (!taxonName || typeof taxonName !== "string") {
        return res.status(400).json({ error: "Missing or invalid taxonName in request body." });
      }

      console.log(`Received request to analyze taxon: "${taxonName}" (locality: ${locality || "None"})`);
      const data = await analyzeTaxon(taxonName, locality || undefined);
      return res.json(data);
    } catch (error: any) {
      console.error("Express /api/analyze error:", error);
      return res.status(500).json({ error: error.message || "An unexpected server-side error occurred." });
    }
  });

  app.post("/api/compare", async (req, res) => {
    try {
      const { names, locality } = req.body;
      if (!names || !Array.isArray(names) || names.length === 0) {
        return res.status(400).json({ error: "Missing or invalid names list in request body." });
      }

      console.log(`Received request to compare taxa: ${JSON.stringify(names)} (locality: ${locality || "None"})`);
      const data = await compareTaxa(names, locality || undefined);
      return res.json(data);
    } catch (error: any) {
      console.error("Express /api/compare error:", error);
      return res.status(500).json({ error: error.message || "An unexpected server-side error occurred." });
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
    app.get("*all", (req, res) => {
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
