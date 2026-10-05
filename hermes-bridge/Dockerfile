# Lightweight bridge: talks to Postgres (hermy-hq's DB) and to the Hermes
# gateway's built-in OpenAI-compatible API server over plain HTTP. Also
# reads a READ-ONLY bind mount of kanban.db from the real
# Hermes agent's data dir — no shared /opt/data mount, no local `hermes`
# CLI, no concurrent write access to the live agent's session/state files.
FROM node:20-alpine
WORKDIR /bridge
# better-sqlite3 needs to compile a native addon on install.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY bridge.mjs command.mjs queue.mjs dashboard-client.mjs result-resolver.mjs kanban-reader.mjs execution-event.mjs agent-activity.mjs block-state.mjs ./
USER node
ENTRYPOINT ["node", "bridge.mjs"]
