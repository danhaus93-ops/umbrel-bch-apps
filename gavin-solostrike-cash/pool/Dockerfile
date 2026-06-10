# ---- build asicseer-pool (cculianu) from source ----
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git libzmq3-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/cculianu/asicseer-pool.git .
RUN mkdir build && cd build && cmake .. && make -j"$(nproc)"

# ---- runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libzmq5 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/src/asicseer-pool /usr/local/bin/asicseer-pool
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3333
ENTRYPOINT ["/entrypoint.sh"]
