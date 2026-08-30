import type { Dispatch, SetStateAction } from "react";
import type { AvailableApp } from "../native-bridge/types";

export type ConfirmationRequest = {
  application: AvailableApp;
  opener: HTMLElement;
};

export type ConfirmationHandler = Dispatch<
  SetStateAction<ConfirmationRequest | undefined>
>;
