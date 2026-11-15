import { describe, expect, it } from "vitest";
import { studioActions, subscribeStudioFrame } from "./useStudioStore";

describe("useStudioStore frame listener isolation", () => {
  it("notifies only frame listeners on setCurrentFrame without changing composition store", () => {
    let frameCalls = 0;
    const unsub = subscribeStudioFrame(() => {
      frameCalls += 1;
    });

    const initialFrame = studioActions.getCurrentFrame();
    const targetFrame = initialFrame + 17;
    studioActions.setCurrentFrame(targetFrame);

    expect(studioActions.getCurrentFrame()).toBe(targetFrame);
    expect(frameCalls).toBe(1);

    studioActions.setCurrentFrame(targetFrame);
    expect(frameCalls).toBe(1);

    studioActions.setCurrentFrame(initialFrame);
    unsub();
  });
});
