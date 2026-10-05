FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Runtime user matches the owner of the shared Hermes wiki (uid/gid 10000
# 'hermes' on the VPS), so files Hermy HQ creates in /wiki are owned exactly
# like the rest of the wiki. The base image's 'node' user is uid 1000, so
# 10000 is free. A real home dir keeps npm's cache/log writes working.
RUN groupadd -g 10000 hermes \
  && useradd -u 10000 -g 10000 -m -d /home/hermes -s /usr/sbin/nologin hermes

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . ./
# Next.js writes to .next/cache at runtime (image optimization, ISR/fetch
# cache). Everything else under /app stays root-owned and read-only.
RUN npx prisma generate && npm run build \
  && mkdir -p .next/cache \
  && chown -R 10000:10000 .next

USER 10000:10000

EXPOSE 3000
CMD ["npm", "start"]
