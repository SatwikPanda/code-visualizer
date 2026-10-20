FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends clang libstdc++-12-dev && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 codeviz && useradd --uid 10001 --gid 10001 --no-create-home codeviz
USER 10001:10001
WORKDIR /job
