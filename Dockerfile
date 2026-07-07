FROM node:18-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN ln -s /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY . .

RUN npm install --omit=dev

RUN pip3 install --no-cache-dir --compile pandas numpy scikit-learn matplotlib --break-system-packages

ENV PORT=3000
ENV PYTHON_CMD=python

EXPOSE 3000

CMD ["node", "SIS/BACKEND/server.js"]