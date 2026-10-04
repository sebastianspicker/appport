import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

configure({ asyncUtilTimeout: 5_000 });
afterEach(cleanup);

Object.defineProperties(HTMLDialogElement.prototype, {
  close: {
    configurable: true,
    value() {
      this.open = false;
    },
  },
  showModal: {
    configurable: true,
    value() {
      this.open = true;
    },
  },
});
