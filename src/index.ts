interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * IMDB MCP — title metadata, ratings, episodes, and crew from IMDB's
 * official non-commercial bulk dumps (https://datasets.imdbws.com/).
 *
 * Coverage: movies, TV series, TV mini-series (shorts and episodes filtered
 * out of imdb_titles for size; episodes are still queryable via imdb_episodes
 * which carries the parent series id).
 *
 * Data is ingested daily by workers/data-pipeline; this pack queries the
 * imdb_titles / imdb_ratings / imdb_episodes / imdb_crew tables directly
 * via PostgREST. _supabaseUrl and _supabaseKey are gateway-injected.
 *
 * Person names (directors/writers) are returned as nconsts (IMDB person IDs).
 * Pair with OMDB or another source to resolve nconst → name; we don't ingest
 * the name.basics file in v1 due to size.
 */


const TITLE_TYPES = ['movie', 'tvSeries', 'tvMiniSeries'] as const;

const tools: McpToolExport['tools'] = [
  {
    name: 'imdb_search',
    description:
      'Search IMDB titles by primary_title (case-insensitive substring). Joins ratings inline so each hit includes average_rating + num_votes. Optionally filter by title_type, year range, or genre. Returns up to `limit` matches sorted by num_votes desc (popular first).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Title substring (e.g. "godfather", "succession")' },
        title_type: { type: 'string', description: `Optional: ${TITLE_TYPES.join(' | ')}` },
        year_from: { type: 'number', description: 'Minimum start year (inclusive)' },
        year_to: { type: 'number', description: 'Maximum start year (inclusive)' },
        genre: { type: 'string', description: 'Genre to filter by (e.g. "Comedy", "Drama")' },
        min_votes: { type: 'number', description: 'Minimum num_votes (default 0 — no filter)' },
        limit: { type: 'number', description: '1-100 (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'imdb_get_title',
    description:
      'Full detail for one IMDB title by tconst id (e.g. "tt0111161"). Returns title, year, runtime, genres, plus rating (average + votes) and crew (directors/writers as nconst arrays).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        imdb_id: { type: 'string', description: 'tconst, e.g. "tt0111161"' },
      },
      required: ['imdb_id'],
    },
  },
  {
    name: 'imdb_top_rated',
    description:
      'Highest-rated titles, filterable by title_type, genre, year range, and min vote count. Use min_votes to filter out obscure titles with inflated averages (e.g. min_votes=10000 for IMDB-Top-250-style lists).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title_type: { type: 'string', description: `${TITLE_TYPES.join(' | ')} (default "movie")` },
        genre: { type: 'string', description: 'Genre filter (e.g. "Horror", "Documentary")' },
        year_from: { type: 'number', description: 'Minimum start year' },
        year_to: { type: 'number', description: 'Maximum start year' },
        min_votes: { type: 'number', description: 'Minimum num_votes (default 10000)' },
        limit: { type: 'number', description: '1-100 (default 25)' },
      },
      required: [],
    },
  },
  {
    name: 'imdb_episodes',
    description:
      'List every episode for a TV series, in season/episode order. Returns parent series detail plus episode list with title and rating per episode.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        series_id: { type: 'string', description: 'Series tconst, e.g. "tt0903747" (Breaking Bad)' },
        season: { type: 'number', description: 'Optional: filter to one season' },
        limit: { type: 'number', description: 'Max episodes returned (default 500, max 2000)' },
      },
      required: ['series_id'],
    },
  },
];

interface SupabaseConfig {
  url: string;
  key: string;
}

async function pg<T>(cfg: SupabaseConfig, table: string, query: string): Promise<T> {
  const url = `${cfg.url}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table}: ${res.status} ${text.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

interface RawTitle {
  imdb_id: string;
  title_type: string | null;
  primary_title: string | null;
  original_title: string | null;
  is_adult: boolean | null;
  start_year: number | null;
  end_year: number | null;
  runtime_minutes: number | null;
  genres: string[] | null;
}

interface RawRating {
  imdb_id: string;
  average_rating: string | number | null; // PostgREST returns numeric as string
  num_votes: number | null;
}

interface RawCrew {
  imdb_id: string;
  directors: string[] | null;
  writers: string[] | null;
}

interface RawEpisode {
  imdb_id: string;
  parent_imdb_id: string | null;
  season_number: number | null;
  episode_number: number | null;
}

function shapeTitle(t: RawTitle, r?: RawRating, c?: RawCrew) {
  return {
    imdb_id: t.imdb_id,
    title: t.primary_title,
    original_title: t.original_title !== t.primary_title ? t.original_title : null,
    title_type: t.title_type,
    is_adult: t.is_adult,
    start_year: t.start_year,
    end_year: t.end_year,
    runtime_minutes: t.runtime_minutes,
    genres: t.genres ?? [],
    rating: r
      ? {
          average: r.average_rating !== null ? Number(r.average_rating) : null,
          votes: r.num_votes,
        }
      : null,
    crew: c
      ? {
          directors: c.directors ?? [],
          writers: c.writers ?? [],
        }
      : null,
    url: `https://www.imdb.com/title/${t.imdb_id}/`,
  };
}

