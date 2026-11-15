import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, execSync, type ChildProcess } from "node:child_process";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function writePeriodicDeterministicHtml(projectDir: string, durationSec = 6) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0d0f14; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="stage" width="1920" height="1080"></canvas>
<script>
  window.AETHERIA_FILM = {
    title: "Warm Geometric Motion Loop",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: ${durationSec}
  };
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const PERIOD = ${durationSec};

  window.renderAt = function(t) {
    const w = canvas.width;
    const h = canvas.height;
    const phase = ((t % PERIOD) / PERIOD) * Math.PI * 2;

    const gx = w * (0.5 + 0.35 * Math.cos(phase));
    const gy = h * (0.5 + 0.35 * Math.sin(phase));
    const grad = ctx.createRadialGradient(gx, gy, 40, w * 0.5, h * 0.5, w * 0.75);
    grad.addColorStop(0, "#f59e0b");
    grad.addColorStop(0.5, "#be123c");
    grad.addColorStop(1, "#0f172a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 8; i++) {
      const a = phase + (i * Math.PI) / 4;
      const cx = w * 0.5 + Math.cos(a) * 360;
      const cy = h * 0.5 + Math.sin(a) * 220;
      const r = 70 + 25 * Math.sin(phase * 2 + i);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? "rgba(251, 191, 36, 0.55)" : "rgba(244, 63, 94, 0.55)";
      ctx.fill();
    }
  };
  window.renderAt(0);
  window.__ready = true;
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(projectDir, "index.html"), html, "utf8");
}

function writeNonPeriodicHtml(projectDir: string, durationSec = 5) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #090a0f; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="stage" width="1920" height="1080"></canvas>
<script>
  window.AETHERIA_FILM = { title: "Non Periodic Sweep", width: 1920, height: 1080, fps: 30, duration: ${durationSec} };
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  window.renderAt = function(t) {
    const p = Math.min(1, Math.max(0, t / ${durationSec}));
    ctx.fillStyle = p < 0.5 ? "#0f172a" : "#fbbf24";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e11d48";
    ctx.fillRect(p * (canvas.width - 300), p * (canvas.height - 300), 300, 300);
  };
  window.renderAt(0);
  window.__ready = true;
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(projectDir, "index.html"), html, "utf8");
}

function writeStaticHtml(projectDir: string, durationSec = 5) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;overflow:hidden;background:#1e293b;">
<canvas id="stage" width="1920" height="1080"></canvas>
<script>
  window.AETHERIA_FILM = { title: "Static Frame", width: 1920, height: 1080, fps: 30, duration: ${durationSec} };
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  window.renderAt = function(_t) {
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  window.renderAt(0);
  window.__ready = true;
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(projectDir, "index.html"), html, "utf8");
}

