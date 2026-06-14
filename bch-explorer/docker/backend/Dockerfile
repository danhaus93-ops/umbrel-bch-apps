# Re-authored for PUBLIC base images.
# Original base (builder+runtime): registry.melroy.org/melroy/docker-images/rust:1.95-node-24.15.0 (dead registry)
# That base = Node 24 + pnpm + Rust 1.95. We reconstruct it from node:24 + rustup.
FROM node:24-trixie AS builder

ARG commitHash
ENV MEMPOOL_COMMIT_HASH=${commitHash}
ENV NODE_ENV=production

# pnpm 11.1.3 (via corepack/packageManager) + Rust 1.95 toolchain for building rust-gbt
RUN corepack enable && \
    apt-get update && apt-get install -y --no-install-recommends curl build-essential ca-certificates && \
    curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain 1.95.0 --profile minimal && \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build

# main context is ./backend; these named contexts are supplied by the CI (--build-context)
COPY . .
COPY --from=backend . .
COPY --from=rustgbt . ../rust/
ENV FD=/build/rust-gbt

# Create the rust-gbt placeholder before preinstall (which builds + links the native module)
RUN mkdir rust-gbt

RUN pnpm preinstall
# pnpm v11 caches install state here; deleting it forces re-linking of the freshly built rust-gbt binary.
RUN rm -rf node_modules/.pnpm-workspace-state-v1.json
RUN pnpm install --prod
RUN pnpm package

FROM node:24-trixie AS runtime

ENV NODE_OPTIONS=--max-old-space-size=16384
ENV NODE_ENV=production

WORKDIR /backend

RUN chown 1000:1000 ./
COPY --from=builder --chown=1000:1000 /build/package ./package/
COPY --from=builder --chown=1000:1000 /build/explorer-config-template.json /build/start.sh /build/wait-for-it.sh ./
# Rename template to explorer-config.json
RUN mv explorer-config-template.json explorer-config.json

HEALTHCHECK --interval=40s --timeout=20s --start-period=40s --retries=5 \
  CMD node package/healthcheck.js

USER 1000

EXPOSE 8999

CMD ["/backend/start.sh"]