// ── Tools ──────────────────────────────────────────────────────────

async function imdbSearch(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('query is required (e.g. "godfather").');
  const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
  const minVotes = Math.max(0, Number(args.min_votes ?? 0));

  const titleParts: string[] = [
    `primary_title=ilike.*${encodeURIComponent(query)}*`,
    'select=imdb_id,title_type,primary_title,original_title,is_adult,start_year,end_year,runtime_minutes,genres',
    `limit=${limit * 4}`, // overfetch so we can rank by rating after the join
  ];
  if (args.title_type) titleParts.push(`title_type=eq.${encodeURIComponent(String(args.title_type))}`);
  if (args.year_from !== undefined) titleParts.push(`start_year=gte.${Number(args.year_from)}`);
  if (args.year_to !== undefined) titleParts.push(`start_year=lte.${Number(args.year_to)}`);
  if (args.genre) titleParts.push(`genres=cs.{${encodeURIComponent(String(args.genre))}}`);

  const titles = await pg<RawTitle[]>(cfg, 'imdb_titles', titleParts.join('&'));
  if (titles.length === 0) {
    return { query, count: 0, results: [] };
  }

  const ids = titles.map((t) => t.imdb_id);
  const ratings = await pg<RawRating[]>(
    cfg,
    'imdb_ratings',
    `imdb_id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})&select=imdb_id,average_rating,num_votes`,
  );
  const ratingByImdb = new Map(ratings.map((r) => [r.imdb_id, r]));

  const ranked = titles
    .map((t) => ({ title: t, rating: ratingByImdb.get(t.imdb_id) }))
    .filter(({ rating }) => (rating?.num_votes ?? 0) >= minVotes)
    .sort((a, b) => (b.rating?.num_votes ?? 0) - (a.rating?.num_votes ?? 0))
    .slice(0, limit);

  return {
    query,
    count: ranked.length,
    results: ranked.map(({ title, rating }) => shapeTitle(title, rating)),
  };
}

async function imdbGetTitle(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const id = String(args.imdb_id ?? '').trim();
  if (!id) throw new Error('imdb_id is required (e.g. "tt0111161").');

  const [titles, ratings, crews] = await Promise.all([
    pg<RawTitle[]>(cfg, 'imdb_titles', `imdb_id=eq.${encodeURIComponent(id)}&select=*`),
    pg<RawRating[]>(cfg, 'imdb_ratings', `imdb_id=eq.${encodeURIComponent(id)}&select=imdb_id,average_rating,num_votes`),
    pg<RawCrew[]>(cfg, 'imdb_crew', `imdb_id=eq.${encodeURIComponent(id)}&select=imdb_id,directors,writers`),
  ]);

  if (titles.length === 0) {
    return { error: 'not_found', message: `No IMDB title with id "${id}".` };
  }
  return shapeTitle(titles[0], ratings[0], crews[0]);
}

async function imdbTopRated(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const titleType = String(args.title_type ?? 'movie');
  const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 100);
  const minVotes = Math.max(1000, Number(args.min_votes ?? 10000));

  // Strategy: pull the top N ratings (well over the requested limit so the
  // genre/year filters have room to whittle down), then join titles, filter
  // client-side, and return. The partial index on num_votes > 1000 makes
  // the ratings scan fast.
  const ratingOverfetch = Math.max(limit * 20, 500);
  const ratings = await pg<RawRating[]>(
    cfg,
    'imdb_ratings',
    `num_votes=gte.${minVotes}&select=imdb_id,average_rating,num_votes&order=average_rating.desc.nullslast,num_votes.desc&limit=${ratingOverfetch}`,
  );
  if (ratings.length === 0) return { count: 0, results: [] };

  const ids = ratings.map((r) => r.imdb_id);
  const titleParts: string[] = [
    `imdb_id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`,
    `title_type=eq.${encodeURIComponent(titleType)}`,
    'select=imdb_id,title_type,primary_title,original_title,is_adult,start_year,end_year,runtime_minutes,genres',
  ];
  if (args.year_from !== undefined) titleParts.push(`start_year=gte.${Number(args.year_from)}`);
  if (args.year_to !== undefined) titleParts.push(`start_year=lte.${Number(args.year_to)}`);
  if (args.genre) titleParts.push(`genres=cs.{${encodeURIComponent(String(args.genre))}}`);

  const titles = await pg<RawTitle[]>(cfg, 'imdb_titles', titleParts.join('&'));
  const titleByImdb = new Map(titles.map((t) => [t.imdb_id, t]));

  const ranked = ratings
    .map((r) => ({ title: titleByImdb.get(r.imdb_id), rating: r }))
    .filter((x): x is { title: RawTitle; rating: RawRating } => Boolean(x.title))
    .slice(0, limit);

  return {
    count: ranked.length,
    filters: { title_type: titleType, min_votes: minVotes, genre: args.genre ?? null, year_from: args.year_from ?? null, year_to: args.year_to ?? null },
    results: ranked.map(({ title, rating }) => shapeTitle(title, rating)),
  };
}

