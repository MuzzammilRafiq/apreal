import type { RelayPairingStateMessage } from "@/lib/relay-auth";

export type ClientMessage =
  | { type: "prompt"; prompt: string; sessionId?: string | null }
  | { type: "abort"; sessionId: string }
  | { type: "delete_session"; sessionId: string }
  | { type: "load_session"; sessionId: string }
  | { type: "load_sessions_page"; offset?: number; limit?: number }
  | { type: "ping" };

export type TranscriptToolCall = {
  id: string;
  name: string;
  summary: string;
  status: "running" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
};

export type TranscriptThinkingSegment = {
  id: string;
  type: "thinking";
  content: string;
  contentIndex?: number;
  createdAt: number;
  updatedAt: number;
};

export type TranscriptTextSegment = {
  id: string;
  type: "text";
  content: string;
  contentIndex?: number;
  createdAt: number;
  updatedAt: number;
};

export type TranscriptToolCallSegment = TranscriptToolCall & {
  type: "tool_call";
  contentIndex?: number;
};

export type TranscriptMessageSegment =
  | TranscriptTextSegment
  | TranscriptThinkingSegment
  | TranscriptToolCallSegment;

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  body: string;
  thinking: string;
  toolCalls: TranscriptToolCall[];
  segments: TranscriptMessageSegment[];
  pending: boolean;
  createdAt: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  busy: boolean;
  model: string | null;
  messageCount: number;
  contextUsage: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  } | null;
};

export type SessionCacheEntry = {
  session: SessionSummary;
  transcript: TranscriptMessage[];
  transcriptLoaded: boolean;
};

export type ServerMessage =
  | { type: "connected"; clientId: string; message: string; tools?: string }
  | RelayPairingStateMessage
  | {
      type: "sessions_page";
      sessions: SessionSummary[];
      offset: number;
      limit: number;
      total: number;
    }
  | { type: "session_summary_updated"; session: SessionSummary }
  | {
      type: "session_created";
      session: SessionSummary;
      transcript: TranscriptMessage[];
    }
  | {
      type: "session_snapshot";
      session: SessionSummary;
      transcript: TranscriptMessage[];
    }
  | { type: "session_deleted"; sessionId: string }
  | {
      type: "assistant_delta";
      sessionId: string;
      messageId: string;
      delta: string;
      contentIndex: number;
    }
  | {
      type: "assistant_thinking_delta";
      sessionId: string;
      messageId: string;
      delta: string;
      contentIndex: number;
    }
  | { type: "error"; message: string; sessionId?: string }
  | { type: "pong" };
