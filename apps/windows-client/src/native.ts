import { invoke } from "@tauri-apps/api/core";
import type {
  AppAction,
  AvailableApp,
  InstalledApplication,
  NativeBootstrap,
  SignOutOutcome,
} from "./models";

export const native = {
  initialView: () => invoke<"apps" | "updates">("initial_view"),
  beginConnect: () => invoke<{ requestId: string }>("begin_connect"),
  bootstrap: () => invoke<NativeBootstrap>("bootstrap"),
  apps: (view: "apps" | "updates") =>
    invoke<AvailableApp[]>("list_apps", { view }),
  installed: () => invoke<InstalledApplication[]>("list_installed"),
  act: (appId: string) => invoke<AppAction>("request_action", { appId }),
  action: (actionId: string) =>
    invoke<AppAction>("get_action", { actionId }),
  icon: (appId: string) =>
    invoke<string | null>("load_app_icon", { appId }),
  signOut: () => invoke<SignOutOutcome>("sign_out"),
};