async function imdbEpisodes(cfg: SupabaseConfig, args: Record<string, unknown>) {
  const seriesId = String(args.series_id ?? '').trim();
  if (!seriesId) throw new Error('series_id is required.');
  const limit = Math.min(Math.max(Number(args.limit ?? 500), 1), 2000);
  const season = args.season !== undefined ? Number(args.season) : null;

  const epQueryParts: string[] = [
    `parent_imdb_id=eq.${encodeURIComponent(seriesId)}`,
    'select=imdb_id,parent_imdb_id,season_number,episode_number',
    'order=season_number.asc.nullslast,episode_number.asc.nullslast',
    `limit=${limit}`,
  ];
  if (season !== null) epQueryParts.push(`season_number=eq.${season}`);

  const [seriesRow, episodes] = await Promise.all([
    pg<RawTitle[]>(cfg, 'imdb_titles', `imdb_id=eq.${encodeURIComponent(seriesId)}&select=*`),
    pg<RawEpisode[]>(cfg, 'imdb_episodes', epQueryParts.join('&')),
  ]);
  if (episodes.length === 0) {
    return { error: 'not_found', message: `No episodes found for series "${seriesId}".`, series: seriesRow[0] ? shapeTitle(seriesRow[0]) : null };
  }

  const episodeIds = episodes.map((e) => e.imdb_id);
  const [epTitles, epRatings] = await Promise.all([
    pg<RawTitle[]>(
      cfg,
      'imdb_titles',
      `imdb_id=in.(${episodeIds.map((id) => encodeURIComponent(id)).join(',')})&select=imdb_id,primary_title`,
    ),
    pg<RawRating[]>(
      cfg,
      'imdb_ratings',
      `imdb_id=in.(${episodeIds.map((id) => encodeURIComponent(id)).join(',')})&select=imdb_id,average_rating,num_votes`,
    ),
  ]);
  // Episode titles aren't in imdb_titles (filtered to movie/tvSeries/tvMiniSeries),
  // so epTitles will usually be empty — that's expected. Ratings work because
  // we ingest title.ratings unfiltered.
  const titleByImdb = new Map(epTitles.map((t) => [t.imdb_id, t.primary_title]));
  const ratingByImdb = new Map(epRatings.map((r) => [r.imdb_id, r]));

  return {
    series: seriesRow[0] ? shapeTitle(seriesRow[0]) : { imdb_id: seriesId, title: null },
    season_filter: season,
    episode_count: episodes.length,
    episodes: episodes.map((e) => {
      const r = ratingByImdb.get(e.imdb_id);
      return {
        imdb_id: e.imdb_id,
        season: e.season_number,
        episode: e.episode_number,
        title: titleByImdb.get(e.imdb_id) ?? null,
        rating: r
          ? { average: r.average_rating !== null ? Number(r.average_rating) : null, votes: r.num_votes }
          : null,
        url: `https://www.imdb.com/title/${e.imdb_id}/`,
      };
    }),
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supabaseUrl = (args._supabaseUrl as string | undefined)?.trim();
  const supabaseKey = (args._supabaseKey as string | undefined)?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('IMDB pack requires platform Supabase credentials (operator-configured).');
  }
  const cfg: SupabaseConfig = { url: supabaseUrl, key: supabaseKey };

  switch (name) {
    case 'imdb_search':
      return imdbSearch(cfg, args);
    case 'imdb_get_title':
      return imdbGetTitle(cfg, args);
    case 'imdb_top_rated':
      return imdbTopRated(cfg, args);
    case 'imdb_episodes':
      return imdbEpisodes(cfg, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
