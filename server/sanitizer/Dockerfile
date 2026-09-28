FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS dependencies
WORKDIR /opt/worker
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
WORKDIR /opt/worker
COPY --from=dependencies /opt/worker/node_modules ./node_modules
COPY package.json policy.ts image-reader.ts inspection.ts codec.ts worker.ts ./
ENV VIPS_CONCURRENCY=1 MALLOC_ARENA_MAX=2 UV_THREADPOOL_SIZE=1
USER 1000:1000
# GNU timeout remains effective if the host coordinator dies. Docker kills the
# remaining namespace when PID 1 exits; CPU/PID/cgroup limits supplement this.
ENTRYPOINT ["timeout", "--signal=KILL", "5s", "node", "--max-old-space-size=64", "worker.ts"]
CMD ["encode"]
