/**
 * Per-OS screen capture. Returns path to PNG in tmpdir + size.
 *   macOS  — screencapture (built-in)
 *   Linux  — scrot / gnome-screenshot / maim (whichever is installed)
 *   Win    — PowerShell + .NET Bitmap
 */
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const PLATFORM = process.platform;

function safeExec(cmd: string, opts: { timeout?: number } = {}): { ok: boolean; stderr: string } {
  try {
    execSync(cmd, { timeout: opts.timeout ?? 8000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stderr: "" };
  } catch (err: any) {
    return { ok: false, stderr: (err?.stderr?.toString() ?? err?.message ?? "").slice(0, 300) };
  }
}

function checkBinary(bin: string): boolean {
  const which = PLATFORM === "win32" ? "where" : "which";
  const r = spawnSync(which, [bin], { encoding: "utf-8" });
  return r.status === 0;
}

export interface CaptureResult { ok: boolean; path?: string; sizeBytes?: number; error?: string }

export function captureScreen(): CaptureResult {
  const ts = Date.now();
  const tmp = path.join(os.tmpdir(), `anchor-screen-${ts}.png`);

  if (PLATFORM === "darwin") {
    const r = safeExec(`screencapture -x "${tmp}"`);
    return r.ok ? statResult(tmp) : { ok: false, error: r.stderr };
  }
  if (PLATFORM === "linux") {
    if (checkBinary("scrot")) {
      const r = safeExec(`scrot "${tmp}"`);
      return r.ok ? statResult(tmp) : { ok: false, error: r.stderr };
    }
    if (checkBinary("gnome-screenshot")) {
      const r = safeExec(`gnome-screenshot -f "${tmp}"`);
      return r.ok ? statResult(tmp) : { ok: false, error: r.stderr };
    }
    if (checkBinary("maim")) {
      const r = safeExec(`maim "${tmp}"`);
      return r.ok ? statResult(tmp) : { ok: false, error: r.stderr };
    }
    return { ok: false, error: "No screenshot tool found — install scrot / gnome-screenshot / maim" };
  }
  if (PLATFORM === "win32") {
    const ps = `Add-Type -AssemblyName System.Drawing; $b = [System.Drawing.Bitmap]::new([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save('${tmp.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)`;
    const r = safeExec(`powershell -Command "${ps.replace(/"/g, '\\"')}"`);
    return r.ok ? statResult(tmp) : { ok: false, error: r.stderr };
  }
  return { ok: false, error: `unsupported platform ${PLATFORM}` };
}

function statResult(p: string): CaptureResult {
  try {
    const stat = fs.statSync(p);
    return { ok: true, path: p, sizeBytes: stat.size };
  } catch (err: any) {
    return { ok: false, error: `screenshot file missing: ${err.message}` };
  }
}

export function screenshotToBase64(p: string): string {
  return fs.readFileSync(p).toString("base64");
}

export function cleanupScreenshot(p: string): void {
  try { fs.unlinkSync(p); } catch {}
}

export function statusProbe(): { platform: NodeJS.Platform; toolsDetected: Record<string, boolean>; canCapture: boolean } {
  const tools: Record<string, boolean> = {};
  if (PLATFORM === "darwin") tools.screencapture = checkBinary("screencapture");
  else if (PLATFORM === "linux") {
    tools.scrot = checkBinary("scrot");
    tools["gnome-screenshot"] = checkBinary("gnome-screenshot");
    tools.maim = checkBinary("maim");
  }
  else if (PLATFORM === "win32") tools.powershell = checkBinary("powershell") || checkBinary("pwsh");
  const canCapture = Object.values(tools).some(Boolean);
  return { platform: PLATFORM, toolsDetected: tools, canCapture };
}
