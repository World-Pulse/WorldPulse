FROM postgis/postgis:16-3.4

# Install pgvector extension for embedding similarity search.
# Without this in the image, pgvector gets lost on container rebuild
# and all embedding queries fail until manually reinstalled.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
