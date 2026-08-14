import { configure } from "@testing-library/react";

// Coverage runs share constrained CI hosts with native builds. Keep async UI
// assertions deterministic without changing production timing behavior.
configure({ asyncUtilTimeout: 5_000 });
