import type {
  AdobePreset,
  MicrostockChecklist,
  PreflightItem,
} from "../types/microstock";

export const ADOBE_MVP_PRESETS: AdobePreset[] = [
  {
    id: "adobe_4k_16x9_30p",
    label: "Adobe 4K UHD 16:9 @ 30fps (10s)",
    width: 3840,
    height: 2160,
    ratio: "16:9",
    fps: 30,
    recommendedDurationSec: 10,
    codec: "h264",
    container: "mp4",
  },
  {
    id: "adobe_4k_16x9_60p",
    label: "Adobe 4K UHD 16:9 @ 60fps (10s)",
    width: 3840,
    height: 2160,
    ratio: "16:9",
    fps: 60,
    recommendedDurationSec: 10,
    codec: "h264",
    container: "mp4",
  },
  {
    id: "adobe_1080p_16x9_30p",
    label: "Adobe Full HD 16:9 @ 30fps (10s)",
    width: 1920,
    height: 1080,
    ratio: "16:9",
    fps: 30,
    recommendedDurationSec: 10,
    codec: "h264",
    container: "mp4",
  },
  {
    id: "adobe_4k_9x16_30p",
    label: "Adobe Vertical 4K 9:16 @ 30fps (10s)",
    width: 2160,
    height: 3840,
    ratio: "9:16",
    fps: 30,
    recommendedDurationSec: 10,
    codec: "h264",
    container: "mp4",
  },
  {
    id: "adobe_1080p_9x16_30p",
    label: "Adobe Vertical HD 9:16 @ 30fps (10s)",
    width: 1080,
    height: 1920,
    ratio: "9:16",
    fps: 30,
    recommendedDurationSec: 10,
    codec: "h264",
    container: "mp4",
  },
  {
    id: "adobe_square_1x1_30p",
    label: "Adobe Square 1:1 @ 30fps (10s)",
    width: 2160,
    height: 2160,
    ratio: "1:1",
    fps: 30,
    recommendedDurationSec: 10,
    codec: "h264",
    container: "mp4",
  },
];

export const ADOBE_ALLOWED_CODECS = [
  { id: "h264" as const, label: "H.264 (MP4)" },
  { id: "prores" as const, label: "ProRes 422 HQ (MOV)" },
];

export const ADOBE_ALLOWED_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const ADOBE_ALLOWED_FPS = [24, 25, 30, 50, 60] as const;

const BANNED_BRAND_TERMS = [
  "adobe",
  "apple",
  "iphone",
  "ipad",
  "macbook",
  "google",
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "meta",
  "netflix",
  "disney",
  "marvel",
  "nike",
  "adidas",
  "tesla",
  "microsoft",
  "windows",
  "openai",
  "chatgpt",
  "midjourney",
  "sora",
  "runway",
  "pixar",
  "sony",
  "samsung",
  "canon",
  "nikon",
  "red",
  "arri",
];

export function isMicrostockChecklistComplete(checklist: MicrostockChecklist): boolean {
  return (
    checklist.notUpscaled &&
    checklist.noLogosWatermarksTextOrAudio &&
    checklist.ownsFullRightsAndLicenses &&
    checklist.notCopiedFromExternalReference
  );
}

export function parseKeywordsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export interface MicrostockValidationIssue {
  code: string;
  severity: "fail" | "warn";
  message: string;
}

export function validateMicrostockSubmission(input: {
  filename: string;
  title: string;
  keywords: string[];
  aiDeclared: boolean | null;
  checklist: MicrostockChecklist;
}): MicrostockValidationIssue[] {
  const issues: MicrostockValidationIssue[] = [];

  if (input.aiDeclared === null) {
    issues.push({
      code: "AI_DECLARATION_MISSING",
      severity: "fail",
      message: "Generative AI disclosure (Yes / No) must be explicitly selected.",
    });
  }

  if (!isMicrostockChecklistComplete(input.checklist)) {
    issues.push({
      code: "CHECKLIST_INCOMPLETE",
      severity: "fail",
      message: "All 4 Adobe Stock contributor compliance checkboxes must be confirmed.",
    });
  }

  const trimmedFilename = input.filename.trim();
  if (!trimmedFilename) {
    issues.push({
      code: "METADATA_INVALID",
      severity: "fail",
      message: "Filename cannot be empty.",
    });
  } else if ([...trimmedFilename].length > 30) {
    issues.push({
      code: "FILENAME_TOO_LONG",
      severity: "fail",
      message: `Filename '${trimmedFilename}' is ${[...trimmedFilename].length} chars (Adobe CSV maximum is 30 chars).`,
    });
  }

  const trimmedTitle = input.title.trim();
  const titleLen = [...trimmedTitle].length;
  if (!trimmedTitle) {
    issues.push({
      code: "METADATA_INVALID",
      severity: "fail",
      message: "Title is required for Adobe Stock submission.",
    });
  } else if (titleLen > 200) {
    issues.push({
      code: "METADATA_INVALID",
      severity: "fail",
      message: `Title is ${titleLen} chars (Adobe hard limit is 200 chars).`,
    });
  } else if (titleLen > 70) {
    issues.push({
      code: "METADATA_INVALID",
      severity: "fail",
      message: `Title is ${titleLen} chars (Adobe Stock recommended maximum is 70 chars).`,
    });
  }

  const cleanedKeywords = input.keywords.map((k) => k.trim()).filter(Boolean);
  if (cleanedKeywords.length < 5 || cleanedKeywords.length > 49) {
    issues.push({
      code: "METADATA_INVALID",
      severity: "fail",
      message: `Keyword count is ${cleanedKeywords.length}; Adobe Stock requires between 5 and 49 keywords.`,
    });
  }

  const seen = new Set<string>();
  for (const kw of cleanedKeywords) {
    const lower = kw.toLowerCase();
    if (seen.has(lower)) {
      issues.push({
        code: "METADATA_INVALID",
        severity: "fail",
        message: `Duplicate keyword '${kw}' is not allowed.`,
      });
      break;
    }
    seen.add(lower);
  }

  const combinedTokens = `${trimmedTitle} ${cleanedKeywords.join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  for (const banned of BANNED_BRAND_TERMS) {
    if (combinedTokens.includes(banned)) {
      issues.push({
        code: "METADATA_INVALID",
        severity: "fail",
        message: `Title or keywords contain restricted brand/IP term '${banned}'.`,
      });
      break;
    }
  }

  return issues;
}

function escapeCsvCell(val: string): string {
  if (
    val.includes(",") ||
    val.includes('"') ||
    val.includes("\n") ||
    val.includes("\r")
  ) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function buildAdobeCsvContent(
  filename: string,
  title: string,
  keywords: string[]
): string {
  const joinedKeywords = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .join(", ");
  return [
    "Filename,Title,Keywords",
    `${escapeCsvCell(filename.trim())},${escapeCsvCell(title.trim())},${escapeCsvCell(joinedKeywords)}`,
    "",
  ].join("\n");
}

export function groupPreflightItems(items: PreflightItem[]): {
  fails: PreflightItem[];
  warns: PreflightItem[];
  infos: PreflightItem[];
} {
  return {
    fails: items.filter((i) => i.severity === "fail"),
    warns: items.filter((i) => i.severity === "warn"),
    infos: items.filter((i) => i.severity === "info"),
  };
}
