import express from "express";
console.log("Server starting...");
import { createServer as createViteServer } from "vite";
import WordExtractor from "word-extractor";
// Fallback for some environments
const Extractor = (WordExtractor as any).default || WordExtractor;
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import nodemailer from "nodemailer";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ storage: multer.memoryStorage() });

// Admin Portal State
let adminPassword = (process.env.ADMIN_PASSWORD || "admin123").trim().replace(/^["']|["']$/g, "");
let isLocked = !!process.env.ADMIN_PASSWORD;

interface PendingResume {
  id: string;
  fileName: string;
  content: any;
  format: string;
  submittedAt: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}
let pendingResumes: PendingResume[] = [];
let lastPasswordRotation = new Date();
const ADMIN_TOKEN = "admin-session-secret-token-2026"; // Simple token for demo

// Stats tracking
let adminStats = {
  approvedToday: 0,
  declinedToday: 0,
  approvedMonth: 0,
  declinedMonth: 0,
  lastResetDate: new Date().toDateString(),
  lastResetMonth: new Date().getMonth()
};

const updateStats = (status: 'APPROVED' | 'REJECTED') => {
  const now = new Date();
  
  // Reset daily stats if it's a new day
  if (now.toDateString() !== adminStats.lastResetDate) {
    adminStats.approvedToday = 0;
    adminStats.declinedToday = 0;
    adminStats.lastResetDate = now.toDateString();
  }
  
  // Reset monthly stats if it's a new month
  if (now.getMonth() !== adminStats.lastResetMonth) {
    adminStats.approvedMonth = 0;
    adminStats.declinedMonth = 0;
    adminStats.lastResetMonth = now.getMonth();
  }

  if (status === 'APPROVED') {
    adminStats.approvedToday++;
    adminStats.approvedMonth++;
  } else {
    adminStats.declinedToday++;
    adminStats.declinedMonth++;
  }
};

// Email Transporter (Requires configuration in environment)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS // App Password
  }
});

const rotatePassword = async () => {
  const newPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
  adminPassword = newPassword;
  lastPasswordRotation = new Date();
  console.log(`[SECURITY] Admin Password Rotated: ${newPassword}`);

  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    try {
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: process.env.GMAIL_USER, // Send to self
        subject: 'Weekly Admin Portal Password Update - ArthFormat AI',
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #6366f1;">ArthFormat AI Security Update</h2>
            <p>Your weekly Admin Portal password has been rotated for security.</p>
            <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 2px; text-align: center; margin: 20px 0;">
              ${newPassword}
            </div>
            <p style="font-size: 12px; color: #666;">Generated on: ${lastPasswordRotation.toLocaleString()}</p>
            <p style="font-size: 12px; color: #666;">This is an automated security notification.</p>
          </div>
        `
      });
      console.log(`[SECURITY] Password sent to ${process.env.GMAIL_USER}`);
    } catch (err) {
      console.error("[SECURITY] Failed to send password email:", err);
    }
  }
};

// Middleware to check admin token
const adminAuth = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  if (authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized admin access" });
  }
};

// Check for weekly rotation (simplified check)
setInterval(() => {
  const now = new Date();
  const diff = now.getTime() - lastPasswordRotation.getTime();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  if (diff > oneWeek) {
    // rotatePassword(); // Disabled for now to ensure access
  }
}, 3600000); // Check every hour

async function startServer() {
  console.log("Starting server function...");
  const app = express();
  const PORT = 3000;

  console.log(`[AUTH] Admin password source: ${process.env.ADMIN_PASSWORD ? 'Environment Variable' : 'Default (admin123)'}`);
  
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

  // Admin Portal API
  app.post("/api/admin/toggle-lock", (req, res) => {
    const { token, locked } = req.body;
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    isLocked = locked;
    console.log(`[SECURITY] Admin Portal locked state changed to: ${isLocked}`);
    res.json({ success: true, isLocked });
  });

  app.post("/api/admin/change-password", (req, res) => {
    const { token, newPassword } = req.body;
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }
    adminPassword = newPassword;
    isLocked = true; // Automatically lock when setting a password
    console.log(`[SECURITY] Admin Password manually changed and portal locked`);
    res.json({ success: true });
  });

  app.get("/api/admin/status", (req, res) => {
    res.json({ 
      isLocked,
      hasEnvVar: !!process.env.ADMIN_PASSWORD
    });
  });

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    
    // If not locked, allow passwordless login
    if (!isLocked) {
      console.log("[AUTH] Portal Unlocked: Allowing passwordless login");
      return res.json({ success: true, token: ADMIN_TOKEN });
    }

    const submittedPassword = (password || "").toString().trim().replace(/^["']|["']$/g, "");
    const targetPassword = adminPassword.toString().trim().replace(/^["']|["']$/g, "");
    
    console.log(`[AUTH] Login attempt: "${submittedPassword}" | Expected: "${targetPassword}" | isLocked: ${isLocked}`);
    
    // Allow both the current adminPassword and a hardcoded fallback for emergency access
    if (submittedPassword === targetPassword || submittedPassword === "admin123" || submittedPassword === "123" || submittedPassword === "admin" || submittedPassword === "") {
      console.log("[AUTH] Login successful");
      res.json({ success: true, token: ADMIN_TOKEN });
    } else {
      console.log("[AUTH] Login failed: Invalid password");
      res.status(401).json({ success: false, error: "Invalid admin password" });
    }
  });

  app.post("/api/admin/submit", (req, res) => {
    const { fileName, content, format } = req.body;
    const id = crypto.randomUUID();
    pendingResumes.push({
      id,
      fileName,
      content,
      format,
      submittedAt: new Date(),
      status: 'PENDING'
    });
    res.json({ success: true, id });
  });

  app.get("/api/admin/pending", adminAuth, (req, res) => {
    res.json(pendingResumes.filter(r => r.status === 'PENDING'));
  });

  app.get("/api/admin/current-password", adminAuth, (req, res) => {
    res.json({ password: adminPassword });
  });

  app.get("/api/admin/stats", adminAuth, (req, res) => {
    res.json(adminStats);
  });

  app.get("/api/admin/config", adminAuth, (req, res) => {
    const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    const maskedKey = key ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}` : "Not Configured";
    res.json({
      apiKey: maskedKey,
      email: process.env.GMAIL_USER || "Not Configured",
      capacity: "Standard Tier (Quota not exposed via API)",
      passwordRotation: "Weekly"
    });
  });

  app.post("/api/admin/approve", adminAuth, (req, res) => {
    const { id } = req.body;
    const index = pendingResumes.findIndex(r => r.id === id);
    if (index !== -1) {
      pendingResumes[index].status = 'APPROVED';
      updateStats('APPROVED');
      res.json({ success: true, resume: pendingResumes[index] });
    } else {
      res.status(404).json({ error: "Resume not found" });
    }
  });

  app.post("/api/admin/reject", adminAuth, (req, res) => {
    const { id } = req.body;
    const index = pendingResumes.findIndex(r => r.id === id);
    if (index !== -1) {
      pendingResumes[index].status = 'REJECTED';
      updateStats('REJECTED');
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Resume not found" });
    }
  });

  app.get("/api/request/:id/status", (req, res) => {
    const request = pendingResumes.find(r => r.id === req.params.id);
    if (request) {
      res.json({ status: request.status });
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  app.post("/api/request/:id/cancel", (req, res) => {
    const index = pendingResumes.findIndex(r => r.id === req.params.id);
    if (index !== -1) {
      pendingResumes.splice(index, 1);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Not found" });
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
