import { useCallback, useEffect, useRef, type RefObject } from "react";

type PendingConnectionWaiter = {
	resolve(): void;
	reject(error: Error): void;
	timer: number;
};

export function useConnectionWaiters(
	connectedRef: RefObject<boolean>,
	streamRequiredMessage: string,
) {
	const pendingConnectionResolversRef = useRef(new Set<PendingConnectionWaiter>());
	const resolvePendingConnectionsRef = useRef<() => void>(() => {});

	const resolvePendingConnections = useCallback(() => {
		for (const waiter of pendingConnectionResolversRef.current) {
			window.clearTimeout(waiter.timer);
			waiter.resolve();
		}
		pendingConnectionResolversRef.current.clear();
	}, []);

	useEffect(() => {
		resolvePendingConnectionsRef.current = resolvePendingConnections;
	}, [resolvePendingConnections]);

	useEffect(() => () => {
		for (const waiter of pendingConnectionResolversRef.current) {
			window.clearTimeout(waiter.timer);
			waiter.reject(new Error(streamRequiredMessage));
		}
		pendingConnectionResolversRef.current.clear();
	}, [streamRequiredMessage]);

	const waitForConnectionAttempt = useCallback((timeoutMs = 8_000) => {
		if (connectedRef.current) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			let waiter: PendingConnectionWaiter;
			const timer = window.setTimeout(() => {
				pendingConnectionResolversRef.current.delete(waiter);
				resolve();
			}, timeoutMs);
			waiter = {
				timer,
				resolve,
				reject: () => {
					pendingConnectionResolversRef.current.delete(waiter);
					resolve();
				},
			};
			pendingConnectionResolversRef.current.add(waiter);
		});
	}, [connectedRef]);

	const waitForFreshConnection = useCallback((timeoutMs = 8_000) => new Promise<void>((resolve, reject) => {
		let waiter: PendingConnectionWaiter;
		const timer = window.setTimeout(() => {
			pendingConnectionResolversRef.current.delete(waiter);
			reject(new Error(streamRequiredMessage));
		}, timeoutMs);
		waiter = {
			timer,
			resolve,
			reject,
		};
		pendingConnectionResolversRef.current.add(waiter);
	}), [streamRequiredMessage]);

	return {
		resolvePendingConnectionsRef,
		waitForConnectionAttempt,
		waitForFreshConnection,
	};
}
