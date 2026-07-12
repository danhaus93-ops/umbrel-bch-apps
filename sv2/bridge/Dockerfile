FROM python:3.12-slim
WORKDIR /app
COPY bchn_sv2_bridge.py sv2_framing.py bch_tp_core.py /app/
RUN useradd -r -u 1000 -m sv2 && mkdir -p /data && chown sv2:sv2 /data
USER sv2
ENV TP_PORT=8443
EXPOSE 8443
CMD ["python3", "bchn_sv2_bridge.py"]
