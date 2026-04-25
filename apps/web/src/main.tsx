import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { scan } from "react-scan";
const container = document.getElementById("root");

scan({
  enabled: true,
}); 

if (!container) {
	throw new Error("Missing root element.");
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);