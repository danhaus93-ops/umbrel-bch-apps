# ---- geo stage: bake the DB-IP country table into the image -----------------
# Runs ONCE at build time. The dashboard must never make a network call to
# locate a peer: shipping the peer list to a hosted geo API would hand a
# passive observer the node's entire topology on every refresh.
#
# Data: DB-IP IP-to-Country Lite, CC BY 4.0 (https://db-ip.com) — attribution
# is rendered in the UI. Centroids: world-countries-centroids (MIT).
# --platform=$BUILDPLATFORM is load-bearing. The image is built for
# linux/amd64,linux/arm64 via QEMU; without this the geo stage runs ONCE PER
# TARGET ARCH, so the arm64 pass fetches 30 MB and grinds ~700k records through
# an emulator. That is what failed the build at 7da78eb (it got lucky twice
# before). Pinning to the builder's own arch runs it once, natively.
#
# This is safe because geo.bin is pure data, not code: every field is written
# with explicit little-endian writers, so the artifact is byte-identical
# whatever built it, and both arch images can share it.
FROM --platform=$BUILDPLATFORM node:20-alpine AS geo
WORKDIR /geo
COPY geo/build-geo.js ./
RUN npm install --no-audit --no-fund --silent \
      world-atlas@2 topojson-client i18n-iso-countries \
 && node build-geo.js /geo/geo.bin \
 && test -s /geo/geo.bin \
 && test -s /geo/centroids.json

# ---- runtime ---------------------------------------------------------------
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public
COPY geo/geo.js ./geo/geo.js
COPY --from=geo /geo/geo.bin /geo/centroids.json ./geo/

# Run as the built-in unprivileged user
USER node

EXPOSE 3000
CMD ["node", "server.js"]
