import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalWebApp } from "./local/LocalWebApp";
import { RemoteWebApp } from "./remote/RemoteWebApp";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";
import { scan } from "react-scan";
import { Toaster } from "@/components/ui/sonner";

declare const __APREAL_WEB_TARGET__: "local" | "remote";

const container = document.getElementById("root");

if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_REACT_SCAN === "true") {
	scan({
		enabled: true,
	});
}

if (!container) {
	throw new Error("Missing root element.");
}

const App = __APREAL_WEB_TARGET__ === "remote" ? RemoteWebApp : LocalWebApp;
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 10_000,
			retry: 1,
		},
	},
});

createRoot(container).render(
	<QueryClientProvider client={queryClient}>
		<TooltipProvider>
			<App />
			<Toaster />
		</TooltipProvider>
	</QueryClientProvider>,
);
