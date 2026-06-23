import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SessionCacheEntry, TranscriptMessage } from "./chatTypes";
import { appendAssistantDeltaToMessage } from "./app-state";

type BufferedAssistantDelta = {
	messageId: string;
	delta: string;
	field: "body" | "thinking";
	contentIndex: number;
};

const STREAM_RENDER_INTERVAL_MS = 50;

function applyBufferedAssistantDelta(
	transcript: TranscriptMessage[],
	bufferedDelta: BufferedAssistantDelta,
): TranscriptMessage[] {
	const messageIndex = transcript.findIndex((entry) => entry.id === bufferedDelta.messageId);
	if (messageIndex === -1) {
		return transcript;
	}

	const existingMessage = transcript[messageIndex];
	if (!existingMessage) {
		return transcript;
	}

	const nextTranscript = [...transcript];
	nextTranscript[messageIndex] = appendAssistantDeltaToMessage(
		existingMessage,
		bufferedDelta.delta,
		bufferedDelta.field,
		bufferedDelta.contentIndex,
	);
	return nextTranscript;
}

export function useBufferedAssistantDeltas(
	sessionCacheRef: RefObject<Map<string, SessionCacheEntry>>,
) {
	const [liveTranscriptOverrides, setLiveTranscriptOverrides] = useState<Map<string, TranscriptMessage[]>>(() => new Map());
	const bufferedAssistantDeltasRef = useRef<Map<string, BufferedAssistantDelta[]>>(new Map());
	const streamFlushTimerRef = useRef<number | null>(null);

	const clearBufferedAssistantDeltas = useCallback((sessionId?: string) => {
		if (sessionId) {
			bufferedAssistantDeltasRef.current.delete(sessionId);
			setLiveTranscriptOverrides((previous) => {
				if (!previous.has(sessionId)) {
					return previous;
				}

				const next = new Map(previous);
				next.delete(sessionId);
				return next;
			});
			return;
		}

		bufferedAssistantDeltasRef.current.clear();
		setLiveTranscriptOverrides((previous) => (previous.size === 0 ? previous : new Map()));
	}, []);

	const flushBufferedAssistantDeltas = useCallback((sessionId?: string) => {
		const drained = new Map<string, BufferedAssistantDelta[]>();
		if (sessionId) {
			const pending = bufferedAssistantDeltasRef.current.get(sessionId);
			if (pending && pending.length > 0) {
				drained.set(sessionId, pending);
				bufferedAssistantDeltasRef.current.delete(sessionId);
			}
		} else {
			for (const [bufferedSessionId, pending] of bufferedAssistantDeltasRef.current.entries()) {
				if (pending.length > 0) {
					drained.set(bufferedSessionId, pending);
				}
			}
			bufferedAssistantDeltasRef.current.clear();
		}

		if (drained.size === 0) {
			return;
		}

		setLiveTranscriptOverrides((previous) => {
			let next = previous;

			for (const [bufferedSessionId, pending] of drained.entries()) {
				const sourceTranscript =
					next.get(bufferedSessionId) ??
					sessionCacheRef.current.get(bufferedSessionId)?.transcript;
				if (!sourceTranscript) {
					const existingPending = bufferedAssistantDeltasRef.current.get(bufferedSessionId) ?? [];
					bufferedAssistantDeltasRef.current.set(bufferedSessionId, [...pending, ...existingPending]);
					continue;
				}

				let transcript = sourceTranscript;
				for (const bufferedDelta of pending) {
					transcript = applyBufferedAssistantDelta(transcript, bufferedDelta);
				}

				if (next === previous) {
					next = new Map(previous);
				}
				next.set(bufferedSessionId, transcript);
			}

			return next;
		});
	}, [sessionCacheRef]);

	const scheduleBufferedAssistantDeltaFlush = useCallback(() => {
		if (streamFlushTimerRef.current !== null) {
			return;
		}

		streamFlushTimerRef.current = window.setTimeout(() => {
			streamFlushTimerRef.current = null;
			flushBufferedAssistantDeltas();
		}, STREAM_RENDER_INTERVAL_MS);
	}, [flushBufferedAssistantDeltas]);

	const bufferAssistantDelta = useCallback((
		sessionId: string,
		bufferedDelta: BufferedAssistantDelta,
	) => {
		const nextPending = bufferedAssistantDeltasRef.current.get(sessionId) ?? [];
		nextPending.push(bufferedDelta);
		bufferedAssistantDeltasRef.current.set(sessionId, nextPending);
		scheduleBufferedAssistantDeltaFlush();
	}, [scheduleBufferedAssistantDeltaFlush]);

	useEffect(() => () => {
		if (streamFlushTimerRef.current !== null) {
			window.clearTimeout(streamFlushTimerRef.current);
			streamFlushTimerRef.current = null;
		}
	}, []);

	return {
		bufferedAssistantDeltasRef,
		liveTranscriptOverrides,
		bufferAssistantDelta,
		clearBufferedAssistantDeltas,
	};
}
