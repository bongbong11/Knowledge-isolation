#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PLUGIN_VERSION="0.8.1"
PLUGIN_URL="https://raw.githubusercontent.com/bongbong11/Scene_Reader_Hub/main/downloads/scene-reader-jev-plugin-v0.8.1.zip"
ST_DIR="${1:-$HOME/SillyTavern}"
PLUGIN_DIR="$ST_DIR/plugins/scene-reader-jev"

echo "=================================================="
echo " Scene Reader Jev 서버 플러그인 ${PLUGIN_VERSION}"
echo " Termux 안전 설치/업데이트"
echo "=================================================="
echo
echo "[안전 범위]"
echo "수정 대상: $PLUGIN_DIR"
echo "SillyTavern data, 채팅, 캐릭터, 백업, 다른 확장/플러그인은 건드리지 않습니다."
echo

if [ ! -d "$ST_DIR" ]; then
    echo "[중단] SillyTavern 폴더를 찾을 수 없습니다:"
    echo "  $ST_DIR"
    echo
    echo "다른 위치에 설치했다면 아래처럼 경로를 인수로 넣어 실행하세요."
    echo "  bash install-scene-reader-jev-termux.sh /실제/SillyTavern/경로"
    exit 1
fi

for cmd in curl unzip cp mkdir mktemp date grep; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "[중단] 필요한 명령이 없습니다: $cmd"
        echo "Termux에서 먼저 실행하세요:"
        echo "  pkg install curl unzip coreutils"
        exit 1
    fi
done

TMP_DIR="$(mktemp -d "$HOME/scene-reader-jev-install-XXXXXX")"
ZIP_FILE="$TMP_DIR/scene-reader-jev-plugin-v${PLUGIN_VERSION}.zip"

echo "[1/6] 플러그인 ZIP 다운로드"
curl -fL "$PLUGIN_URL" -o "$ZIP_FILE"

echo "[2/6] 임시 폴더에 압축 해제"
unzip -q "$ZIP_FILE" -d "$TMP_DIR"

SRC_DIR="$TMP_DIR/scene-reader-jev"

echo "[3/6] 새 플러그인 구조 확인"
required_files=(
    "package.json"
    "index.cjs"
    "storage.cjs"
    "retrieval-cache.cjs"
)
required_dirs=(
    "storage"
    "vendor"
)

for item in "${required_files[@]}"; do
    if [ ! -f "$SRC_DIR/$item" ]; then
        echo "[중단] 새 플러그인에 필수 파일이 없습니다: $item"
        echo "기존 플러그인은 건드리지 않았습니다."
        exit 1
    fi
done

for item in "${required_dirs[@]}"; do
    if [ ! -d "$SRC_DIR/$item" ]; then
        echo "[중단] 새 플러그인에 필수 폴더가 없습니다: $item/"
        echo "기존 플러그인은 건드리지 않았습니다."
        exit 1
    fi
done

if ! grep -q '"version"[[:space:]]*:[[:space:]]*"0\.8\.1"' "$SRC_DIR/package.json"; then
    echo "[중단] 다운로드한 플러그인의 버전이 0.8.1로 확인되지 않습니다."
    echo "기존 플러그인은 건드리지 않았습니다."
    exit 1
fi

echo "[4/6] 기존 플러그인 백업"
if [ -d "$PLUGIN_DIR" ]; then
    BACKUP_DIR="$HOME/scene-reader-jev-backup-$(date +%Y%m%d-%H%M%S)"
    cp -a "$PLUGIN_DIR" "$BACKUP_DIR"
    echo "  백업: $BACKUP_DIR"
else
    echo "  기존 플러그인 없음 - 백업 생략"
fi

echo "[5/6] scene-reader-jev 폴더에 0.8.1 전체 내용 덮어쓰기"
mkdir -p "$PLUGIN_DIR"
cp -a "$SRC_DIR/." "$PLUGIN_DIR/"

echo "[6/6] 설치 결과 확인"
for item in "${required_files[@]}"; do
    if [ ! -f "$PLUGIN_DIR/$item" ]; then
        echo "[오류] 설치 후 필수 파일이 없습니다: $item"
        exit 1
    fi
done
for item in "${required_dirs[@]}"; do
    if [ ! -d "$PLUGIN_DIR/$item" ]; then
        echo "[오류] 설치 후 필수 폴더가 없습니다: $item/"
        exit 1
    fi
done

echo
echo "설치 완료: Scene Reader Jev 서버 플러그인 ${PLUGIN_VERSION}"
echo "위치: $PLUGIN_DIR"
echo

CONFIG="$ST_DIR/config.yaml"
if [ -f "$CONFIG" ]; then
    if grep -Eq '^[[:space:]]*enableServerPlugins:[[:space:]]*true([[:space:]]*(#.*)?)?$' "$CONFIG"; then
        echo "enableServerPlugins: true 확인 완료"
    else
        echo "[확인 필요] config.yaml의 enableServerPlugins가 true인지 직접 확인하세요."
        echo "이 스크립트는 config.yaml을 자동 수정하지 않습니다."
    fi
else
    echo "[확인 필요] config.yaml을 찾지 못했습니다."
    echo "SillyTavern 설치 경로가 맞는지 확인하세요."
fi

echo
echo "이제 SillyTavern 서버를 평소 사용하던 방법으로 완전히 재시작하세요."
echo "기존 사용자라면 Hub 0.2.1에서 '📦 자료 이사'를 진행하세요."
echo
echo "참고: 다운로드/압축 임시 폴더는 다음 위치에 남아 있습니다."
echo "  $TMP_DIR"
