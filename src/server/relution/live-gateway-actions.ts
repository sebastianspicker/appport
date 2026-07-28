import type { AppAction, PortalUser } from "@/domain/models";
import { type PersistedAction } from "@/server/persistence";
import { type getActionRepository } from "@/server/persistence/runtime";
import type { LiveRuntimeConfig } from "@/server/runtime-config";
import { decodeWrapper, numberField, optionalRecordField, stringField, type JsonRecord } from "./decoders";
import { RelutionClient } from "./client";

interface RelutionAction {
  uuid: string;
  state: string;
  type: string;
  creationDate: number;
  errorCode: string | null;
  appUuid: string | null;
  versionUuid: string | null;
  packageIdentifier: string | null;
}

const RELUTION_ACTION_TYPES = new Set(["DEPLOY_WINGET_APP", "DEPLOY_DESKTOP_APP", "DEPLOY_CLASSIC_APP"]);
const RELUTION_ACTION_STATES: Readonly<Record<string, AppAction["state"]>> = {
  NEW: "queued", PENDING: "queued", PUSH_SENT: "queued", DELIVERED_CANCELABLE: "sent", DELIVERED: "sent", DELIVERY_CONFIRMED: "sent", NOT_NOW: "deferred", EXECUTED: "verifying", ERROR: "failed", CANCELLED: "cancelled",
};

export interface LiveGatewayActionDependencies {
  config: LiveRuntimeConfig;
  client: RelutionClient;
  repositoryProvider: typeof getActionRepository;
  owner: (user: PortalUser) => { issuer: string; subject: string; relutionUsername: string };
  loadDeviceActions: (deviceId: string) => Promise<RelutionAction[]>;
  targetIsInstalled: (action: PersistedAction) => Promise<boolean>;
}

export class LiveGatewayActions {
  constructor(private readonly dependencies: LiveGatewayActionDependencies) {}

  async refreshAction(user: PortalUser, action: PersistedAction): Promise<PersistedAction> {
    if (action.state === "unknown") return this.recoverUnknown(user, action);
    if (action.state === "verifying") return this.verifyTarget(user, action);
    const correlated = await this.correlate(user, action);
    if (!correlated.relutionAction) return correlated.action;
    return this.recordRelutionState(user, correlated.action, correlated.relutionAction);
  }

  private async recoverUnknown(user: PortalUser, action: PersistedAction) {
    if (!(await this.dependencies.targetIsInstalled(action))) return action;
    return this.update(user, action, { state: "succeeded", event: "inventory_reconciled" });
  }

  private async verifyTarget(user: PortalUser, action: PersistedAction) {
    if (await this.dependencies.targetIsInstalled(action)) return this.update(user, action, { state: "succeeded", event: "inventory_verified" });
    if (!action.verificationDeadlineAt || Date.now() < Date.parse(action.verificationDeadlineAt)) return action;
    return this.update(user, action, { state: "unknown", errorCode: "INVENTORY_VERIFICATION_TIMEOUT", errorMessage: "The installed version could not be confirmed. Do not retry.", event: "inventory_verification_timed_out" });
  }

  private async correlate(user: PortalUser, action: PersistedAction) {
    if (action.relutionActionUuid) return { action, relutionAction: await this.loadAction(action) };
    const matches = await this.findCandidates(user, action);
    if (matches.length === 1) return { action: this.update(user, action, { relutionActionUuid: matches[0].uuid, event: "relution_action_correlated" }), relutionAction: matches[0] };
    const started = action.correlationStartedAt ? Date.parse(action.correlationStartedAt) : Date.parse(action.createdAt);
    if (Date.now() - started < this.dependencies.config.actionCorrelationMs) return { action };
    return { action: this.update(user, action, { state: "unknown", errorCode: matches.length > 1 ? "AMBIGUOUS_RELUTION_ACTION" : "RELUTION_ACTION_NOT_FOUND", errorMessage: "The submission status could not be confirmed. Do not retry.", event: "action_correlation_failed", details: { candidates: matches.length } }) };
  }

  private async loadAction(action: PersistedAction) {
    const { client } = this.dependencies;
    return decodeWrapper(await client.get(`/api/management/v1/devices/${encodeURIComponent(action.deviceId)}/actions/${encodeURIComponent(action.relutionActionUuid!)}`)).results.flatMap(decodeAction)[0];
  }

  private async findCandidates(user: PortalUser, action: PersistedAction) {
    const baseline = this.dependencies.repositoryProvider().listAuditEvents(this.dependencies.owner(user), action.id).find((event) => event.event === "deployment_submitted")?.details.baselineActionUuids;
    const baselineIds = new Set(typeof baseline === "string" && baseline ? baseline.split(",").filter(Boolean) : []);
    const submitted = Date.parse(action.submittedAt ?? action.createdAt) - 5_000;
    return (await this.dependencies.loadDeviceActions(action.deviceId)).filter((candidate) => !baselineIds.has(candidate.uuid) && candidate.creationDate >= submitted && (candidate.appUuid === action.appId || candidate.versionUuid === action.targetVersionId || candidate.packageIdentifier === action.packageIdentifier));
  }

  private async recordRelutionState(user: PortalUser, action: PersistedAction, relutionAction: RelutionAction): Promise<PersistedAction> {
    const mapped = mapRelutionState(relutionAction.state);
    if (mapped !== "verifying") return this.update(user, action, { state: mapped, relutionState: relutionAction.state, errorCode: mapped === "failed" ? relutionAction.errorCode ?? "RELUTION_ACTION_ERROR" : null, errorMessage: mapped === "failed" ? "Relution reported that the installation failed." : null, event: "relution_state_observed" });
    const verificationDeadlineAt = action.verificationDeadlineAt ?? new Date(Date.now() + this.dependencies.config.actionVerificationMs).toISOString();
    return this.refreshAction(user, this.update(user, action, { state: "verifying", relutionState: relutionAction.state, verificationDeadlineAt, event: "relution_executed" }));
  }

  private update(user: PortalUser, action: PersistedAction, changes: Record<string, unknown>) {
    return this.dependencies.repositoryProvider().updateAction({ owner: this.dependencies.owner(user), id: action.id, ...changes }) ?? action;
  }
}

function decodeAction(value: JsonRecord): RelutionAction[] {
  const type = stringField(value, "type");
  if (!RELUTION_ACTION_TYPES.has(type)) return [];
  const details = optionalRecordField(value, "details");
  const code = numberField(value, "errorCode");
  return [{ uuid: stringField(value, "uuid"), state: stringField(value, "state"), type, creationDate: numberField(value, "creationDate") ?? 0, errorCode: code === null ? null : `RELUTION_${code}`, appUuid: details ? stringField(details, "appUuid", false) : null, versionUuid: details ? stringField(details, "versionUuid", false) : null, packageIdentifier: details ? stringField(details, "appInternalName", false) : null }];
}

export function mapRelutionState(state: string): AppAction["state"] {
  return RELUTION_ACTION_STATES[state] ?? "unknown";
}
