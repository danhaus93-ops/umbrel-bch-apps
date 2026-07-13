FROM rust:1.88-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends git capnproto libcapnp-dev pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/stratum-mining/sv2-apps.git /src/sv2-apps \
    && cd /src/sv2-apps && git checkout 26e4bbaa790d0bd58bd8b69696f4aaa44de44a9a
COPY patches /patches
RUN cd /src/sv2-apps && git apply /patches/0001-vardiff-zero-floor.patch \
    && grep -q "LoneStrike patch" pool-apps/pool/src/lib/channel_manager/mining_message_handler.rs
COPY noise-tp-shim /src/sv2-apps/noise-tp-shim
COPY sri-keygen /src/sv2-apps/sri-keygen
RUN cd /src/sv2-apps/pool-apps && cargo build --release -p pool_sv2
RUN cd /src/sv2-apps/noise-tp-shim && cargo build --release
RUN cd /src/sv2-apps/sri-keygen && cargo build --release
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/sv2-apps/pool-apps/target/release/pool_sv2 /usr/local/bin/
COPY --from=build /src/sv2-apps/noise-tp-shim/target/release/noise-tp-shim /usr/local/bin/
COPY --from=build /src/sv2-apps/sri-keygen/target/release/sri-keygen /usr/local/bin/
COPY sv2-helpers/addr_to_script.py /usr/local/bin/addr_to_script.py
COPY sv2-helpers/entrypoint.sh /entrypoint.sh
COPY sv2-helpers/pool-config.template.toml /app/pool-config.template.toml
RUN chmod +x /entrypoint.sh /usr/local/bin/pool_sv2 /usr/local/bin/noise-tp-shim /usr/local/bin/sri-keygen && mkdir -p /data
EXPOSE 33333 9090
ENTRYPOINT ["/entrypoint.sh"]
