#!/bin/sh
set -eu

REPOSITORY="MuzzammilRafiq/apreal"
NODE_VERSION="24.18.0"
UV_VERSION="0.11.28"
PYTHON_VERSION="3.14"

home="${HOME}/.apreal"
version=""
assume_yes=false
work_dir=""
install_lock=""

usage() {
	cat <<'EOF'
Usage: install.sh [--home PATH] [--version VERSION] [--yes]

  --home PATH        Install below PATH instead of ~/.apreal
  --version VERSION  Install a specific release, such as 0.1.0 or v0.1.0
  --yes              Do not ask for confirmation
EOF
}

fail() {
	echo "apreal installer: $*" >&2
	exit 1
}

cleanup() {
	if [ -n "$work_dir" ] && [ -d "$work_dir" ]; then
		rm -rf "$work_dir"
	fi
	if [ -n "$install_lock" ] && [ -d "$install_lock" ]; then
		rmdir "$install_lock" 2>/dev/null || true
	fi
}

trap cleanup EXIT HUP INT TERM

while [ "$#" -gt 0 ]; do
	case "$1" in
		--home)
			[ "$#" -ge 2 ] || fail "--home requires a path"
			home=$2
			shift 2
			;;
		--home=*)
			home=${1#--home=}
			[ -n "$home" ] || fail "--home requires a path"
			shift
			;;
		--version)
			[ "$#" -ge 2 ] || fail "--version requires a value"
			version=$2
			shift 2
			;;
		--version=*)
			version=${1#--version=}
			[ -n "$version" ] || fail "--version requires a value"
			shift
			;;
		--yes|-y)
			assume_yes=true
			shift
			;;
		--help|-h)
			usage
			exit 0
			;;
		*)
			fail "unknown argument: $1"
			;;
	esac
done

case "$home" in
	"~") home=$HOME ;;
	"~/"*) home="$HOME/${home#\~/}" ;;
esac

[ "$(uname -s)" = "Darwin" ] || fail "the first Apreal release supports only macOS"
[ "$(uname -m)" = "arm64" ] || fail "the first Apreal release supports only Apple Silicon"

for command in curl tar shasum mktemp; do
	command -v "$command" >/dev/null 2>&1 || fail "required command not found: $command"
done

if [ -z "$version" ]; then
	echo "Resolving latest Apreal release..."
	version=$(curl -fsSL "https://api.github.com/repos/${REPOSITORY}/releases/latest" |
		sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' |
		head -n 1)
	[ -n "$version" ] || fail "unable to resolve the latest GitHub release"
fi
version=${version#v}

case "$version" in
	*[!0-9A-Za-z._-]*|'') fail "invalid version: $version" ;;
esac

artifact_name="apreal-${version}-darwin-arm64.tar.gz"
release_url="https://github.com/${REPOSITORY}/releases/download/v${version}"

echo "Apreal ${version} will be installed in ${home}."
if [ "$assume_yes" != true ]; then
	if [ -t 0 ]; then
		printf "Continue? [y/N] "
		read -r answer
		case "$answer" in
			y|Y|yes|YES) ;;
			*) echo "Installation cancelled."; exit 0 ;;
		esac
	else
		echo "Running non-interactively; continuing installation."
	fi
fi

umask 077
mkdir -p "$home" "$home/versions" "$home/bin" "$home/logs" "$home/run" "$home/backups"
chmod 700 "$home" "$home/versions" "$home/bin" "$home/logs" "$home/run" "$home/backups"

install_lock="$home/run/install.lock"
if ! mkdir "$install_lock" 2>/dev/null; then
	fail "another installation is already using $home"
fi

work_dir=$(mktemp -d "$home/run/install.XXXXXX")
archive="$work_dir/$artifact_name"
checksum_file="$archive.sha256"

echo "Downloading Apreal ${version}..."
curl -fL --retry 3 --output "$archive" "$release_url/$artifact_name"
curl -fL --retry 3 --output "$checksum_file" "$release_url/$artifact_name.sha256"

expected_checksum=$(awk 'NR == 1 { print $1 }' "$checksum_file")
actual_checksum=$(shasum -a 256 "$archive" | awk '{ print $1 }')
[ -n "$expected_checksum" ] || fail "release checksum file is empty"
[ "$actual_checksum" = "$expected_checksum" ] || fail "release artifact checksum verification failed"

