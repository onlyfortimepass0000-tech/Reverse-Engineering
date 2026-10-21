#!/usr/bin/env bash
set -euo pipefail

# REA (Reverse Engineer Anything) tool installer
# Idempotent — safe to re-run. Installs all REA providers into /opt/rea-tools/.
# Intended for Claude Code cloud environments (Setup script) or local use.

TOOLS_DIR="/opt/rea-tools"
DOWNLOADS_DIR="$TOOLS_DIR/downloads"
mkdir -p "$TOOLS_DIR" "$DOWNLOADS_DIR"

# ── Versions ─────────────────────────────────────────────────────────────────
GHIDRA_VERSION="12.1.4"
GHIDRA_ZIP="ghidra_${GHIDRA_VERSION}_PUBLIC_20260921.zip"
GHIDRA_SHA256="ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db"

KUNA_VERSION="1.833"
KUNA_BINARY_SHA256="f9f088a2bd99d9b87f3c53195ba5b02678828ace6cc3a501acb42b1d483f6a39"

JADX_MCP_VERSION="0.7.1"
JADX_MCP_SHA256="6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75"

APKTOOL_VERSION="3.0.3"
APKTOOL_SHA256="dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423"

PWNTOOLS_VERSION="4.15.0"
PYELFTOOLS_VERSION="0.33"
UNICORN_VERSION="2.1.2"
PWNDBG_COMMIT="55596aa676a2756efb8d67034f31675170eabe48"

MITMPROXY_VERSION="12.2.3"
UNBLOB_VERSION="26.6.4"
WABT_VERSION="1.0.42"
WAKARU_VERSION="1.14.0"
REA_AGENTS_VERSION="6.7.0"

log() { echo "▸ $*"; }

# ── System packages ──────────────────────────────────────────────────────────
log "Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
  unzip curl git default-jdk adb tshark gdb binutils procps cmake \
  python3-pip python3-venv build-essential pkg-config libssl-dev \
  > /dev/null 2>&1

# ── Ghidra ───────────────────────────────────────────────────────────────────
if [ ! -d "$TOOLS_DIR/ghidra_${GHIDRA_VERSION}_PUBLIC" ]; then
  log "Installing Ghidra ${GHIDRA_VERSION}..."
  cd "$DOWNLOADS_DIR"
  curl -fsSL -o "$GHIDRA_ZIP" \
    "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/$GHIDRA_ZIP"
  echo "$GHIDRA_SHA256  $GHIDRA_ZIP" | sha256sum -c -
  unzip -q "$GHIDRA_ZIP" -d "$TOOLS_DIR"
  chmod +x "$TOOLS_DIR/ghidra_${GHIDRA_VERSION}_PUBLIC/support/analyzeHeadless"
else
  log "Ghidra ${GHIDRA_VERSION} already installed."
fi

# ── Kuna ─────────────────────────────────────────────────────────────────────
KUNA_DIR="$TOOLS_DIR/kuna/kuna-v${KUNA_VERSION}-linux-x86_64"
if [ ! -x "$KUNA_DIR/kuna" ]; then
  log "Installing Kuna ${KUNA_VERSION}..."
  cd "$DOWNLOADS_DIR"
  curl -fsSL -o "kuna-v${KUNA_VERSION}-linux-x86_64.tar.gz" \
    "https://github.com/Noelo-Lab/kuna/releases/download/v${KUNA_VERSION}/kuna-v${KUNA_VERSION}-linux-x86_64.tar.gz"
  mkdir -p "$TOOLS_DIR/kuna"
  tar xzf "kuna-v${KUNA_VERSION}-linux-x86_64.tar.gz" -C "$TOOLS_DIR/kuna"
  chmod +x "$KUNA_DIR/kuna"
  echo "$KUNA_BINARY_SHA256  $KUNA_DIR/kuna" | sha256sum -c -
else
  log "Kuna ${KUNA_VERSION} already installed."
fi

# ── JADX MCP ─────────────────────────────────────────────────────────────────
JADX_JAR="$TOOLS_DIR/android/jadx-headless-mcp-${JADX_MCP_VERSION}-all.jar"
if [ ! -f "$JADX_JAR" ]; then
  log "Installing JADX MCP ${JADX_MCP_VERSION}..."
  mkdir -p "$TOOLS_DIR/android"
  cd "$DOWNLOADS_DIR"
  curl -fsSL -o "jadx-headless-mcp-${JADX_MCP_VERSION}-all.jar" \
    "https://github.com/1013503897/jadx-headless-mcp/releases/download/v${JADX_MCP_VERSION}/jadx-headless-mcp-${JADX_MCP_VERSION}-all.jar"
  echo "$JADX_MCP_SHA256  jadx-headless-mcp-${JADX_MCP_VERSION}-all.jar" | sha256sum -c -
  cp "jadx-headless-mcp-${JADX_MCP_VERSION}-all.jar" "$JADX_JAR"
