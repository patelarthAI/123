import 'dotenv/config';
import express from "express";
console.log("Server starting...");
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

import { supabaseAdmin } from "./server/supabase.js";

const app = express();
const PORT = 3000;

async function setupApp() {
  console.log("Starting server setup...");
  
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  console.log("Express JSON middleware loaded with 50mb limit");

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV,
      hasApiKey: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY)
    });
  });

  // API Route for submitting a resume
  app.post("/api/submit", async (req, res) => {
    try {
      const { content, userId } = req.body;
      
      if (!content) {
        return res.status(400).json({ error: "Resume content is required" });
      }

      // 1. Save resume as pending
      const { data: resume, error: resumeError } = await supabaseAdmin
        .from('resumes')
        .insert([
          { user_id: userId, content, status: 'pending' }
        ])
        .select()
        .single();

      if (resumeError) throw resumeError;

      // 2. Log the action
      await supabaseAdmin
        .from('activity_logs')
        .insert([
          { user_id: userId, action: 'resume_submitted', details: { resume_id: resume.id } }
        ]);

      res.status(200).json({ message: "Resume submitted successfully", resume });
    } catch (error: any) {
      console.error("Error submitting resume:", error);
      res.status(500).json({ error: error.message || "Failed to submit resume" });
    }
  });

  const checkAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const pass = req.headers['x-admin-password'];
    const adminPassword = (process.env.APP_ADMIN_PASSWORD || 'admin123').trim();
    if (typeof pass === 'string' && pass.trim() === adminPassword) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  app.post("/api/admin/verify", (req, res) => {
    const { password } = req.body;
    const adminPassword = (process.env.APP_ADMIN_PASSWORD || 'admin123').trim();
    console.log("Login attempt - Received:", password, "Expected:", adminPassword);
    if (typeof password === 'string' && password.trim() === adminPassword) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid password" });
    }
  });

  // API Route for fetching pending resumes (Admin Dashboard)
  app.get("/api/resumes/pending", checkAdmin, async (req, res) => {
    try {
      const { data: resumes, error } = await supabaseAdmin
        .from('resumes')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.status(200).json({ resumes });
    } catch (error: any) {
      console.error("Error fetching pending resumes:", error);
      res.status(500).json({ error: error.message || "Failed to fetch pending resumes" });
    }
  });

  // API Route for approving a resume
  app.post("/api/approve", checkAdmin, async (req, res) => {
    try {
      const { resumeId } = req.body;

      if (!resumeId) {
        return res.status(400).json({ error: "Resume ID is required" });
      }

      // 1. Update status to approved
      const { data: resume, error: updateError } = await supabaseAdmin
        .from('resumes')
        .update({ status: 'approved' })
        .eq('id', resumeId)
        .select()
        .single();

      if (updateError) throw updateError;

      // 2. Log the approval
      await supabaseAdmin
        .from('activity_logs')
        .insert([
          { user_id: 'admin', action: 'resume_approved', details: { resume_id: resumeId } }
        ]);

      res.status(200).json({ message: "Resume approved successfully", resume });
    } catch (error: any) {
      console.error("Error approving resume:", error);
      res.status(500).json({ error: error.message || "Failed to approve resume" });
    }
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
    app.get("*all", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

try {
  await setupApp();
} catch (error) {
  console.error("Failed to setup app:", error);
  process.exit(1);
}

export default app;

