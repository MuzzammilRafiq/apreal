import { createRoot } from "react-dom/client";
import { LocalWebApp } from "./local/LocalWebApp";
import { RemoteWebApp } from "./remote/RemoteWebApp";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";
import { scan } from "react-scan";

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

createRoot(container).render(
	<TooltipProvider>
		<App />
	</TooltipProvider>,
);
