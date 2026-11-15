import { describe, expect, it } from "vitest";
import { centerNoticeActions } from "./useCenterNotice";

describe("useCenterNotice", () => {
  it("shows centered notice payload and dismisses cleanly", () => {
    const shown = centerNoticeActions.show({
      severity: "warning",
      title: "Compliance Gate Incomplete",
      message: "Complete AI disclosure before rendering.",
      details: ["Select Yes (AI) or No (Code)", "Confirm all 4 checks"],
    });
    expect(shown.id).toMatch(/^notice-/);
    expect(shown.details).toHaveLength(2);
    centerNoticeActions.dismiss();
  });
});
