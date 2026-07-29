import { invoke } from "@tauri-apps/api/core";
import type {
  AppAction,
  AvailableApp,
  ConnectOutcome,
  NativeBootstrap,
  SignOutOutcome,
} from "./models";

export const native = {
  initialView: () => invoke<"apps" | "updates">("initial_view"),
  connect: (relutionUsername: string, accessToken: string) =>
    invoke<ConnectOutcome>("connect", { relutionUsername, accessToken }),
  bootstrap: () => invoke<NativeBootstrap>("bootstrap"),
  apps: (view: "apps" | "updates") =>
    invoke<AvailableApp[]>("list_apps", { view }),
  act: (appId: string) => invoke<AppAction>("request_action", { appId }),
  action: (actionId: string) => invoke<AppAction>("get_action", { actionId }),
  icon: (appId: string) => invoke<string | null>("load_app_icon", { appId }),
  signOut: () => invoke<SignOutOutcome>("sign_out"),
  openRelutionPortal: (): Promise<void> => invoke("open_relution_portal"),
};
