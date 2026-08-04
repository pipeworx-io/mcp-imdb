# mcp-imdb

IMDB MCP — title metadata, ratings, episodes, and crew from IMDB's

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `imdb_search` | Search IMDB titles by primary_title (case-insensitive substring). Joins ratings inline so each hit includes average_rating + num_votes. Optionally filter by title_type, year range, or genre. Returns up to `limit` matches sorted by num_votes desc (popular first). |
| `imdb_get_title` | Full detail for one IMDB title by tconst id (e.g. "tt0111161"). Returns title, year, runtime, genres, plus rating (average + votes) and crew (directors/writers as nconst arrays). |
| `imdb_top_rated` | Highest-rated titles, filterable by title_type, genre, year range, and min vote count. Use min_votes to filter out obscure titles with inflated averages (e.g. min_votes=10000 for IMDB-Top-250-style lists). |
| `imdb_episodes` | List every episode for a TV series, in season/episode order. Returns parent series detail plus episode list with title and rating per episode. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "imdb": {
      "url": "https://gateway.pipeworx.io/imdb/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Imdb data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
