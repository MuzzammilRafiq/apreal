import { useCallback, useEffect, useState } from "react";
import {
	navigateToRoute,
	readCurrentRoute,
	readSelectedJobIdFromRoute,
	type AppRoute,
} from "./app-state";
import { coerceRouteForCapabilities, type SettingsSectionId, type WebCapabilities } from "./runtime";

type UseAppRoutingOptions = {
	capabilities: WebCapabilities;
	onOpenJobRuns: (jobId: string) => void;
};

export function useAppRouting({ capabilities, onOpenJobRuns }: UseAppRoutingOptions) {
	const [route, setRoute] = useState<AppRoute>(() => coerceRouteForCapabilities(readCurrentRoute(), capabilities));
	const [requestedSettingsSection, setRequestedSettingsSection] = useState<SettingsSectionId | null>(null);

	useEffect(() => {
		const handlePopState = () => {
			setRoute(coerceRouteForCapabilities(readCurrentRoute(), capabilities));
		};

		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, [capabilities]);

	useEffect(() => {
		const currentRoute = readCurrentRoute();
		const supportedRoute = coerceRouteForCapabilities(currentRoute, capabilities);
		if (supportedRoute !== currentRoute) {
			navigateToRoute(supportedRoute);
		}
		setRoute(supportedRoute);
	}, [capabilities]);

	const handleRouteChange = useCallback((nextRoute: AppRoute) => {
		const supportedRoute = coerceRouteForCapabilities(nextRoute, capabilities);
		navigateToRoute(supportedRoute);
		setRoute(supportedRoute);
	}, [capabilities]);

	const handleOpenJob = useCallback((jobId: string) => {
		navigateToRoute("jobs", { jobId });
		setRoute(coerceRouteForCapabilities("jobs", capabilities));
		onOpenJobRuns(jobId);
	}, [capabilities, onOpenJobRuns]);

	const handleBackToJobsPanel = useCallback(() => {
		setRequestedSettingsSection("jobs");
		const supportedRoute = coerceRouteForCapabilities("settings", capabilities);
		navigateToRoute(supportedRoute);
		setRoute(supportedRoute);
	}, [capabilities]);

	return {
		route,
		selectedJobId: route === "jobs" ? readSelectedJobIdFromRoute() : null,
		requestedSettingsSection,
		handleRouteChange,
		handleOpenJob,
		handleBackToJobsPanel,
		consumeRequestedSettingsSection: () => setRequestedSettingsSection(null),
	};
}
