# Ace Stream Engine din pachetul OFICIAL (download.acestream.media), nu dintr-o imagine
# comunitară cu proveniență necunoscută. Expune API-ul HTTP pe 6878 (/ace/getstream?id=...).
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip libpython3.10 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/acestream
ARG ACE_URL=https://download.acestream.media/linux/acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz
ARG ACE_SHA256=9b6bbd76a55e5a434641afae3b9cf8e6154ce1cf392152ec3aed5ac265432b2e
RUN curl -fsSL -o /tmp/ace.tgz "$ACE_URL" \
    && echo "$ACE_SHA256  /tmp/ace.tgz" | sha256sum -c - \
    && tar xzf /tmp/ace.tgz -C /opt/acestream && rm /tmp/ace.tgz \
    && pip3 install --no-cache-dir -r requirements.txt
EXPOSE 6878 8621
# cache pe disc limitat la ~300 MB, din care live ~150 MB (implicit ar crește nelimitat — discul VPS-ului e mic)
CMD ["/opt/acestream/start-engine", "--client-console", "--bind-all", "--http-port", "6878", "--port", "8621", \
     "--log-stdout", "--log-stdout-level", "error", "--state-dir", "/data/state", "--cache-dir", "/data/cache", \
     "--cache-auto", "0", "--cache-max-bytes", "314572800", "--disk-cache-limit", "314572800", \
     "--live-cache-type", "disk", "--live-disk-cache-size", "157286400"]
