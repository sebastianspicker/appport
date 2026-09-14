import { native } from "../native-bridge/native";
import type { AppAction } from "../native-bridge/types";

type Request = {
  actionId: string;
  current: () => boolean;
  resolve: (action: AppAction | undefined) => void;
  reject: (reason: unknown) => void;
};

/** Bound initial action reads across overlapping catalog snapshots. */
export class HydrationPool {
  private active = 0;
  private pending: Request[] = [];

  load(actionId: string, current: () => boolean) {
    return new Promise<AppAction | undefined>((resolve, reject) => {
      this.pending.push({ actionId, current, resolve, reject });
      this.drain();
    });
  }

  clear() {
    for (const request of this.pending) request.resolve(undefined);
    this.pending = [];
  }

  private drain() {
    while (this.active < 4 && this.pending.length) {
      const request = this.pending.shift();
      if (!request) return;
      if (!request.current()) {
        request.resolve(undefined);
        continue;
      }
      this.active += 1;
      void native
        .action(request.actionId)
        .then(request.resolve, request.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}
