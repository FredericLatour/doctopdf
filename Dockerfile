FROM oven/bun:1.4.4 AS base

WORKDIR /service

# Install OS packages first so the layer stays cached unless base image changes
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-crosextra-carlito \
    chromium \
    poppler-utils \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install production dependencies first so Docker can cache this layer
COPY bun.lock package.json tsconfig.json ./
RUN bun install --frozen-lockfile

# Copy application code separately to leverage the cache
COPY src ./src
COPY fonts /usr/local/share/fonts/custom
COPY themes ./themes
RUN fc-cache -f -v

ENV CHROMIUM_PATH=/usr/bin/chromium

EXPOSE 3000

CMD ["bun", "start"]
