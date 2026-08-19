import { invoke } from "@tauri-apps/api/core";
import type {
  AppAction,
  AvailableApp,
  AuthCapabilities,
  ConnectRequest,
  ConnectOutcome,
  NativeBootstrap,
  SignOutOutcome,
} from "./models";

export const native = {
  initialView: () => invoke<"apps" | "updates">("initial_view"),
  connect: (request: ConnectRequest) =>
    invoke<ConnectOutcome>("connect", { request }),
  authCapabilities: () => invoke<AuthCapabilities>("auth_capabilities"),
  bootstrap: () => invoke<NativeBootstrap>("bootstrap"),
  apps: (view: "apps" | "updates") =>
    invoke<AvailableApp[]>("list_apps", { view }),
  act: (appId: string) => invoke<AppAction>("request_action", { appId }),
  action: (actionId: string) => invoke<AppAction>("get_action", { actionId }),
  icon: (appId: string) => invoke<string | null>("load_app_icon", { appId }),
  signOut: () => invoke<SignOutOutcome>("sign_out"),
  openRelutionPortal: (): Promise<void> => invoke("open_relution_portal"),
};
