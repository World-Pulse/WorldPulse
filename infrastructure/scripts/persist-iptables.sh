#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# persist-iptables.sh — Make Docker→Ollama iptables rule survive reboots
#
# Run once on the prod server (142.93.71.102):
#   sudo bash infrastructure/scripts/persist-iptables.sh
#
# What it does:
#   1. Adds the rule if not already present
#   2. Installs iptables-persistent so rules auto-load on boot
#   3. Saves current rules
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RULE="-p tcp -s 172.16.0.0/12 --dport 11434 -j ACCEPT"

# Add rule if not already present
if ! iptables -C INPUT $RULE 2>/dev/null; then
  echo "[+] Adding iptables rule: allow Docker bridge → Ollama (11434)"
  iptables -I INPUT $RULE
else
  echo "[=] Rule already exists"
fi

# Install iptables-persistent (auto-saves on install)
if ! dpkg -l | grep -q iptables-persistent; then
  echo "[+] Installing iptables-persistent..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
else
  echo "[=] iptables-persistent already installed"
fi

# Save current rules
echo "[+] Saving iptables rules..."
iptables-save > /etc/iptables/rules.v4
echo "[✓] Done — rule will persist across reboots"
