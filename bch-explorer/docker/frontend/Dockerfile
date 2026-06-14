# Re-authored for PUBLIC base images.
# Original builder base: registry.melroy.org/melroy/docker-images/debian-pnpm:24.15.0-trixie (dead registry)
FROM node:24-trixie AS builder

ARG commitHash
ENV DOCKER_COMMIT_HASH=${commitHash}
ENV CYPRESS_INSTALL_BINARY=0
ENV NODE_ENV=production
ENV SKIP_SYNC=1

# pnpm 11.1.3 comes from the repo's "packageManager" field via corepack
RUN corepack enable

WORKDIR /build
COPY . .
RUN apt-get update && apt-get install -y --no-install-recommends build-essential rsync && rm -rf /var/lib/apt/lists/*
RUN cp explorer-frontend-config.sample.json explorer-frontend-config.json
RUN pnpm install
RUN pnpm build

FROM nginx:1.29.4-alpine

WORKDIR /patch

COPY --from=builder /build/entrypoint.sh .
COPY --from=builder /build/wait-for .
COPY --from=builder /build/dist/explorer /var/www/explorer
COPY --from=builder /build/nginx.conf /etc/nginx/
COPY --from=builder /build/nginx-explorer.conf /etc/nginx/conf.d/

RUN chmod +x /patch/entrypoint.sh
RUN chmod +x /patch/wait-for

RUN chown -R 1000:1000 /patch && chmod -R 755 /patch && \
        chown -R 1000:1000 /var/cache/nginx && \
        chown -R 1000:1000 /var/log/nginx && \
        chown -R 1000:1000 /etc/nginx/nginx.conf && \
        chown -R 1000:1000 /etc/nginx/conf.d && \
        chown -R 1000:1000 /var/www/explorer

RUN touch /var/run/nginx.pid && \
        chown -R 1000:1000 /var/run/nginx.pid

USER 1000

ENTRYPOINT ["/patch/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
