#########################################################################
# 1. AŞAMA: Frontend Build (JS/React)
#########################################################################
FROM node:20-alpine AS app-builder

RUN apk add --no-cache autoconf automake bash g++ git libc6-compat libjpeg-turbo-dev libpng-dev libtool make nasm zlib-dev

# Projedeki 'web' klasörünü kopyalıyoruz
WORKDIR /pgadmin4/web
COPY web .

# Fake Git ayarları (Build hatası vermemesi için)
RUN git init && \
    git config user.email "build@dummy.com" && \
    git config user.name "Build Dummy" && \
    git add . && \
    git commit -m "Fake commit for build"

# Frontend Derleme
RUN export CPPFLAGS="-DPNG_ARM_NEON_OPT=0" && \
    npm install -g corepack && \
    corepack enable && \
    yarn set version berry && \
    yarn set version 4 && \
    yarn install && \
    yarn run bundle && \
    rm -rf node_modules yarn.lock package.json .[^.]*

#########################################################################
# 2. AŞAMA: Python Ortamı (Tüm Bağımlılıklar)
#########################################################################
FROM python:3.11-slim-bookworm AS env-builder

# Gereksinim dosyasını kopyala
COPY requirements.txt /

RUN apt-get update && \
    apt-get install -y build-essential libssl-dev libffi-dev libpq-dev rustc cargo zlib1g-dev libjpeg-dev libkrb5-dev

# Sanal ortam kur ve kütüphaneleri yükle (AI paketleri dahil)
RUN python3 -m venv --system-site-packages --without-pip /venv && \
    /venv/bin/python3 -m pip install --upgrade pip && \
    /venv/bin/python3 -m pip install --no-cache-dir -r requirements.txt && \
    /venv/bin/python3 -m pip install --no-cache-dir pandas matplotlib seaborn google-generativeai requests gunicorn==23.0.0

#########################################################################
# 3. AŞAMA: PostgreSQL Araçları
#########################################################################
FROM postgres:17 AS pg-builder
# Sadece gerekli binary'leri almak için kullanılır

#########################################################################
# 4. FİNAL: Çalıştırma Ortamı
#########################################################################
FROM python:3.11-slim-bookworm

# Ortam Değişkenleri
ENV MPLBACKEND=Agg
ENV PYTHONPATH=/pgadmin4
ENV PATH="/venv/bin:$PATH"
ENV OLLAMA_MODELS=/var/lib/pgadmin/ollama_models
ENV HOME=/home/pgadmin

# Sistem Paketleri (Final aşamasında runtime kütüphaneleri şart)
RUN apt-get update && \
    apt-get install -y bash curl sudo libpq5 libjpeg62-turbo libedit2 libldap-2.5-0 libcap2-bin libkrb5-3 procps libopenjp2-7 libtiff6 && \
    rm -rf /var/lib/apt/lists/*

# Ollama Kurulumu (Bağlantı hatalarına karşı daha dayanıklı versiyon)
RUN curl -L https://ollama.com/download/ollama-linux-amd64.tgz -o ollama.tgz && \
    tar -C /usr/local -xzf ollama.tgz && \
    rm ollama.tgz && \
    ln -s /usr/local/bin/ollama /usr/bin/ollama

# Önceki aşamalardan dosyaları kopyala
COPY --from=env-builder /venv /venv
COPY --from=pg-builder /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/
COPY --from=pg-builder /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/
COPY --from=pg-builder /usr/bin/psql /usr/local/bin/

WORKDIR /pgadmin4

# Derlenmiş Frontend ve Backend kodunu kopyala
COPY --from=app-builder /pgadmin4/web /pgadmin4
COPY pkg/docker/run_pgadmin.py pkg/docker/gunicorn_config.py /pgadmin4/
COPY pkg/docker/entrypoint.sh /entrypoint.sh
COPY LICENSE /pgadmin4/LICENSE

# Kullanıcıyı oluştur ve yetkileri düzenle
RUN useradd -r -u 5050 -g root -s /usr/sbin/nologin pgadmin && \
    mkdir -p /run/pgadmin /var/lib/pgadmin /home/pgadmin /pgadmin4/pgadmin/tools/sqleditor/static ${OLLAMA_MODELS} && \
    chown -R pgadmin:root /run/pgadmin /var/lib/pgadmin /pgadmin4 /home/pgadmin && \
    chmod -R g=u /var/lib/pgadmin /pgadmin4 /home/pgadmin && \
    chmod +x /entrypoint.sh

# Portlar (Web, HTTPS ve Ollama)
EXPOSE 80 443 11434

USER pgadmin

# Akıllı Başlatma Komutu:
# 1. Ollama'yı arka planda başlat
# 2. qwen2.5-coder modeli yüklü değilse indir (Yüklüyse indirmez, vakit kazandırır)
# 3. pgAdmin'i başlatan entrypoint scriptine geç
ENTRYPOINT ["/bin/bash", "-c", "ollama serve & sleep 5 && (ollama list | grep -q 'qwen2.5-coder' || ollama pull qwen2.5-coder) && exec /entrypoint.sh"]