extract_dir="$work_dir/extracted"
mkdir "$extract_dir"
tar -xzf "$archive" -C "$extract_dir"
source_release="$extract_dir/apreal-${version}-darwin-arm64"
[ -d "$source_release" ] || fail "release archive has an unexpected directory layout"
[ -f "$source_release/VERSION" ] || fail "release archive does not contain VERSION"
[ "$(tr -d '\r\n' < "$source_release/VERSION")" = "$version" ] || fail "release VERSION does not match $version"
[ -f "$source_release/server/apreal-server.mjs" ] || fail "release archive does not contain the server"
[ -f "$source_release/server/apreal-cli.mjs" ] || fail "release archive does not contain the CLI"
[ -f "$source_release/web/dist/index.html" ] || fail "release archive does not contain the web UI"
[ -f "$source_release/python/pyproject.toml" ] || fail "release archive does not contain the Python project"
[ -f "$source_release/python/uv.lock" ] || fail "release archive does not contain the Python lockfile"
[ -f "$source_release/launcher/apreal" ] || fail "release archive does not contain the launcher"

runtime_dir="$source_release/runtime"
mkdir -p "$runtime_dir/node" "$runtime_dir/uv"

node_archive_name="node-v${NODE_VERSION}-darwin-arm64.tar.gz"
node_base_url="https://nodejs.org/dist/v${NODE_VERSION}"
node_archive="$work_dir/$node_archive_name"
node_checksums="$work_dir/node-SHASUMS256.txt"

echo "Installing private Node.js ${NODE_VERSION}..."
curl -fL --retry 3 --output "$node_archive" "$node_base_url/$node_archive_name"
curl -fL --retry 3 --output "$node_checksums" "$node_base_url/SHASUMS256.txt"
node_expected=$(awk -v name="$node_archive_name" '$2 == name { print $1; exit }' "$node_checksums")
node_actual=$(shasum -a 256 "$node_archive" | awk '{ print $1 }')
[ -n "$node_expected" ] || fail "Node.js did not publish a checksum for $node_archive_name"
[ "$node_actual" = "$node_expected" ] || fail "Node.js checksum verification failed"
tar -xzf "$node_archive" -C "$runtime_dir/node" --strip-components=1

uv_archive_name="uv-aarch64-apple-darwin.tar.gz"
uv_base_url="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"
uv_archive="$work_dir/$uv_archive_name"
uv_checksum_file="$work_dir/$uv_archive_name.sha256"

echo "Installing private uv ${UV_VERSION}..."
curl -fL --retry 3 --output "$uv_archive" "$uv_base_url/$uv_archive_name"
curl -fL --retry 3 --output "$uv_checksum_file" "$uv_base_url/$uv_archive_name.sha256"
uv_expected=$(awk 'NR == 1 { print $1 }' "$uv_checksum_file")
uv_actual=$(shasum -a 256 "$uv_archive" | awk '{ print $1 }')
[ -n "$uv_expected" ] || fail "uv checksum file is empty"
[ "$uv_actual" = "$uv_expected" ] || fail "uv checksum verification failed"

uv_extract_dir="$work_dir/uv"
mkdir "$uv_extract_dir"
tar -xzf "$uv_archive" -C "$uv_extract_dir"
uv_source=$(find "$uv_extract_dir" -type f -name uv -perm -u+x | head -n 1)
[ -n "$uv_source" ] || fail "uv archive does not contain the uv executable"
cp "$uv_source" "$runtime_dir/uv/uv"
chmod 755 "$runtime_dir/uv/uv"

export UV_PYTHON_INSTALL_DIR="$runtime_dir/python"
export UV_CACHE_DIR="$work_dir/uv-cache"
export UV_PROJECT_ENVIRONMENT="$source_release/python/.venv"
export PLAYWRIGHT_BROWSERS_PATH="$runtime_dir/playwright"

echo "Installing private Python ${PYTHON_VERSION} and locked dependencies..."
"$runtime_dir/uv/uv" python install "$PYTHON_VERSION"
"$runtime_dir/uv/uv" sync \
	--project "$source_release/python" \
	--frozen \
	--python "$PYTHON_VERSION"

echo "Installing Playwright Chromium (this is a large download)..."
"$runtime_dir/uv/uv" run \
	--project "$source_release/python" \
	python -m playwright install chromium

destination="$home/versions/$version"
if [ -e "$destination" ]; then
	fail "Apreal $version is already installed at $destination"
fi
mv "$source_release" "$destination"

ln -sfn "versions/$version" "$home/current"

cp "$destination/launcher/apreal" "$home/bin/apreal"
chmod 755 "$home/bin/apreal"

if [ ! -f "$home/config.toml" ]; then
	cat > "$home/config.toml" <<'EOF'
[server]
host = "127.0.0.1"
port = 3000
log_level = "info"
allow_private_network_admin = false
open_browser = true

[paths]
agent_dir = "agent"
logs_dir = "logs"

[development]
cors_allow_origins = []
EOF
	chmod 600 "$home/config.toml"
fi

echo
echo "Apreal ${version} was installed successfully."
echo "Start it with:"
echo "  $home/bin/apreal start --home $home"
echo
echo "Check status with:"
echo "  $home/bin/apreal status --home $home"
