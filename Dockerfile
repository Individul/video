FROM python:3.12-slim

# ffmpeg pentru extragerea subtitrărilor din MKV
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/vid

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    VID_DATA_DIR=/data \
    PYTHONUNBUFFERED=1

RUN mkdir -p /data
VOLUME /data

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
