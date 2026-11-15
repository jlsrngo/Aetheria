import { describe, expect, it } from "vitest";
import {
  ADOBE_ALLOWED_CODECS,
  ADOBE_MVP_PRESETS,
  buildAdobeCsvContent,
  groupPreflightItems,
  validateMicrostockSubmission,
} from "./microstockUtils";

const COMPLETE_CHECKLIST = {
  notUpscaled: true,
  noLogosWatermarksTextOrAudio: true,
  ownsFullRightsAndLicenses: true,
  notCopiedFromExternalReference: true,
};

describe("microstockUtils", () => {
  it("exposes locked Adobe Stock MVP presets and codecs (H.264 + ProRes only)", () => {
    expect(ADOBE_MVP_PRESETS.length).toBe(6);
    expect(ADOBE_MVP_PRESETS.map((p) => p.id)).toContain("1920x1080");
    expect(ADOBE_ALLOWED_CODECS.map((c) => c.id)).toEqual(["h264", "prores"]);
  });

  it("rejects missing AI declaration, incomplete checklist, 71-char title, <5 or >49 keywords, duplicates, and >30-char filename", () => {
    const validKeywords = [
      "abstract",
      "gradient",
      "motion",
      "background",
      "seamless",
      "loop",
    ];

    expect(
      validateMicrostockSubmission({
        filename: "clip_1080p30.mp4",
        title: "Clean abstract motion background loop",
        keywords: validKeywords,
        aiDeclared: true,
        checklist: COMPLETE_CHECKLIST,
      })
    ).toEqual([]);

    expect(
      validateMicrostockSubmission({
        filename: "clip_1080p30.mp4",
        title: "Clean abstract motion background loop",
        keywords: validKeywords,
        aiDeclared: null,
        checklist: COMPLETE_CHECKLIST,
      }).map((i) => i.code)
    ).toContain("AI_DECLARATION_MISSING");

    expect(
      validateMicrostockSubmission({
        filename: "clip_1080p30.mp4",
        title: "a".repeat(71),
        keywords: validKeywords,
        aiDeclared: false,
        checklist: COMPLETE_CHECKLIST,
      }).map((i) => i.code)
    ).toContain("METADATA_INVALID");

    expect(
      validateMicrostockSubmission({
        filename: "clip_1080p30.mp4",
        title: "Valid short title",
        keywords: ["one", "two", "three", "four"],
        aiDeclared: false,
        checklist: COMPLETE_CHECKLIST,
      }).map((i) => i.code)
    ).toContain("METADATA_INVALID");

    const fiftyKeywords = Array.from({ length: 50 }, (_, idx) => `kw${idx}`);
    expect(
      validateMicrostockSubmission({
        filename: "clip_1080p30.mp4",
        title: "Valid short title",
        keywords: fiftyKeywords,
        aiDeclared: false,
        checklist: COMPLETE_CHECKLIST,
      }).map((i) => i.code)
    ).toContain("METADATA_INVALID");

    expect(
      validateMicrostockSubmission({
        filename: "clip_1080p30.mp4",
        title: "Valid short title",
        keywords: ["abstract", "Abstract", "motion", "loop", "clean", "flow"],
        aiDeclared: false,
        checklist: COMPLETE_CHECKLIST,
      }).map((i) => i.code)
    ).toContain("METADATA_INVALID");

    expect(
      validateMicrostockSubmission({
        filename: "this_filename_is_31_chars_long_.mp4",
        title: "Valid short title",
        keywords: validKeywords,
        aiDeclared: false,
        checklist: COMPLETE_CHECKLIST,
      }).map((i) => i.code)
    ).toContain("FILENAME_TOO_LONG");
  });

  it("builds exact Adobe Stock CSV header Filename,Title,Keywords and groups preflight items", () => {
    const csv = buildAdobeCsvContent(
      "abstract_flow_1080p30.mp4",
      "Smooth Abstract Warm Amber Flow Background",
      ["abstract", "flow", "amber", "gradient", "background", "loop"]
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Filename,Title,Keywords");
    expect(lines[1]).toBe(
      'abstract_flow_1080p30.mp4,Smooth Abstract Warm Amber Flow Background,"abstract, flow, amber, gradient, background, loop"'
    );

    const grouped = groupPreflightItems([
      { code: "HAS_AUDIO", severity: "fail", message: "Audio found", source: "url" },
      { code: "LOOP_DISCONTINUITY", severity: "warn", message: "Loop diff", source: "url" },
    ]);
    expect(grouped.fails).toHaveLength(1);
    expect(grouped.warns).toHaveLength(1);
    expect(grouped.infos).toHaveLength(0);
  });
});
