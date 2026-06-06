import { App } from "../App";
import { createRemoteWebRuntime } from "../runtime";

const runtime = createRemoteWebRuntime();

export function RemoteWebApp() {
	return <App runtime={runtime} />;
}
