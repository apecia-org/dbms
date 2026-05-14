FROM rust:1.88-bookworm AS build

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN apt-get update \
  && apt-get install -y --no-install-recommends pkg-config libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*
RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/dbml-ui-editor-server /usr/local/bin/dbml-ui-editor-server

EXPOSE 8080
CMD ["dbml-ui-editor-server"]