async function main() {
  console.log("==================================================================");
  console.log("🚀 AETHERIA MICROSTOCK (ADOBE STOCK) END-TO-END VERIFICATION");
  console.log("==================================================================");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-microstock-e2e-"));
  const homeDir = path.join(tmpRoot, "home");
  const projectDir = path.join(tmpRoot, "workspace-project");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "output"), { recursive: true });

  const port = await getFreePort();
  const password = `e2e_${Date.now()}`;
  const authHeader = `Basic ${Buffer.from(`aetheria:${password}`).toString("base64")}`;
  const baseUrl = `http://127.0.0.1:${port}`;

  const repoDir = process.cwd();
  const engineBin = path.join(
    repoDir,
    "target",
    "debug",
    process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine"
  );
  assert(fs.existsSync(engineBin), `Engine binary not found at ${engineBin}`);

  let engineProc: ChildProcess | null = null;

  const api = async (
    endpoint: string,
    init?: RequestInit
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "x-aetheria-directory": projectDir,
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  try {
    engineProc = spawn(engineBin, ["serve", "--port", String(port)], {
      cwd: repoDir,
      env: {
        ...process.env,
        AETHERIA_HEADLESS: "1",
        AETHERIA_DISABLE_OPEN_BROWSER: "1",
        AETHERIA_SERVER_USERNAME: "aetheria",
        Aetheria_SERVER_USERNAME: "aetheria",
        AETHERIA_SERVER_PASSWORD: password,
        Aetheria_SERVER_PASSWORD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    engineProc.stderr?.on("data", (d) => {
      const s = d.toString("utf8").trim();
      if (s) console.log("[engine stderr]", s);
    });

    const deadline = Date.now() + 30000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const { status, json } = await api("/api/health");
        if (status === 200 && json?.healthy === true) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
    assert(healthy, "Engine failed to become healthy within 30s");

    const initWs = await api("/api/desktop/init-workspace", {
      method: "POST",
      body: JSON.stringify({ directory: projectDir }),
    });
    assert(initWs.status === 200, `Failed initializing workspace: ${JSON.stringify(initWs.json)}`);
    // desktop/workspace.rs scaffolds empty subdirs ["script", "img", "audio", "ref", "output"];
    // remove empty audio/ and ref/ if created so our clean project starts without audio
    console.log(`[PASS] Engine healthy at ${baseUrl} (temp workspace: ${projectDir})`);

    // -------------------------------------------------------------------------
    // F0: Baseline /api/render-media 5s 1080p30
    // -------------------------------------------------------------------------
    writePeriodicDeterministicHtml(projectDir, 5);
    const f0Start = Date.now();
    const f0Trigger = await api("/api/render-media", {
      method: "POST",
      body: JSON.stringify({
        compositionId: "BaselineComp",
        outputName: "f0_baseline.mp4",
        ratio: "16:9",
        codec: "h264",
      }),
    });
    assert(f0Trigger.status === 200 && f0Trigger.json.renderId, "F0 render trigger failed");
    const f0RenderId = f0Trigger.json.renderId;
    let f0Done: any = null;
    const f0Deadline = Date.now() + 120000;
    while (Date.now() < f0Deadline) {
      const prog = await api(`/api/render-progress?renderId=${encodeURIComponent(f0RenderId)}`);
      if (prog.json?.status === "done") {
        f0Done = prog.json;
        break;
      }
      if (prog.json?.status === "error") {
        throw new Error(`F0 render failed: ${prog.json?.error}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const f0ElapsedMs = Date.now() - f0Start;
    assert(f0Done && fs.existsSync(f0Done.outputPath), "F0 baseline output file missing");
    const f0Size = fs.statSync(f0Done.outputPath).size;
    console.log(
      `[PASS] F0 Baseline /api/render-media: ${f0ElapsedMs}ms, ${f0Size} bytes (${f0Done.outputPath})`
    );

    // -------------------------------------------------------------------------
    // F1: Profile & Manifest initialization
    // -------------------------------------------------------------------------
    const profRes = await api("/api/studio/microstock/profile");
    assert(
      profRes.status === 200 && Array.isArray(profRes.json?.data?.presets),
      `Profile endpoint failed: ${JSON.stringify(profRes.json)}`
    );

    const initManifestRes = await api("/api/studio/microstock/manifest");
    assert(
      initManifestRes.status === 200 &&
        initManifestRes.json?.data?.provenance?.aiDeclared === null,
      "Initial manifest must have aiDeclared === null"
    );
    console.log("[PASS] F1 Profile & Initial Manifest (aiDeclared === null)");

    const COMPLETE_CHECKLIST = {
      noLogosOrBrands: true,
      noArtistOrIpNames: true,
      noIdentifiablePeopleOrProperty: true,
      noThirdPartyFontsOrGraphicsWithoutLicense: true,
    };

    const setValidManifest = async (overrides?: Record<string, unknown>) => {
      const res = await api("/api/studio/microstock/manifest", {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          preset: "1920x1080",
          fps: 30,
          codec: "h264",
          isLoop: true,
          aiDeclaredPresent: true,
          aiDeclared: false,
          checklist: COMPLETE_CHECKLIST,
          metadata: {
            title: "Warm Geometric Radial Gradient Motion Loop Background",
            keywords: [
              "abstract",
              "geometric",
              "gradient",
              "motion",
              "background",
              "loop",
              "amber",
              "modern",
            ],
            category: "Graphic Resources",
          },
          licenses: [],
          ...(overrides || {}),
        }),
      });
      assert(res.status === 200, `Failed to update manifest: ${JSON.stringify(res.json)}`);
    };

    // -------------------------------------------------------------------------
    // Pre-Render Gate Rejections (11 negative cases, HTTP 400, no Chromium run)
    // -------------------------------------------------------------------------
    // 1. AI_DECLARATION_MISSING
    writePeriodicDeterministicHtml(projectDir, 6);
    await setValidManifest({
      aiDeclaredPresent: true,
      aiDeclared: null,
    });
    let r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ presetId: "1920x1080", durationSec: 6 }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "AI_DECLARATION_MISSING"),
      `Expected AI_DECLARATION_MISSING, got ${JSON.stringify(r.json)}`
    );

    // 2. CHECKLIST_INCOMPLETE
    await setValidManifest({
      aiDeclaredPresent: true,
      aiDeclared: true,
      checklist: {
        ...COMPLETE_CHECKLIST,
        noLogosOrBrands: false,
      },
    });
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ presetId: "1920x1080", durationSec: 6 }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "CHECKLIST_INCOMPLETE"),
      "Expected CHECKLIST_INCOMPLETE"
    );

    // Restore valid provenance for remaining gate checks
    await setValidManifest();

    // 3. DURATION_OUT_OF_RANGE (3s)
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ durationSec: 3, fps: 30, width: 1920, height: 1080, codec: "h264" }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "DURATION_OUT_OF_RANGE"),
      "Expected DURATION_OUT_OF_RANGE for 3s"
    );

    // 4. FPS_NOT_ALLOWED (20)
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ durationSec: 6, fps: 20, width: 1920, height: 1080, codec: "h264" }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "FPS_NOT_ALLOWED"),
      "Expected FPS_NOT_ALLOWED for 20fps"
    );

    // 5. CODEC_NOT_ALLOWED (gif)
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ durationSec: 6, fps: 30, width: 1920, height: 1080, codec: "gif" }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "CODEC_NOT_ALLOWED"),
      "Expected CODEC_NOT_ALLOWED for gif"
    );

    // 6. RESOLUTION_NOT_ALLOWED (1000x1000)
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ durationSec: 6, fps: 30, width: 1000, height: 1000, codec: "h264" }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "RESOLUTION_NOT_ALLOWED"),
      "Expected RESOLUTION_NOT_ALLOWED for 1000x1000"
    );

    // 7. FILENAME_TOO_LONG (31 chars)
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({
        durationSec: 6,
        fps: 30,
        width: 1920,
        height: 1080,
        codec: "h264",
        outputFilename: "this_filename_is_31_chars_long_.mp4",
      }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "FILENAME_TOO_LONG"),
      `Expected FILENAME_TOO_LONG for 31-char filename, got ${JSON.stringify(r.json)}`
    );

    // 8. EXTERNAL_URL_IN_PROJECT
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      `<!DOCTYPE html><html><head><script src="https://cdn.example.com/lib.js"></script></head><body><script>window.AETHERIA_FILM={width:1920,height:1080,fps:30,duration:6};window.renderAt=function(t){};window.__ready=true;</script></body></html>`,
      "utf8"
    );
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ presetId: "1920x1080", durationSec: 6 }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "EXTERNAL_URL_IN_PROJECT"),
      "Expected EXTERNAL_URL_IN_PROJECT"
    );

    // 9. MOTION_LINT_ERRORS (Math.random())
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      `<!DOCTYPE html><html><body><script>
      window.AETHERIA_FILM={width:1920,height:1080,fps:30,duration:6};
      window.renderAt=function(t){ const v = Math.random(); };
      window.__ready=true;
      </script></body></html>`,
      "utf8"
    );
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ presetId: "1920x1080", durationSec: 6 }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "MOTION_LINT_ERRORS"),
      "Expected MOTION_LINT_ERRORS for Math.random()"
    );

    // 10. TEXT_IN_COMPOSITION (fillText)
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
      window.AETHERIA_FILM={width:1920,height:1080,fps:30,duration:6};
      const ctx = document.getElementById("c").getContext("2d");
      window.renderAt=function(t){ ctx.fillText("Sample", 10, 10); };
      window.__ready=true;
      </script></body></html>`,
      "utf8"
    );
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ presetId: "1920x1080", durationSec: 6 }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "TEXT_IN_COMPOSITION"),
      "Expected TEXT_IN_COMPOSITION for fillText"
    );

    // 11. LICENSE_MISSING (@font-face without license)
    fs.writeFileSync(
      path.join(projectDir, "index.html"),
      `<!DOCTYPE html><html><head><style>@font-face { font-family: "Custom"; src: url("fonts/Custom.woff2"); }</style></head><body><script>
      window.AETHERIA_FILM={width:1920,height:1080,fps:30,duration:6};
      window.renderAt=function(t){};
      window.__ready=true;
      </script></body></html>`,
      "utf8"
    );
    r = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({ presetId: "1920x1080", durationSec: 6 }),
    });
    assert(
      r.status === 400 && r.json.items?.some((i: any) => i.code === "LICENSE_MISSING"),
      "Expected LICENSE_MISSING for unlicensed @font-face"
    );
    console.log("[PASS] All 11 pre-render gate rejections returned HTTP 400 with exact code");

    // -------------------------------------------------------------------------
    // Positive Case: Periodic 6s 1080p30 H.264 -> Render -> Preflight -> Ready -> Package
    // -------------------------------------------------------------------------
    writePeriodicDeterministicHtml(projectDir, 6);
    await setValidManifest({ isLoop: true });
    const posRes = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({
        presetId: "1920x1080",
        codec: "h264",
        durationSec: 6,
        fps: 30,
        width: 1920,
        height: 1080,
        outputFilename: "warm_geo_1080p30.mp4",
      }),
    });
    assert(
      posRes.status === 200 && posRes.json?.data?.render && posRes.json?.data?.preflight,
      `Positive render failed: ${JSON.stringify(posRes.json)}`
    );
    const { render: posRender, preflight: posPreflight } = posRes.json.data;
    assert(
      posPreflight.status === "pass" || posPreflight.status === "warn",
      `Expected pass/warn preflight, got ${JSON.stringify(posPreflight)}`
    );
    assert(
      !posPreflight.items.some((i: any) => i.code === "LOOP_DISCONTINUITY"),
      `Periodic loop should NOT have LOOP_DISCONTINUITY: ${JSON.stringify(posPreflight.items)}`
    );
    const readyAbsPath = path.join(projectDir, "output", "microstock", "ready", "warm_geo_1080p30.mp4");
    assert(
      posPreflight.promotedToReady && fs.existsSync(readyAbsPath),
      "Ready file must exist in output/microstock/ready/"
    );
    console.log(
      `[PASS] Positive Render & Preflight: status=${posPreflight.status}, metrics=${JSON.stringify(posPreflight.metrics)}`
    );

    // Verify with ffprobe directly
    function findWingetBinary(exeName: string): string {
      const pkgRoot = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
      if (fs.existsSync(pkgRoot)) {
        for (const pkg of fs.readdirSync(pkgRoot)) {
          if (!pkg.toLowerCase().includes("ffmpeg")) continue;
          const pkgDir = path.join(pkgRoot, pkg);
          const stack = [pkgDir];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
              const full = path.join(cur, ent.name);
              if (ent.isDirectory()) stack.push(full);
              else if (ent.isFile() && ent.name.toLowerCase() === exeName.toLowerCase()) {
                return full;
              }
            }
          }
        }
      }
      return exeName;
    }
    const ffprobeBin = findWingetBinary("ffprobe.exe");
    const ffmpegBin = findWingetBinary("ffmpeg.exe");

    const ffprobeCheck = spawnSync(
      ffprobeBin,
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        readyAbsPath,
      ],
      { encoding: "utf8" }
    );
    const probeJson = JSON.parse(ffprobeCheck.stdout);
    const vStream = probeJson.streams.find((s: any) => s.codec_type === "video");
    const aStream = probeJson.streams.find((s: any) => s.codec_type === "audio");
    assert(vStream.codec_name === "h264", "Expected h264");
    assert(vStream.width === 1920 && vStream.height === 1080, "Expected 1920x1080");
    assert(vStream.r_frame_rate === "30/1", `Expected 30/1 r_frame_rate, got ${vStream.r_frame_rate}`);
    assert(vStream.pix_fmt === "yuv420p", "Expected yuv420p");
    assert(vStream.color_space === "bt709", `Expected bt709 color_space, got ${vStream.color_space}`);
    assert(!aStream, "Expected 0 audio streams (-an)");
    console.log("[PASS] ffprobe verified: mp4/h264, 1920x1080, 30/1, yuv420p, bt709, 0 audio streams");

    // Package positive case
    const pkgRes = await api("/api/studio/microstock/package", {
      method: "POST",
      body: JSON.stringify({ file: "warm_geo_1080p30.mp4" }),
    });
    assert(pkgRes.status === 200 && pkgRes.json?.data?.packageDir, `Package failed: ${JSON.stringify(pkgRes.json)}`);
    const pkgData = pkgRes.json.data;
    assert(fs.existsSync(pkgData.videoFile), "Packaged video file missing");
    assert(fs.existsSync(pkgData.csvPath), "Packaged metadata.csv missing");
    assert(fs.existsSync(pkgData.txtPath), "Packaged metadata.txt missing");
    assert(fs.existsSync(pkgData.manifestPath), "Packaged manifest.json missing");
    const csvLines = fs.readFileSync(pkgData.csvPath, "utf8").trim().split("\n");
    assert(csvLines[0] === "Filename,Title,Keywords", `Unexpected CSV header: ${csvLines[0]}`);
    console.log(`[PASS] Package built at ${pkgData.packageDir} (SHA-256: ${pkgData.sha256})`);

    // -------------------------------------------------------------------------
    // Loop Check: Non-periodic composition -> LOOP_DISCONTINUITY (warn)
    // -------------------------------------------------------------------------
    writeNonPeriodicHtml(projectDir, 5);
    await setValidManifest({ isLoop: true });
    const nonPerRes = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({
        presetId: "1920x1080",
        codec: "h264",
        durationSec: 5,
        fps: 30,
        width: 1920,
        height: 1080,
        outputFilename: "non_periodic_loop.mp4",
      }),
    });
    assert(nonPerRes.status === 200, "Non-periodic render should complete with warn");
    const nonPerPf = nonPerRes.json.data.preflight;
    assert(
      nonPerPf.items.some((i: any) => i.code === "LOOP_DISCONTINUITY"),
      `Expected LOOP_DISCONTINUITY on non-periodic loop, got ${JSON.stringify(nonPerPf)}`
    );
    console.log(
      `[PASS] Loop Check (Non-periodic -> LOOP_DISCONTINUITY): metrics=${JSON.stringify(nonPerPf.metrics)}`
    );

    // -------------------------------------------------------------------------
    // Post-Render Checks: HAS_AUDIO and LOW_MOTION stay in staging/, not ready/
    // -------------------------------------------------------------------------
    // 1. LOW_MOTION via static HTML render
    writeStaticHtml(projectDir, 5);
    await setValidManifest({ isLoop: false });
    const staticRes = await api("/api/studio/microstock/render", {
      method: "POST",
      body: JSON.stringify({
        presetId: "1920x1080",
        codec: "h264",
        durationSec: 5,
        fps: 30,
        width: 1920,
        height: 1080,
        outputFilename: "static_clip.mp4",
      }),
    });
    assert(staticRes.status === 200, "Static render HTTP 200 with preflight fail report");
    const staticPf = staticRes.json.data.preflight;
    assert(
      staticPf.status === "fail" &&
        staticPf.items.some((i: any) => i.code === "LOW_MOTION"),
      `Expected LOW_MOTION fail on static clip, got ${JSON.stringify(staticPf)}`
    );
    assert(
      !staticPf.promotedToReady &&
        !fs.existsSync(path.join(projectDir, "output", "microstock", "ready", "static_clip.mp4")),
      "Failed LOW_MOTION clip must NOT be promoted to ready/"
    );
    console.log("[PASS] Post-render LOW_MOTION fail kept clip in staging/ only");

    // 2. HAS_AUDIO via synthetic audio clip in staging/
    const audioStagingAbs = path.join(projectDir, "output", "microstock", "staging", "with_audio.mp4");
    const ffmpegMux = spawnSync(
      ffmpegBin,
      [
        "-y",
        "-i",
        posRender.stagingPath,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        "5",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        audioStagingAbs,
      ],
      { encoding: "utf8" }
    );
    assert(ffmpegMux.status === 0 && fs.existsSync(audioStagingAbs), "Failed to create test clip with audio");
    const audioPfRes = await api("/api/studio/microstock/preflight", {
      method: "POST",
      body: JSON.stringify({ file: "with_audio.mp4", checkLoop: false }),
    });
    assert(
      audioPfRes.status === 200 &&
        audioPfRes.json?.data?.status === "fail" &&
        audioPfRes.json?.data?.items?.some((i: any) => i.code === "HAS_AUDIO"),
      `Expected HAS_AUDIO fail, got ${JSON.stringify(audioPfRes.json)}`
    );
    assert(
      !fs.existsSync(path.join(projectDir, "output", "microstock", "ready", "with_audio.mp4")),
      "Clip with audio must NOT be promoted to ready/"
    );
    console.log("[PASS] Post-render HAS_AUDIO fail kept clip in staging/ only");

    // -------------------------------------------------------------------------
    // Metadata / CSV Validation negative cases
    // -------------------------------------------------------------------------
    const invalidMetadataCases = [
      {
        label: "71-char title",
        metadata: {
          title: "A".repeat(71),
          keywords: ["one", "two", "three", "four", "five", "six"],
          category: "Graphic Resources",
        },
      },
      {
        label: "4 keywords (<5)",
        metadata: {
          title: "Valid Short Title",
          keywords: ["one", "two", "three", "four"],
          category: "Graphic Resources",
        },
      },
      {
        label: "50 keywords (>49)",
        metadata: {
          title: "Valid Short Title",
          keywords: Array.from({ length: 50 }, (_, i) => `kw${i}`),
          category: "Graphic Resources",
        },
      },
      {
        label: "duplicate keywords",
        metadata: {
          title: "Valid Short Title",
          keywords: ["abstract", "Abstract", "loop", "motion", "clean", "warm"],
          category: "Graphic Resources",
        },
      },
    ];

    for (const c of invalidMetadataCases) {
      const badPkg = await api("/api/studio/microstock/package", {
        method: "POST",
        body: JSON.stringify({ file: "warm_geo_1080p30.mp4", metadata: c.metadata }),
      });
      assert(
        badPkg.status === 400 &&
          badPkg.json?.items?.some((i: any) => i.code === "METADATA_INVALID"),
        `Expected METADATA_INVALID for ${c.label}, got ${JSON.stringify(badPkg.json)}`
      );
    }
    console.log("[PASS] Metadata/CSV negative cases (71-char title, 4 kw, 50 kw, duplicate kw -> METADATA_INVALID)");

    console.log("==================================================================");
    console.log("✅ ALL MICROSTOCK E2E CHECKS PASSED");
    console.log("==================================================================");
  } finally {
    if (engineProc && engineProc.pid) {
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /F /T /PID ${engineProc.pid}`, { stdio: "ignore", windowsHide: true });
        } else {
          engineProc.kill("SIGKILL");
        }
      } catch {}
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ MICROSTOCK E2E FAILED:", err);
  process.exit(1);
});
