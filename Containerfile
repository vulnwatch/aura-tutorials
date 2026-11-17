# The tooling image of this repository (scripts/tooling.sh): the official
# Playwright image that Aura's tooling uses, pinned by version and digest,
# which provides Node.js and Playwright's Chromium, with FFmpeg, which
# HyperFrames needs to encode the videos. Keep the version in sync with
# playwright in package.json, so that its browsers are the ones that
# Playwright expects.
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
