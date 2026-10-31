#!/bin/sh
# Discos persistentes costumam ser montados como "root": ajusta o dono e roda o site como usuário comum.
set -e
mkdir -p /data/uploads
chown -R node:node /data
exec setpriv --reuid=node --regid=node --init-groups node --no-warnings --import tsx src/server/index.ts
