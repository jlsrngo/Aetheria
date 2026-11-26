#!/usr/bin/env node
/**
 * E2E Verification — Reference-to-Skill & Skill Manager Lifecycle (Real Dev Engine HTTP)
 *
 * Verifies:
 * 1. Fresh dev engine starts cleanly and passes `GET /api/health`.
 * 2. `GET /api/skills` distinguishes protected built-in `mg-*` skills (`builtin: true, deletable: false`)
 *    from user/reference skills (`deletable: true`).
 * 3. Failure paths:
 *    - `DELETE /api/skills/mg-soft-clay-story` -> HTTP 403 (built-in protected, folder intact).
 *    - `POST /api/skills/add` overwriting built-in `mg-soft-clay-story` -> HTTP 400 (protected).
 *    - `POST /api/skills/add` with draft dir missing `SKILL.md` -> HTTP 400 with clear error.
 * 4. Success path:
 *    - Promote a declarative Reference-to-Skill `draft_dir` (`SKILL.md`, `examples/kit.json`,
 *      `examples/script/<slug>-kit.js`, `examples/story.example.json`, `assets/kit-gallery.jpg`)
 *      via `POST /api/skills/add` (`origin: "reference"`, `source_video: "ref_pinterest.mp4"`).
 *    - Verify `GET /api/skills` exposes it with `hasKit: true, deletable: true, builtin: false, origin: "reference"`,
 *      zero legacy `REMOTION_BRIEF.md`, and `assets/kit-gallery.jpg` preserved.
 *    - Delete it cleanly via `DELETE /api/skills/:id` -> HTTP 200 and verify removal from API & disk.
 *    - Deleting a second time -> HTTP 404.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NO_KEEPALIVE_AGENT = new http.Agent({ keepAlive: false });

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function resolveEngineBinary() {
  const exe = process.platform === "win32" ? "aetheria-engine.exe" : "aetheria-engine";
  const candidates = [
    path.join(REPO_ROOT, "target", "debug", exe),
    path.join(REPO_ROOT, "target", "release", exe),
  ].filter((p) => fs.existsSync(p));
  if (candidates.length === 0) {
    throw new Error(`Engine binary not found. Run "npm run build:engine" first.`);
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function api(baseUrl, urlPath, { method = "GET", authHeader, body, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}${urlPath}`);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Connection: "close" };
    if (authHeader) headers.Authorization = authHeader;
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload, "utf8");
    }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent: NO_KEEPALIVE_AGENT,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // non-json
          }
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, text, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`HTTP timeout on ${urlPath}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function main() {
  const engineBin = resolveEngineBinary();
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(12).toString("hex");
  const authHeader = "Basic " + Buffer.from(`aetheria:${password}`, "utf8").toString("base64");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetheria-ref2skill-e2e-"));
  const testSlug = `e2e-ref-skill-${Date.now()}`;
  const installedSkillDir = path.join(REPO_ROOT, ".aetheria", "skills", testSlug);

  const engineLogs = [];
  const engine = spawn(engineBin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AETHERIA_SERVER_USERNAME: "aetheria",
      AETHERIA_SERVER_PASSWORD: password,
      AETHERIA_WORKSPACE: tempRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  engine.stdout.on("data", (d) => engineLogs.push(d.toString()));
  engine.stderr.on("data", (d) => engineLogs.push(d.toString()));

  try {
    // 1. Wait for /api/health
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await api(baseUrl, "/api/health", { authHeader, timeoutMs: 5_000 });
        if (res.ok && (res.json?.data?.healthy ?? res.json?.healthy)) {
          healthy = true;
          break;
        }
      } catch {
        // retry
      }
    }
    assert(healthy, `Engine did not pass /api/health:\n${engineLogs.join("")}`);

    // 2. GET /api/skills lists protected built-ins
    const listBefore = await api(baseUrl, "/api/skills", { authHeader });
    assert(listBefore.ok && listBefore.json?.success === true, `GET /api/skills failed: ${listBefore.text}`);
    const builtinSkill = (listBefore.json.skills || []).find((s) => s.id === "mg-soft-clay-story");
    assert(builtinSkill, "mg-soft-clay-story should be listed");
    assert(builtinSkill.builtin === true && builtinSkill.deletable === false, `expected protected built-in flags: ${JSON.stringify(builtinSkill)}`);

    // 3. Failure path: deleting built-in returns 403 and preserves folder
    const delBuiltin = await api(baseUrl, "/api/skills/mg-soft-clay-story", {
      method: "DELETE",
      authHeader,
    });
    assert(delBuiltin.status === 403 && delBuiltin.json?.success === false, `expected 403 on built-in delete, got ${delBuiltin.status}: ${delBuiltin.text}`);
    assert(fs.existsSync(path.join(REPO_ROOT, ".aetheria", "skills", "mg-soft-clay-story", "SKILL.md")), "built-in SKILL.md must remain intact");

    // 4. Failure path: overwriting built-in returns 400
    const overwriteBuiltin = await api(baseUrl, "/api/skills/add", {
      method: "POST",
      authHeader,
      body: { name: "mg-soft-clay-story", content: "# Hijack" },
    });
    assert(overwriteBuiltin.status === 400 && overwriteBuiltin.json?.success === false, `expected 400 on built-in overwrite, got ${overwriteBuiltin.status}: ${overwriteBuiltin.text}`);

    // 5. Failure path: draft dir missing SKILL.md returns 400
    const brokenDraft = path.join(tempRoot, "broken-draft");
    fs.mkdirSync(brokenDraft, { recursive: true });
    const brokenRes = await api(baseUrl, "/api/skills/add", {
      method: "POST",
      authHeader,
      body: { name: `${testSlug}-broken`, draft_dir: brokenDraft },
    });
    assert(brokenRes.status === 400 && brokenRes.json?.success === false, `expected 400 on missing SKILL.md, got ${brokenRes.status}: ${brokenRes.text}`);

    // 6. Success path: promote a declarative Reference-to-Skill draft directory
    const validDraft = path.join(tempRoot, "projects", "ref-demo", "draft-skill");
    fs.mkdirSync(path.join(validDraft, "examples", "script"), { recursive: true });
    fs.mkdirSync(path.join(validDraft, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(validDraft, "SKILL.md"),
      `---\nname: ${testSlug}\ndescription: Declarative reference style kit for E2E verification.\n---\n# ${testSlug}\n\nHigh-contrast editorial cards derived from reference.\n`
    );
    fs.writeFileSync(
      path.join(validDraft, "examples", "kit.json"),
      JSON.stringify({ name: testSlug, scripts: [`script/${testSlug}-kit.js`] }, null, 2)
    );
    fs.writeFileSync(
      path.join(validDraft, "examples", "script", `${testSlug}-kit.js`),
      `window.RefTestKit = { version: 1 };\n`
    );
    fs.writeFileSync(
      path.join(validDraft, "examples", "story.example.json"),
      JSON.stringify({ meta: { width: 1080, height: 1920, fps: 30 }, shots: [] }, null, 2)
    );
    fs.writeFileSync(path.join(validDraft, "assets", "kit-gallery.jpg"), Buffer.from("FFD8FFE000104A464946", "hex"));

    const addRes = await api(baseUrl, "/api/skills/add", {
      method: "POST",
      authHeader,
      body: {
        name: testSlug,
        draft_dir: validDraft,
        origin: "reference",
        source_video: "ref_pinterest.mp4",
      },
    });
    assert(addRes.ok && addRes.json?.success === true, `draft promotion failed (${addRes.status}): ${addRes.text}`);
    assert(addRes.json.skill.id === testSlug, "registered id matches");
    assert(addRes.json.skill.hasKit === true, "registered hasKit === true");
    assert(addRes.json.skill.deletable === true && addRes.json.skill.builtin === false, "registered custom flags");
    assert(addRes.json.skill.origin === "reference", "registered origin === reference");
    assert(addRes.json.skill.sourceVideo === "ref_pinterest.mp4", "registered sourceVideo preserved");
    assert(!fs.existsSync(path.join(installedSkillDir, "REMOTION_BRIEF.md")), "no legacy REMOTION_BRIEF.md");
    assert(fs.existsSync(path.join(installedSkillDir, "skill-meta.json")), "skill-meta.json written");
    assert(fs.existsSync(path.join(installedSkillDir, "assets", "kit-gallery.jpg")), "assets/kit-gallery.jpg copied");

    // 7. Verify GET /api/skills reflects newly promoted skill
    const listAfterAdd = await api(baseUrl, "/api/skills", { authHeader });
    const found = (listAfterAdd.json?.skills || []).find((s) => s.id === testSlug);
    assert(found && found.deletable === true && found.hasKit === true && found.origin === "reference", `new skill missing from GET /api/skills: ${JSON.stringify(found)}`);

    // 8. Delete the promoted custom skill cleanly
    const delCustom = await api(baseUrl, `/api/skills/${testSlug}`, {
      method: "DELETE",
      authHeader,
    });
    assert(delCustom.ok && delCustom.json?.success === true && delCustom.json?.deletedId === testSlug, `delete custom skill failed: ${delCustom.text}`);
    assert(!fs.existsSync(installedSkillDir), "deleted skill dir removed from disk");

    // 9. Second delete returns 404
    const delAgain = await api(baseUrl, `/api/skills/${testSlug}`, {
      method: "DELETE",
      authHeader,
    });
    assert(delAgain.status === 404, `expected 404 on second delete, got ${delAgain.status}`);

    console.log(
      JSON.stringify(
        {
          status: "PASSED",
          testSlug,
          checked: {
            health: true,
            builtinProtected403: true,
            builtinOverwriteBlocked400: true,
            brokenDraftRejected400: true,
            draftPromotionWithKitAndGallery: true,
            zeroRemotionLegacyArtifacts: true,
            customSkillDeleted200: true,
            secondDelete404: true,
          },
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(installedSkillDir, { recursive: true, force: true });
    try {
      if (process.platform === "win32" && engine.pid) {
        execSync(`taskkill /F /T /PID ${engine.pid}`, { stdio: "ignore", windowsHide: true });
      } else {
        engine.kill("SIGKILL");
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[REF2SKILL_E2E_FATAL]", err);
  process.exit(1);
});
