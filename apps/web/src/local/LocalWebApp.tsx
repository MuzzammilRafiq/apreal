import { App } from "../App";
import { createLocalWebRuntime } from "../runtime";

const runtime = createLocalWebRuntime();

export function LocalWebApp() {
	return <App runtime={runtime} />;
}
