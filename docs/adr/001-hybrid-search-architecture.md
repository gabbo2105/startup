# ADR-001: Hybrid Search Architecture

**Status**: Accepted
**Date**: 2025-02-16

## Context

We need to search ~9,200 hotel supplier products in Italian. Users may search by exact product names, categories, or natural language descriptions. A single search method is insufficient:

- Full-text search (FTS) handles exact/stemmed matches well but misses semantic relationships ("alcol" won't find "whisky")
- Semantic vector search captures meaning but can miss exact matches and has higher latency
- Fuzzy search handles typos but doesn't understand meaning

## Decision

Implement a hybrid search combining FTS and semantic vector search, with configurable weights:

1. **FTS via tsvector** (Italian config) for exact and stemmed keyword matches
2. **Semantic search via pgvector** (OpenAI text-embedding-3-small, 1536 dimensions) for meaning-based matches
3. **Combined scoring**: `fts_rank_normalized * fts_weight + cosine_similarity * semantic_weight`
4. **Min-max normalization** of FTS rank to 0-1 range before combining (FTS rank is typically 0.0-0.1, cosine similarity is 0.0-1.0)
5. **Similarity threshold** of 0.3 on semantic matches to filter noise

The search runs both queries in parallel CTEs, combines via FULL OUTER JOIN, normalizes, and orders by combined score.

## Alternatives Considered

1. **FTS only**: Fast but misses semantic relationships. Users searching "prodotti per la colazione" would miss products not containing those exact stems.
2. **Vector search only**: Good semantic understanding but misses exact matches, higher latency, and embedding generation adds cost per query.
3. **External search engine (Elasticsearch/Typesense)**: Additional infrastructure, cost, and complexity for ~9K rows. PostgreSQL handles this scale easily.
4. **Reciprocal Rank Fusion (RRF)**: Alternative to weighted sum. Simpler but less tunable than configurable weights.

## Consequences

- **Positive**: Best of both worlds — exact matches rank high, semantic relationships are captured
- **Positive**: Single PostgreSQL instance, no external search infrastructure
- **Positive**: Weights are configurable per query, allowing callers to tune behavior
- **Negative**: Each search query requires an OpenAI API call for embedding generation (~$0.00002/query)
- **Negative**: Min-max normalization is relative to the result set, meaning scores aren't comparable across different queries
