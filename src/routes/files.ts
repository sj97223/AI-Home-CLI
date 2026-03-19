import { Router } from "express";
import multer from "multer";
import { readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { ensureSafeDirectory, resolveSafePath } from "../file-policy.js";

const router = Router();
const upload = multer({ dest: "uploads/" });

// GET /api/files/list
router.get("/list", async (req, res) => {
  try {
    const target = await ensureSafeDirectory(String(req.query.path || ""));
    const entries = await readdir(target, { withFileTypes: true });
    res.json({
      path: target,
      entries: entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file"
      }))
    });
  } catch (err) {
    res.status(400).json({ error: "invalid_path", detail: String(err) });
  }
});

// POST /api/files/upload
router.post("/upload", upload.single("file"), (req, res) => {
  res.status(201).json({ ok: true, file: req.file?.originalname });
});

// GET /api/files/download
router.get("/download", async (req, res) => {
  try {
    const safe = await resolveSafePath(String(req.query.path || ""));
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(safe)}"`);
    createReadStream(safe).pipe(res);
  } catch (err) {
    res.status(400).json({ error: "invalid_download_path", detail: String(err) });
  }
});

export default router;
