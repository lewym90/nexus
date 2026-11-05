#!/usr/bin/env bash
# Instaluje serwer synchronizacji Nexus obok istniejących aplikacji. Dodaje tylko własną trasę w /etc/caddy/conf.d.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
main() {
[ "$(id -u)" -eq 0 ] || { echo "Uruchom przez sudo."; exit 1; }
command -v caddy >/dev/null || { echo "STOP: ten skrypt wymaga działającego Caddy."; exit 2; }
IP=$(curl -4fsS https://api.ipify.org)
HOST="${IP//./-}.sslip.io"
PORT=18872
if ss -ltnpH "( sport = :$PORT )" | grep -v node | grep -q .; then echo "STOP: port $PORT jest zajęty."; exit 2; fi
CF=/etc/caddy/Caddyfile
if ! grep -q 'conf.d' "$CF"; then echo "STOP: Caddyfile nie wczytuje conf.d. Nic nie zmieniam."; exit 2; fi
DIR=/opt/nexus-sync
DATA=/var/lib/nexus-sync
ENVF=/etc/nexus-sync.env
command -v node >/dev/null || { apt-get update -qq; timeout 600 apt-get install -y -qq -o Dpkg::Options::=--force-confold nodejs >/dev/null; }
id nexussync >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin nexussync
mkdir -p "$DIR" "$DATA"
BRANCH="${NEXUS_BRANCH:-main}"
curl -fsSL "https://raw.githubusercontent.com/lewym90/nexus/$BRANCH/server/index.mjs" -o "$DIR/index.mjs"
chown -R nexussync: "$DATA"
SECRET=""
if [ ! -f "$ENVF" ]; then
  SECRET=$(openssl rand -hex 32)
  umask 077
  # Serwer dostaje tylko skrót. Samego kodu nie zapisujemy: to z niego powstaje klucz szyfrowania.
  TOKEN=$(printf 'nexus-auth:%s' "$SECRET" | sha256sum | cut -d' ' -f1)
  printf 'TOKEN=%s\nPORT=%s\nDATA_DIR=%s\n' "$TOKEN" "$PORT" "$DATA" > "$ENVF"
  chown nexussync: "$ENVF"
fi
cat > /etc/systemd/system/nexus-sync.service <<EOF
[Unit]
Description=Nexus sync
After=network-online.target
[Service]
User=nexussync
EnvironmentFile=$ENVF
WorkingDirectory=$DIR
ExecStart=$(command -v node) index.mjs
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
[Install]
WantedBy=multi-user.target
EOF
printf 'handle_path /nexus-sync/* {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$PORT" > /etc/caddy/conf.d/nexus-sync.caddy
caddy validate --config "$CF" --adapter caddyfile >/dev/null
systemctl daemon-reload
systemctl enable --now nexus-sync >/dev/null
systemctl restart nexus-sync
systemctl reload caddy
sleep 3
curl -fsS "https://$HOST/nexus-sync/health" >/dev/null && STATUS=OK || STATUS="BŁĄD: https://$HOST/nexus-sync/health nie odpowiada"
echo
echo "Status: $STATUS"
if [ -n "$SECRET" ]; then
  echo "Kod do aplikacji (zapisz go w bezpiecznym miejscu, nie da się go odzyskać):"
  echo "https://$HOST/nexus-sync#$SECRET"
else
  echo "Serwer zaktualizowany. Kod do aplikacji pozostaje bez zmian."
fi
}
main </dev/null
