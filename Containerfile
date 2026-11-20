# The tooling image of this repository (scripts/tooling.sh): the official
# Playwright image that Aura's tooling uses, pinned by version and digest,
# which provides Node.js and Playwright's Chromium, with FFmpeg, which
# HyperFrames needs to encode the videos. Keep the version in sync with
# playwright in package.json, so that its browsers are the ones that
# Playwright expects.
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
