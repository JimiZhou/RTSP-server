#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <mac|win|linux>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT_DIR/resources/bin"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

FFMPEG_WIN_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip"
FFMPEG_LINUX_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz"
FFMPEG_MAC_X64_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64"
FFMPEG_MAC_ARM64_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64"

MEDIAMTX_VERSION="v1.16.2"
MEDIAMTX_WIN_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_windows_amd64.zip"
MEDIAMTX_LINUX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz"
MEDIAMTX_MAC_X64_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_darwin_amd64.tar.gz"
MEDIAMTX_MAC_ARM64_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_darwin_arm64.tar.gz"

mkdir -p "$BIN_DIR"
find "$BIN_DIR" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +

case "$TARGET" in
  mac)
    mkdir -p "$BIN_DIR/darwin-x64" "$BIN_DIR/darwin-arm64"

    curl -L --fail -o "$TMP_DIR/ffmpeg-darwin-x64" "$FFMPEG_MAC_X64_URL"
    curl -L --fail -o "$TMP_DIR/ffmpeg-darwin-arm64" "$FFMPEG_MAC_ARM64_URL"
    cp "$TMP_DIR/ffmpeg-darwin-x64" "$BIN_DIR/darwin-x64/ffmpeg"
    cp "$TMP_DIR/ffmpeg-darwin-arm64" "$BIN_DIR/darwin-arm64/ffmpeg"

    curl -L --fail -o "$TMP_DIR/mediamtx-darwin-amd64.tar.gz" "$MEDIAMTX_MAC_X64_URL"
    curl -L --fail -o "$TMP_DIR/mediamtx-darwin-arm64.tar.gz" "$MEDIAMTX_MAC_ARM64_URL"
    mkdir -p "$TMP_DIR/amd64" "$TMP_DIR/arm64"
    tar -xzf "$TMP_DIR/mediamtx-darwin-amd64.tar.gz" -C "$TMP_DIR/amd64"
    tar -xzf "$TMP_DIR/mediamtx-darwin-arm64.tar.gz" -C "$TMP_DIR/arm64"
    cp "$TMP_DIR/amd64/mediamtx" "$BIN_DIR/darwin-x64/mediamtx"
    cp "$TMP_DIR/arm64/mediamtx" "$BIN_DIR/darwin-arm64/mediamtx"

    chmod +x "$BIN_DIR/darwin-x64/ffmpeg" "$BIN_DIR/darwin-x64/mediamtx"
    chmod +x "$BIN_DIR/darwin-arm64/ffmpeg" "$BIN_DIR/darwin-arm64/mediamtx"
    ;;
  win)
    mkdir -p "$BIN_DIR/win32-x64"

    curl -L --fail -o "$TMP_DIR/ffmpeg.zip" "$FFMPEG_WIN_URL"
    unzip -q "$TMP_DIR/ffmpeg.zip" -d "$TMP_DIR/ffmpeg-win"
    cp "$(find "$TMP_DIR/ffmpeg-win" -type f -name ffmpeg.exe | head -n 1)" "$BIN_DIR/win32-x64/ffmpeg.exe"

    curl -L --fail -o "$TMP_DIR/mediamtx.zip" "$MEDIAMTX_WIN_URL"
    unzip -q "$TMP_DIR/mediamtx.zip" -d "$TMP_DIR/mediamtx-win"
    cp "$(find "$TMP_DIR/mediamtx-win" -type f -name mediamtx.exe | head -n 1)" "$BIN_DIR/win32-x64/mediamtx.exe"
    ;;
  linux)
    mkdir -p "$BIN_DIR/linux-x64"

    curl -L --fail -o "$TMP_DIR/ffmpeg-linux.tar.xz" "$FFMPEG_LINUX_URL"
    tar -xf "$TMP_DIR/ffmpeg-linux.tar.xz" -C "$TMP_DIR"
    cp "$(find "$TMP_DIR" -type f -path '*/bin/ffmpeg' | head -n 1)" "$BIN_DIR/linux-x64/ffmpeg"

    curl -L --fail -o "$TMP_DIR/mediamtx-linux.tar.gz" "$MEDIAMTX_LINUX_URL"
    mkdir -p "$TMP_DIR/mediamtx-linux"
    tar -xzf "$TMP_DIR/mediamtx-linux.tar.gz" -C "$TMP_DIR/mediamtx-linux"
    cp "$(find "$TMP_DIR/mediamtx-linux" -type f -name mediamtx | head -n 1)" "$BIN_DIR/linux-x64/mediamtx"

    chmod +x "$BIN_DIR/linux-x64/ffmpeg" "$BIN_DIR/linux-x64/mediamtx"
    ;;
  *)
    echo "unsupported target: $TARGET"
    exit 1
    ;;
esac

echo "Downloaded binaries for target: $TARGET"
find "$BIN_DIR" -maxdepth 3 -type f | sort
