# "The world in 60 seconds" (plan G9, slice 2; Devon, Oct 21, 2026: "Yes,
# once a night"): records the World Map's play mode each morning as an MP4.
# Chromium comes with Playwright's image; ffmpeg turns the recording into an
# MP4 every app takes. Started once by hand (docker-compose.prod.yml,
# profile "recorder"); then it runs by itself.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && apt-get clean
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund playwright@1.58.2
COPY record.mjs ./
ENV TZ=America/New_York NODE_ENV=production
CMD ["node", "record.mjs"]
