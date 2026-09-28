#!/bin/sh
set -eu
set -a
. /opt/data/home/hermy-hq/.env
set +a
export HOME=/opt/data/home
export HERMES_HOME=/opt/data
export HERMES_BIN=/opt/data/home/.local/bin/hermes
cd /opt/data/home/hermy-hq/hermes-bridge
exec node bridge.mjs
