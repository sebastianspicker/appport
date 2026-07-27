export type GatewayErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTEGRATION_AUTHENTICATION"
  | "INTEGRATION_AUTHORIZATION"
  | "INTEGRATION_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "INVALID_DEPLOYMENT"
  | "LIVE_WRITES_DISABLED";

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
