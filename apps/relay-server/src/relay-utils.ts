// Compatibility barrel that re-exports the split relay helpers from their
// current module layout.
export { DEFAULT_PORT, RELAY_SSE_HEARTBEAT_INTERVAL_MS } from "./relay/constants.ts";
export { createCorsHeaders, resolveRequestOrigin } from "./relay/cors.ts";
export { authorizeRelayConnection, mapRelayConnectionErrorStatus, mapRelayProxyErrorStatus, readClientTokenFromProxyRequest, readOptionalBearerToken, resolveClientRelayTarget, validateAgentServerUrl } from "./relay/authorization.ts";
export { getErrorMessage, readRequestBody, sendJson, sendText, setHeaders } from "./relay/http.ts";
export { isObjectRecord, parseAgentAuthRequest, parseClientAuthRequest, parseRelayAgentMessage, parseRelayConnectionRequest, readStringField, readUrlField } from "./relay/parsing.ts";
export { buildAgentAuthResponse, buildClientAuthResponse, buildClientHeartbeatResponse, buildHealthPayload } from "./relay/responses.ts";
export { createSseChunk, createSseComment, createSseHeaders } from "./relay/sse.ts";
