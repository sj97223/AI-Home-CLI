import { Router } from "express";
import { appConfig } from "../config.js";

const router = Router();

// GET /api/options
router.get("/", (_req, res) => {
  res.json({
    allowedRoots: appConfig.allowedRoots,
    defaultCwd: appConfig.allowedRoots[0] || process.cwd(),
    agentPresets: [
      { id: "shell", label: "Shell", command: null },
      { id: "claude", label: "Claude CLI", command: "claude" },
      { id: "openclaw", label: "OpenClaw", command: "openclaw" },
      { id: "codex", label: "Codex CLI", command: "codex" },
      { id: "gemini", label: "Gemini CLI", command: "gemini" },
      { id: "custom", label: "Custom Command", command: null }
    ]
  });
});

export default router;
