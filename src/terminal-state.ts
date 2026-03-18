/**
 * Terminal Connection State Machine
 *
 * Unified state definitions for WebSocket and HTTP terminal connections.
 */

// Connection mode (transport layer)
export type ConnectionMode = "ws" | "http";

// Terminal connection states
export enum TerminalState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  ATTACHED_WS = "attached_ws",
  ATTACHED_HTTP = "attached_http",
  STALE = "stale",
  RECONNECTING = "reconnecting",
  CLOSED = "closed"
}

// Terminal status payload returned to clients
export interface TerminalStatus {
  state: TerminalState;
  mode: ConnectionMode;
  reason?: string;
  lastState?: TerminalState;
  terminalId?: string;
  sessionId?: string;
  cols?: number;
  rows?: number;
}

// Server-side terminal runtime interfaces
export interface WsTerminalRuntime {
  terminalId: string;
  sessionId: string;
  socket: unknown; // Socket instance
  cols: number;
  rows: number;
  lastInputAt: number;
  lastActivityAt: number;
  stale: boolean;
  staleReason: string | null;
}

export interface HttpTerminalRuntime {
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

export interface HttpTerminalEvent {
  cursor: number;
  type: "output";
  data: string;
  createdAt: string;
}

// State transition helpers
export function isAttachedState(state: TerminalState): boolean {
  return state === TerminalState.ATTACHED_WS || state === TerminalState.ATTACHED_HTTP;
}

export function isStaleState(state: TerminalState): boolean {
  return state === TerminalState.STALE;
}

export function isReconnectingState(state: TerminalState): boolean {
  return state === TerminalState.RECONNECTING;
}

export function canReconnect(state: TerminalState): boolean {
  return state === TerminalState.STALE || state === TerminalState.CLOSED;
}

// State to mode mapping
export function getModeFromState(state: TerminalState): ConnectionMode | null {
  switch (state) {
    case TerminalState.ATTACHED_WS:
      return "ws";
    case TerminalState.ATTACHED_HTTP:
      return "http";
    default:
      return null;
  }
}
