# UI image, built from the repository root (docker build -f web/Dockerfile .) because the pages
# are generated at build time from ../content. Build once, then run Next's standalone server
# (only the files it needs, no node_modules tree). The hourly pages (/ and /news) and the root
# layout around them re-read content/ on each refresh (syllabus, lessons, roadmaps, insights,
# news/linkedin.yaml), so the folder is copied to /content (CONTENT_DIR is ../content from the
# server's working directory /app).
# NEXT_PUBLIC_API_URL is read by the browser, so it is baked in at build.
FROM node:20-slim AS build
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY content /repo/content
ARG NEXT_PUBLIC_API_URL=http://localhost:8010
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3010 HOSTNAME=0.0.0.0
COPY --from=build --chown=1000 /repo/web/.next/standalone ./
COPY --from=build --chown=1000 /repo/web/.next/static ./.next/static
COPY --from=build --chown=1000 /repo/content /content
USER 1000
EXPOSE 3010
CMD ["node", "server.js"]
