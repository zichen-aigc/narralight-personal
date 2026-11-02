import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const cache = new Map();
const MAX_CREDENTIAL_BYTES = 64 * 1024;

function powershellCredentialScript(target) {
    const escapedTarget = target.replaceAll("'", "''");
    return `$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class InfiniteCanvasCredRead {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public Int64 LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr ptr);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr ptr);
}
"@
$ptr=[IntPtr]::Zero
$secret=$null
try {
  if(-not [InfiniteCanvasCredRead]::CredRead('${escapedTarget}',1,0,[ref]$ptr)){ exit 2 }
  $cred=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][InfiniteCanvasCredRead+CREDENTIAL])
  $secret=[Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob,[int]($cred.CredentialBlobSize/2))
  if([string]::IsNullOrWhiteSpace($secret)){ exit 3 }
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret)))
} finally {
  $secret=$null
  if($ptr-ne[IntPtr]::Zero){[InfiniteCanvasCredRead]::CredFree($ptr)}
}`;
}

export function readWindowsCredential(target) {
    if (!/^[A-Z0-9_]{1,80}$/.test(target)) throw new Error("凭据目标名无效");
    if (cache.has(target)) return cache.get(target);
    if (process.platform !== "win32") {
        const secretFile = process.env[`${target}_FILE`] || "";
        if (secretFile) {
            const stat = statSync(secretFile);
            if (!stat.isFile() || stat.size > MAX_CREDENTIAL_BYTES || (stat.mode & 0o077) !== 0) throw new Error(`凭据文件 ${target}_FILE 必须是仅所有者可读且不超过 64 KB 的普通文件`);
        }
        const value = secretFile ? readFileSync(secretFile, "utf8").trim() : process.env[target] || "";
        if (!value) throw new Error(`当前系统无法读取凭据 ${target}`);
        cache.set(target, value);
        return value;
    }
    const encodedCommand = Buffer.from(powershellCredentialScript(target), "utf16le").toString("base64");
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], {
        encoding: "buffer",
        windowsHide: true,
        timeout: 15000,
        maxBuffer: MAX_CREDENTIAL_BYTES,
    });
    if (result.status !== 0 || !result.stdout?.length) throw new Error(`Windows 凭据 ${target} 不可用`);
    const encoded = result.stdout.toString("utf8").trim();
    const decoded = Buffer.from(encoded, "base64");
    try {
        const value = decoded.toString("utf8");
        if (!value) throw new Error(`Windows 凭据 ${target} 为空`);
        cache.set(target, value);
        return value;
    } finally {
        decoded.fill(0);
        result.stdout.fill(0);
        result.stderr?.fill(0);
    }
}

export function clearWindowsCredentialCache() {
    cache.clear();
}
