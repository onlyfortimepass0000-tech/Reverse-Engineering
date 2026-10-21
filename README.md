# Alochana

Reverse engineering workspace powered by [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) v6.7.0.

## Quick start

1. **Install tools** (run once per environment):
   ```bash
   bash scripts/install-rea.sh
   ```

2. **Source environment variables**:
   ```bash
   source rea.env
   ```

3. The `.mcp.json` at repo root registers the REA MCP server automatically in Claude Code sessions that open this project.

## What's included

| Category | Tools |
|----------|-------|
| Native analysis | Ghidra 12.1.4, Kuna 1.833 |
| Android | JADX MCP 0.7.1, Apktool 3.0.3, adb |
| Binary | Rizin 0.9.1, objdump, GDB 15.1 |
| Exploit dev | pwntools 4.15.0, pwndbg (pinned commit) |
| Firmware | binwalk 3.1.0, unblob 26.6.4 |
| WebAssembly/JS | WABT 1.0.42, Wakaru 1.14.0 |
| .NET | ilspycmd 8.2.0 |
| Captures | tshark, mitmdump 12.2.3 |
| Browser | Chromium 141 (headless, no-sandbox) |
| Dynamic | Frida 17.23.2 |

## Cloud environment setup

For a persistent Claude Code cloud environment, paste the contents of `scripts/install-rea.sh` into the environment's **Setup script** (Environment settings > Edit > Setup script). Add the variables from `rea.env` as **Environment variables**.

### Known limitations

- **Hopper**: The download domain (`hopperapp.com`) is blocked by the default network policy. Add it under **Network access > Allowed domains** in the environment settings.
- **IDA Pro**: Commercial license required; not included.
- **JEB CE**: Requires interactive EULA acceptance and license activation; not automated.
- **MCP tools**: The `.mcp.json` registration takes effect on the next Claude Code session start (not mid-session).
