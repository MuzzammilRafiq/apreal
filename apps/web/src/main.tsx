import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { scan } from "react-scan";

const container = document.getElementById("root");

if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_REACT_SCAN === "true") {
	scan({
		enabled: true,
	});
}

if (!container) {
	throw new Error("Missing root element.");
}

createRoot(container).render(<App />);