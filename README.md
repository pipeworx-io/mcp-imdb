# mcp-imdb

IMDB MCP — title metadata, ratings, episodes, and crew from IMDB's

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/imdb/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Imdb data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
