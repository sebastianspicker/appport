import { invoke } from "@tauri-apps/api/core";
import type {
  AppAction,
  AvailableApp,
  ConnectRequest,
  ConnectOutcome,
  NativeBootstrap,
  SignOutOutcome,
  SupportBundleResult,
  SupportDetails,
} from "./types";

export const native = {
  initialView: () => invoke<"apps" | "updates">("initial_view"),
  connect: (request: ConnectRequest) =>
    invoke<ConnectOutcome>("connect", { request }),
  bootstrap: () => invoke<NativeBootstrap>("bootstrap"),
  apps: (view: "apps" | "updates") =>
    invoke<AvailableApp[]>("list_apps", { view }),
  act: (appId: string) => invoke<AppAction>("request_action", { appId }),
  action: (actionId: string) => invoke<AppAction>("get_action", { actionId }),
  icon: (appId: string) => invoke<string | null>("load_app_icon", { appId }),
  signOut: () => invoke<SignOutOutcome>("sign_out"),
  supportDetails: () => invoke<SupportDetails>("support_details"),
  generateSupportBundle: (confirmedSupportIdentifiers: true) =>
    invoke<SupportBundleResult>("generate_support_bundle", {
      confirmedSupportIdentifiers,
    }),
  openSupportFolder: (): Promise<void> => invoke("open_support_folder"),
  openRelutionPortal: (): Promise<void> => invoke("open_relution_portal"),
};
