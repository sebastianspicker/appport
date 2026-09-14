/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect -- identity-bound native requests require synchronous invalidation fencing. */
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import { native } from "../native-bridge/native";
import type {
  NativeBootstrap,
  SupportBundleResult,
  SupportDetails,
} from "../native-bridge/types";
import { formatSupportBytes, formatSupportDetails } from "./SupportDetails";

type DetailsForIdentity = { identity: string; value: SupportDetails };

export function useSupportWorkflow(bootstrap: NativeBootstrap, locale: Locale) {
  const copy = copyFor(locale);
  const identity = `${bootstrap.user.displayName}\u0000${bootstrap.device.name}`;
  const identityRef = useRef(identity);
  const detailsRef = useRef<DetailsForIdentity | null>(null);
  const attemptedIdentityRef = useRef<string | null>(null);
  const pendingRef = useRef<
    { identity: string; request: Promise<SupportDetails> } | undefined
  >(undefined);
  const generatingRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const [details, setDetails] = useState<DetailsForIdentity | null>(null);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [bundle, setBundle] = useState<SupportBundleResult>();
  const [confirming, setConfirming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  identityRef.current = identity;
  const visibleDetails =
    details?.identity === identity ? details.value : undefined;

  useEffect(() => {
    detailsRef.current = null;
    attemptedIdentityRef.current = null;
    pendingRef.current = undefined;
    generatingRef.current = false;
    setDetails(null);
    setStatus(undefined);
    setError(undefined);
    setBundle(undefined);
    setConfirming(false);
    setIsGenerating(false);
  }, [identity]);

  const loadDetails = useCallback(
    async (explicit = false): Promise<SupportDetails | undefined> => {
      const requestedIdentity = identityRef.current;
      const cached = detailsRef.current;
      if (cached?.identity === requestedIdentity) return cached.value;
      if (!explicit && attemptedIdentityRef.current === requestedIdentity)
        return undefined;
      const pending = pendingRef.current;
      if (pending?.identity === requestedIdentity) return pending.request;
      attemptedIdentityRef.current = requestedIdentity;
      setError(undefined);
      setStatus(copy.supportLoading);
      const request = native
        .supportDetails()
        .then((value) => {
          if (identityRef.current === requestedIdentity) {
            const next = { identity: requestedIdentity, value };
            detailsRef.current = next;
            setDetails(next);
            setStatus(undefined);
          }
          return value;
        })
        .catch((reason: unknown) => {
          if (identityRef.current === requestedIdentity) {
            setStatus(undefined);
            setError(copy.supportLoadFailed);
          }
          throw reason;
        })
        .finally(() => {
          if (pendingRef.current?.request === request)
            pendingRef.current = undefined;
        });
      pendingRef.current = { identity: requestedIdentity, request };
      return request;
    },
    [copy.supportLoadFailed, copy.supportLoading],
  );

  const closeConfirmation = useCallback(() => setConfirming(false), []);
  const copyDetails = useCallback(async () => {
    const requestedIdentity = identityRef.current;
    try {
      const value = await loadDetails(true);
      if (!value || identityRef.current !== requestedIdentity) return;
      await writeText(formatSupportDetails(copy, value));
      if (identityRef.current === requestedIdentity) {
        setError(undefined);
        setStatus(copy.supportCopied);
      }
    } catch {
      if (identityRef.current === requestedIdentity) {
        setStatus(undefined);
        setError(copy.supportCopyFailed);
      }
    }
  }, [copy, loadDetails]);
  const requestBundle = useCallback(
    async (opener: HTMLElement | null) => {
      const requestedIdentity = identityRef.current;
      openerRef.current = opener;
      detailsRef.current = null;
      attemptedIdentityRef.current = null;
      try {
        const value = await loadDetails(true);
        if (value && identityRef.current === requestedIdentity)
          setConfirming(true);
      } catch {
        /* loadDetails provides the localized error. */
      }
    },
    [loadDetails],
  );
  const generateBundle = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    const requestedIdentity = identityRef.current;
    closeConfirmation();
    setError(undefined);
    setStatus(copy.supportGenerating);
    setIsGenerating(true);
    try {
      const result = await native.generateSupportBundle(true);
      if (identityRef.current === requestedIdentity) {
        setBundle(result);
        setStatus(
          copy.supportBundleCreated
            .replace("{name}", result.bundleFileName)
            .replace("{size}", formatSupportBytes(locale, result.bytes)),
        );
      }
    } catch {
      if (identityRef.current === requestedIdentity) {
        setStatus(undefined);
        setError(copy.supportGenerationFailed);
      }
    } finally {
      generatingRef.current = false;
      if (identityRef.current === requestedIdentity) setIsGenerating(false);
    }
  }, [closeConfirmation, copy, locale]);
  const openFolder = useCallback(async () => {
    setError(undefined);
    try {
      await native.openSupportFolder();
    } catch {
      setError(copy.supportFolderFailed);
    }
  }, [copy.supportFolderFailed]);
  return {
    bundle,
    closeConfirmation,
    confirming,
    copyDetails,
    error,
    generateBundle,
    isGenerating,
    isLoading: status === copy.supportLoading,
    loadDetails,
    openFolder,
    opener: openerRef.current,
    requestBundle,
    status,
    visibleDetails,
  };
}
