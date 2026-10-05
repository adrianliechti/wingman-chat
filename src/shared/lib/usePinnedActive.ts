import { useEffectEvent, useLayoutEffect, useState } from "react";

/**
 * Snapshots `active` whenever `shouldPin` becomes true (and on mount), so lists sorted with
 * `sortActiveFirst` keep their order while items are toggled. Pinned before paint to avoid a visible re-sort.
 */
export function usePinnedActive(active: ReadonlySet<string> | undefined, shouldPin: boolean): ReadonlySet<string> {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set(active));
  const pin = useEffectEvent(() => setPinned(new Set(active)));

  useLayoutEffect(() => {
    if (shouldPin) pin();
  }, [shouldPin]);

  return pinned;
}
