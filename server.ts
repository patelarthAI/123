import express from "express";
import { createServer as createViteServer } from "vite";
import WordExtractor from "word-extractor";
// Fallback for some environments
const Extractor = (WordExtractor as any).default || WordExtractor;
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV,
      hasApiKey: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY)
    });
  });

  // API Route for .doc extraction
  app.post("/api/extract-doc", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const extractor = new Extractor();
      const extracted = await extractor.extract(req.file.buffer);
      const text = extracted.getBody();

      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "Could not extract text from this .doc file." });
      }

      res.json({ text });
    } catch (error: any) {
      console.error("Error extracting .doc:", error);
      res.status(500).json({ error: error.message || "Failed to extract text from .doc file" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware loaded successfully");
    } catch (e) {
      console.error("Failed to load Vite middleware:", e);
    }
  } else {
    // Serve static files in production
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
