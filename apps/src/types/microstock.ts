export type MicrostockRuleSeverity = "fail" | "warn" | "info";

export interface AdobeRule<T> {
  value: T;
  sourceUrl: string;
  checkedAt: string;
  severity: MicrostockRuleSeverity;
  note?: string | null;
}

export interface AdobePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  ratio: "16:9" | "9:16" | "1:1";
  fps: number;
  recommendedDurationSec: number;
  codec: "h264" | "prores";
  container: "mp4" | "mov";
}

export interface AdobeResolution {
  width: number;
  height: number;
  ratio: "16:9" | "9:16" | "1:1";
  label: string;
}

export interface AdobeCategory {
  id: number;
  name: string;
}

export interface AdobeProfile {
  profileId: string;
  presets: AdobePreset[];
  allowedContainers: AdobeRule<string[]>;
  allowedVideoCodecs: AdobeRule<string[]>;
  allowedFps: AdobeRule<number[]>;
  durationSecRange: AdobeRule<[number, number]>;
  maxFileSizeBytes: AdobeRule<number>;
  recommendedResolutions: AdobeRule<AdobeResolution[]>;
  colorSpace: AdobeRule<string>;
  scanType: AdobeRule<string>;
  audioPolicy: AdobeRule<string>;
  maxTitleChars: AdobeRule<number>;
  recommendedTitleMaxChars: AdobeRule<number>;
  keywordCountRange: AdobeRule<[number, number]>;
  maxFilenameChars: AdobeRule<number>;
  categories: AdobeRule<AdobeCategory[]>;
  bannedBrandAndIpTerms: AdobeRule<string[]>;
  unknowns: string[];
}

export interface MicrostockChecklist {
  notUpscaled: boolean;
  noLogosWatermarksTextOrAudio: boolean;
  ownsFullRightsAndLicenses: boolean;
  notCopiedFromExternalReference: boolean;
}

export interface MicrostockProvenance {
  aiDeclared: boolean | null;
  generator: string | null;
  model: string | null;
  promptSummary: string | null;
  checklist: MicrostockChecklist;
}

export interface MicrostockMetadata {
  title: string;
  keywords: string[];
  categoryId: number | null;
  categoryName: string | null;
  editorialNotAllowedAck: boolean;
}

export interface MicrostockLicenseEntry {
  assetPath: string;
  spdxLicense: string;
  sourceUrl: string;
}

export interface PreflightItem {
  code: string;
  severity: MicrostockRuleSeverity;
  message: string;
  source: string;
}

export interface PreflightReport {
  status: "pass" | "warn" | "fail";
  checkedAt: number;
  items: PreflightItem[];
  sourceVsEncodedPsnr?: number | null;
  sourceVsEncodedSsim?: number | null;
  loopFirstLastPsnr?: number | null;
  loopFirstLastSsim?: number | null;
  promotedPath?: string | null;
}

export interface MicrostockRenderRecord {
  renderId: string;
  stagingPath: string;
  readyPath?: string | null;
  sha256?: string | null;
  sizeBytes: number;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  codec: string;
  container: string;
  createdAt: number;
}

export interface MicrostockManifest {
  schemaVersion: number;
  projectFolder: string;
  enabled: boolean;
  targetMarketplace: string;
  presetId: string;
  isLoop: boolean;
  provenance: MicrostockProvenance;
  metadata: MicrostockMetadata;
  licenses: MicrostockLicenseEntry[];
  lastRender?: MicrostockRenderRecord | null;
  lastPreflight?: PreflightReport | null;
  updatedAt: number;
}

export interface MicrostockPackageResult {
  packageDir: string;
  videoFile: string;
  sha256: string;
  csvPath: string;
  txtPath: string;
  manifestPath: string;
  warnings: PreflightItem[];
}