else
  log "JADX MCP ${JADX_MCP_VERSION} already installed."
fi

# ── Apktool ──────────────────────────────────────────────────────────────────
APKTOOL_JAR="$TOOLS_DIR/android/apktool_${APKTOOL_VERSION}.jar"
if [ ! -f "$APKTOOL_JAR" ]; then
  log "Installing Apktool ${APKTOOL_VERSION}..."
  mkdir -p "$TOOLS_DIR/android"
  cd "$DOWNLOADS_DIR"
  curl -fsSL -o "apktool_${APKTOOL_VERSION}.jar" \
    "https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar"
  echo "$APKTOOL_SHA256  apktool_${APKTOOL_VERSION}.jar" | sha256sum -c -
  cp "apktool_${APKTOOL_VERSION}.jar" "$APKTOOL_JAR"
else
  log "Apktool ${APKTOOL_VERSION} already installed."
fi

# ── Rizin ────────────────────────────────────────────────────────────────────
if ! command -v rizin &>/dev/null; then
  log "Installing Rizin..."
  cd "$DOWNLOADS_DIR"
  RIZIN_TAG=$(git ls-remote --tags https://github.com/rizinorg/rizin.git \
    | grep -oP 'refs/tags/v\K[0-9.]+$' | sort -V | tail -1)
  curl -fsSL -o "rizin-v${RIZIN_TAG}-static-x86_64.tar.xz" \
    "https://github.com/rizinorg/rizin/releases/download/v${RIZIN_TAG}/rizin-v${RIZIN_TAG}-static-x86_64.tar.xz"
  mkdir -p "$TOOLS_DIR/rizin"
  tar xJf "rizin-v${RIZIN_TAG}-static-x86_64.tar.xz" -C "$TOOLS_DIR/rizin" --strip-components=1
  ln -sf "$TOOLS_DIR/rizin/bin/rizin" /usr/local/bin/rizin
else
  log "Rizin already installed."
fi

# ── pwntools venv ────────────────────────────────────────────────────────────
if [ ! -d "$TOOLS_DIR/pwntools-venv" ]; then
  log "Installing pwntools ${PWNTOOLS_VERSION}..."
  uv venv "$TOOLS_DIR/pwntools-venv"
  uv pip install --python "$TOOLS_DIR/pwntools-venv/bin/python" \
    "pwntools==${PWNTOOLS_VERSION}" "pyelftools==${PYELFTOOLS_VERSION}" "unicorn==${UNICORN_VERSION}"
else
  log "pwntools venv already exists."
fi

# ── pwndbg ───────────────────────────────────────────────────────────────────
if [ ! -d "$TOOLS_DIR/pwndbg" ]; then
  log "Installing pwndbg..."
  git clone https://github.com/pwndbg/pwndbg.git "$TOOLS_DIR/pwndbg"
  cd "$TOOLS_DIR/pwndbg"
  git checkout "$PWNDBG_COMMIT"
  uv venv .venv
  uv sync
else
  log "pwndbg already installed."
fi

# ── Binwalk ──────────────────────────────────────────────────────────────────
if ! command -v binwalk &>/dev/null; then
  log "Installing binwalk via cargo..."
  cargo install binwalk
else
  log "Binwalk already installed."
fi

# ── Unblob ───────────────────────────────────────────────────────────────────
if ! command -v unblob &>/dev/null; then
  log "Installing unblob ${UNBLOB_VERSION}..."
  pip3 install "unblob==${UNBLOB_VERSION}"
else
  log "Unblob already installed."
fi

# ── mitmproxy ────────────────────────────────────────────────────────────────
if ! command -v mitmdump &>/dev/null; then
  log "Installing mitmproxy ${MITMPROXY_VERSION}..."
  pip3 install "mitmproxy==${MITMPROXY_VERSION}"
else
  log "mitmproxy already installed."
fi

