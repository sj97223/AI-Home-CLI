export type ToolPreset = "shell" | "claude" | "openclaw" | "codex" | "gemini";

export interface SessionSpec {
  id: string;
  name: string;
  displayName: string;
  tool: ToolPreset;
  cwd: string;
  tmuxSession: string;
  sshUser?: string;
  sshHost?: string;
  sshPort?: number;
  createdAt: string;
  status: "active" | "dead";
  restored: boolean;
  lastActiveAt: string;
}

export interface AuthContext {
  email: string;
  issuedAt: number;
  expiresAt: number;
  scopes: string[];
}
