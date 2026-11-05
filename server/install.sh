#!/usr/bin/env bash
# Instaluje serwer synchronizacji Nexus obok istniejących aplikacji. Dodaje tylko własną trasę w /etc/caddy/conf.d.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
main() {
[ "$(id -u)" -eq 0 ] || { echo "Uruchom przez sudo."; exit 1; }
command -v caddy >/dev/null || { echo "STOP: ten skrypt wymaga działającego Caddy."; exit 2; }
command -v ss >/dev/null || { echo "STOP: brak polecenia ss, nie sprawdzę portów."; exit 2; }
IP=$(curl -4fsS https://api.ipify.org)
HOST="${IP//./-}.sslip.io"
CF=/etc/caddy/Caddyfile
if ! grep -q 'conf.d' "$CF"; then echo "STOP: Caddyfile nie wczytuje conf.d. Nic nie zmieniam."; exit 2; fi
DIR=/opt/nexus-sync
DATA=/var/lib/nexus-sync
ENVF=/etc/nexus-sync.env
ROUTE=/etc/caddy/conf.d/nexus-sync.caddy
UNIT=/etc/systemd/system/nexus-sync.service
# Adres /nexus-sync/ nie może należeć do innej aplikacji.
# Wyniki trafiają do zmiennych: przy pipefail potok z grep -q potrafi fałszywie zgłosić „nic nie znaleziono”.
foreign_files() { grep -rlsE "$1" "${@:2}" 2>/dev/null | grep -vE "^($ROUTE|$UNIT|$ENVF)$" || true; }
if [ -n "$(foreign_files '/nexus-sync(/|\b)' /etc/caddy)" ]; then echo "STOP: trasa /nexus-sync jest już użyta w Caddy. Nic nie zmieniam."; exit 2; fi
# Port: zajęty to taki, którego ktoś słucha albo który ma zapisany w konfiguracji inna aplikacja (nawet wyłączona).
OWN_PID=$(systemctl show -p MainPID --value nexus-sync 2>/dev/null || echo 0)
listening_foreign() { local L; L=$(ss -ltnpH "( sport = :$1 )" || true); [ -n "$L" ] && [[ "$L" != *"pid=${OWN_PID:-0},"* ]]; }
reserved_foreign() { [ -n "$(foreign_files "(^|[^0-9])$1([^0-9]|\$)" /etc/caddy /etc/systemd/system /etc/*.env)" ]; }
free_port() { ! listening_foreign "$1" && ! reserved_foreign "$1"; }
PORT=""
OLD_PORT=$(sed -n 's/^PORT=//p' "$ENVF" 2>/dev/null || true)
for P in $OLD_PORT $(seq 18872 18999); do free_port "$P" && { PORT=$P; break; }; done
[ -n "$PORT" ] || { echo "STOP: brak wolnego portu w zakresie 18872-18999."; exit 2; }
if ! command -v node >/dev/null; then apt-get update -qq; timeout 600 apt-get install -y -qq -o Dpkg::Options::=--force-confold nodejs >/dev/null; fi
[ "$(node -p 'parseInt(process.versions.node)')" -ge 18 ] || { echo "STOP: potrzebny Node 18 lub nowszy. Nie aktualizuję go, bo mogą z niego korzystać inne aplikacje."; exit 2; }
id nexussync >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin nexussync
mkdir -p "$DIR" "$DATA"
BRANCH="${NEXUS_BRANCH:-main}"
curl -fsSL "https://raw.githubusercontent.com/lewym90/nexus/$BRANCH/server/index.mjs" -o "$DIR/index.mjs"
chown -R nexussync: "$DATA"
SECRET=""
# Nowy kod także po przerwanej instalacji: serwer nie ma jeszcze danych, a poprzedni kod nigdzie się nie zapisał.
if [ ! -f "$ENVF" ] || [ ! -f "$DATA/index.json" ]; then
  SECRET=$(openssl rand -hex 32)
  # Serwer dostaje tylko skrót. Samego kodu nie zapisujemy: to z niego powstaje klucz szyfrowania.
  TOKEN=$(printf 'nexus-auth:%s' "$SECRET" | sha256sum | cut -d' ' -f1)
  # umask tylko dla tego pliku: inaczej trasa Caddy też byłaby prywatna i Caddy nie mógłby jej odczytać.
  ( umask 077; printf 'TOKEN=%s\nPORT=%s\nDATA_DIR=%s\n' "$TOKEN" "$PORT" "$DATA" > "$ENVF" )
  chown nexussync: "$ENVF"
fi
sed -i "s/^PORT=.*/PORT=$PORT/" "$ENVF"
cat > "$UNIT" <<EOF
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
PrivateTmp=true
Nice=10
MemoryMax=256M
CPUQuota=50%
[Install]
WantedBy=multi-user.target
EOF
# Zła trasa w conf.d zablokowałaby przeładowanie Caddy wszystkim aplikacjom: przy błędzie wraca poprzedni stan.
OLD_ROUTE=""; [ -f "$ROUTE" ] && OLD_ROUTE=$(cat "$ROUTE")
undo_route() { if [ -n "$OLD_ROUTE" ]; then printf '%s\n' "$OLD_ROUTE" > "$ROUTE"; else rm -f "$ROUTE"; fi; }
printf 'handle_path /nexus-sync/* {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$PORT" > "$ROUTE"
chmod 644 "$ROUTE" "$UNIT"
if ! caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then undo_route; echo "STOP: Caddy odrzucił konfigurację. Cofnąłem trasę, inne aplikacje działają bez zmian."; exit 2; fi
systemctl daemon-reload
systemctl enable --now nexus-sync >/dev/null
systemctl restart nexus-sync
if ! systemctl reload caddy; then undo_route; systemctl reload caddy || true; systemctl disable --now nexus-sync >/dev/null 2>&1 || true; echo "STOP: przeładowanie Caddy nie powiodło się. Cofnąłem trasę."; exit 2; fi
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