# ── WABT ─────────────────────────────────────────────────────────────────────
if [ ! -d "$TOOLS_DIR/wabt/bin" ]; then
  log "Installing WABT ${WABT_VERSION}..."
  cd "$DOWNLOADS_DIR"
  curl -fsSL -o "wabt-${WABT_VERSION}.tar.gz" \
    "https://github.com/WebAssembly/wabt/releases/download/${WABT_VERSION}/wabt-${WABT_VERSION}-ubuntu-20.04.tar.gz" \
    || {
      log "Pre-built WABT not available, building from source..."
      git clone --depth 1 --branch "${WABT_VERSION}" --recurse-submodules \
        https://github.com/WebAssembly/wabt.git "$TOOLS_DIR/wabt-src"
      cd "$TOOLS_DIR/wabt-src"
      mkdir build && cd build
      cmake .. -DCMAKE_INSTALL_PREFIX="$TOOLS_DIR/wabt"
      make -j"$(nproc)" install
    }
  if [ -f "$DOWNLOADS_DIR/wabt-${WABT_VERSION}.tar.gz" ]; then
    mkdir -p "$TOOLS_DIR/wabt"
    tar xzf "$DOWNLOADS_DIR/wabt-${WABT_VERSION}.tar.gz" -C "$TOOLS_DIR/wabt" --strip-components=1
  fi
else
  log "WABT already installed."
fi

# ── Wakaru ───────────────────────────────────────────────────────────────────
if ! command -v wakaru &>/dev/null; then
  log "Installing Wakaru ${WAKARU_VERSION}..."
  cd "$DOWNLOADS_DIR"
  curl -fsSL -o "wakaru-linux-x64.tar.gz" \
    "https://github.com/pionxzh/wakaru/releases/download/v${WAKARU_VERSION}/wakaru-linux-x64.tar.gz"
  mkdir -p "$TOOLS_DIR/wakaru"
  tar xzf "wakaru-linux-x64.tar.gz" -C "$TOOLS_DIR/wakaru"
  chmod +x "$TOOLS_DIR/wakaru/wakaru"
  ln -sf "$TOOLS_DIR/wakaru/wakaru" /usr/local/bin/wakaru
else
  log "Wakaru already installed."
fi

# ── ilspycmd ─────────────────────────────────────────────────────────────────
if ! command -v ilspycmd &>/dev/null && [ ! -x "$HOME/.dotnet/tools/ilspycmd" ]; then
  log "Installing ilspycmd..."
  dotnet tool install -g ilspycmd
else
  log "ilspycmd already installed."
fi

# ── Frida ────────────────────────────────────────────────────────────────────
if ! npm list -g frida &>/dev/null; then
  log "Installing Frida Node.js bindings..."
  npm install -g frida@17.23.2
fi
if ! command -v frida &>/dev/null; then
  log "Installing frida-tools..."
  pip3 install frida-tools
fi

# ── REA agents & setup ───────────────────────────────────────────────────────
log "Running REA setup..."
export GHIDRA_INSTALL_DIR="$TOOLS_DIR/ghidra_${GHIDRA_VERSION}_PUBLIC"
export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
export REA_KUNA_COMMAND="$KUNA_DIR/kuna"
export REA_JADX_MCP_JAR="$JADX_JAR"
export REA_APKTOOL_COMMAND="java -jar $APKTOOL_JAR"
export REA_ADB_PATH="/usr/bin/adb"
export REA_RIZIN_COMMAND="/usr/local/bin/rizin"
export REA_OBJDUMP_COMMAND="/usr/bin/objdump"
export REA_GDB_COMMAND="/usr/bin/gdb"
export REA_PWNTOOLS_PYTHON="$TOOLS_DIR/pwntools-venv/bin/python"
export REA_PWNDBG_GDB="/usr/bin/gdb"
export REA_PWNDBG_GDBINIT="$TOOLS_DIR/pwndbg/gdbinit.py"
export REA_PWNDBG_VENV_PATH="$TOOLS_DIR/pwndbg/.venv"
export REA_BINWALK_COMMAND="$HOME/.cargo/bin/binwalk"
export REA_UNBLOB_COMMAND="/usr/local/bin/unblob"
export REA_WABT_BIN_DIRECTORY="$TOOLS_DIR/wabt/bin"
export REA_WAKARU_COMMAND="/usr/local/bin/wakaru"
export REA_ILSPY_CMD_PATH="$HOME/.dotnet/tools/ilspycmd"
export REA_TSHARK_COMMAND="/usr/bin/tshark"
export REA_MITMDUMP_COMMAND="/usr/local/bin/mitmdump"
export DOTNET_ROLL_FORWARD=Major

npx -y "rea-agents@${REA_AGENTS_VERSION}" setup --client claude_code --yes --json

log "REA installation complete!"
npx -y "rea-agents@${REA_AGENTS_VERSION}" doctor --json | python3 -I -c "
import json,sys
d=json.loads(sys.stdin.read())
print('Doctor: healthy=' + str(d.get('healthy')))
for p in d.get('providerInspections',[]):
    s='OK' if p['available'] else 'MISS'
    print(f'  {p[\"id\"]:12s} {s}')
"
