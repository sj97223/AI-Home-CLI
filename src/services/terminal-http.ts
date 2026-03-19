import { randomUUID } from "node:crypto";

/**
 * HTTP Terminal Service
 * Manages HTTP fallback terminal state for sessions
 */

export interface HttpTerminalEvent {
  cursor: number;
  type: "output";
  data: string;
  createdAt: string;
}

export interface HttpTerminal {
  terminalId: string;
  sessionId: string;
  lastSnapshot: string;
  closed: boolean;
  stale: boolean;
  staleReason: string | null;
  updatedAt: number;
  lastInputAt: number | null;
  lastError: string | null;
  nextExpectedSeq: number;
  acceptedInputs: Map<number, string>;
  nextCursor: number;
  events: HttpTerminalEvent[];
}

// In-memory store for HTTP terminals
const httpTerminals = new Map<string, HttpTerminal>();

export function createHttpTerminalRuntime(sessionId: string): HttpTerminal {
  return {
    terminalId: randomUUID().slice(0, 12),
    sessionId,
    lastSnapshot: "",
    closed: false,
    stale: false,
    staleReason: null,
    updatedAt: Date.now(),
    lastInputAt: null,
    lastError: null,
    nextExpectedSeq: 1,
    acceptedInputs: new Map<number, string>(),
    nextCursor: 0,
    events: []
  };
}

export function markTerminalStale(terminal: HttpTerminal, reason: string): void {
  terminal.stale = true;
  terminal.staleReason = reason;
  terminal.updatedAt = Date.now();
}

export function markSessionTerminalsStale(sessionId: string, reason: string): void {
  for (const terminal of httpTerminals.values()) {
    if (terminal.sessionId !== sessionId || terminal.closed || terminal.stale) continue;
    markTerminalStale(terminal, reason);
  }
}

export function touchHttpTerminalsForSession(sessionId: string): void {
  const now = Date.now();
  for (const terminal of httpTerminals.values()) {
    if (terminal.sessionId !== sessionId || terminal.closed || terminal.stale) continue;
    terminal.updatedAt = now;
  }
}

export function getHttpTerminal(terminalId: string): HttpTerminal | undefined {
  return httpTerminals.get(terminalId);
}

export function setHttpTerminal(terminalId: string, terminal: HttpTerminal): void {
  httpTerminals.set(terminalId, terminal);
}

export function deleteHttpTerminal(terminalId: string): boolean {
  return httpTerminals.delete(terminalId);
}

export function getHttpTerminalsForSession(sessionId: string): HttpTerminal[] {
  const terminals: HttpTerminal[] = [];
  for (const terminal of httpTerminals.values()) {
    if (terminal.sessionId === sessionId) {
      terminals.push(terminal);
    }
  }
  return terminals;
}

export function getAllHttpTerminals(): Map<string, HttpTerminal> {
  return httpTerminals;
}

// Cleanup stale terminals (called periodically)
export function cleanupStaleTerminals(): void {
  const now = Date.now();
  const staleTimeout = 5 * 60 * 1000; // 5 minutes
  for (const [terminalId, terminal] of httpTerminals.entries()) {
    if (terminal.closed || now - terminal.updatedAt > staleTimeout) {
      httpTerminals.delete(terminalId);
    }
  }
}
