/**
 * Fetch Twitter/X Digest
 *
 * Uses Nitter search page HTML to fetch recent tweets without authentication.
 * Focuses on AI/tools topics.
 */

// Imports removed as they are no longer needed


// Public Nitter instances - Updating with more reliable mirrors for 2026
const NITTER_INSTANCES = [
  'https://nitter.perennialte.ch',
  'https://nitter.privacy.com.de',
  'https://nitter.esmailelbob.xyz',
  'https://nitter.no-logs.com',
  'https://nitter.ca',
  'https://bird.froth.zone',
  'https://nitter.rawbit.ninja',
  'https://nitter.projectsegfau.lt',
  'https://nitter.inpt.fr',
  'https://nitter.d420.de',
  'https://nitter.cz',
  'https://nitter.net',
];

// Search queries for AI/Tools content
const SEARCH_QUERIES = [
  'ai / tools',  // Exact search term you requested
  'ai tools',
  'coding OR programming',
];

export interface Tweet {
  author: string;
  content: string;
  link: string;
  date: string;
}

export interface TwitterDigest {
  tweets: Tweet[];
  count: number;
  source: string;
}


/**
 * Fetch HTML from Nitter search page
 */
async function fetchNitterSearch(instance: string, query: string): Promise<string | null> {
  try {
    const encodedQuery = encodeURIComponent(query);
    // Add extra params to mimic the user's working URL
    const url = `${instance}/search?f=tweets&q=${encodedQuery}&since=&until=&min_faves=`;

    console.log(`Twitter: Fetching ${url}...`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": `${instance}/`,
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(20000)
    });

    console.log(`Twitter: Status ${response.status} from ${instance}`);

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    console.log(`Twitter: Response length ${text.length} chars from ${instance}`);

    // Less strict validation - if we got HTML, let's try to parse it
    if (text && text.length > 1000) {
      return text;
    }
    return null;
  } catch (err) {
    console.error(`Twitter: Fetch error for ${instance}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Parse HTML to extract tweets
 * Uses robust string splitting instead of brittle regex
 */
function parseNitterHTML(html: string): Tweet[] {
  const tweets: Tweet[] = [];

  // Split by timeline-item div to process each tweet independently
  // This is more robust than a single complex regex
  const parts = html.split('<div class="timeline-item');

  // Skip the first part (header content before first tweet)
  for (let i = 1; i < parts.length; i++) {
    const item = parts[i];

    // Ensure we are inside a tweet container, not just some random div
    // Nitter items usually have "tweet-content"
    if (!item.includes('class="tweet-content')) continue;

    // Extract tweet content
    const contentMatch = item.match(/<div class="tweet-content[^>]*>([\s\S]*?)<\/div>/);
    // Extract author
    const authorMatch = item.match(/<a class="username"[^>]*>@(\w+)<\/a>/);
    // Extract link
    const linkMatch = item.match(/<a class="tweet-link"[^>]*href="([^"]+)"/);
    // Extract date/time
    const dateMatch = item.match(/<span class="tweet-date[^>]*>([^<]+)<\/span>/);

    if (contentMatch && authorMatch) {
      // Clean up HTML content
      let content = contentMatch[1]
        .replace(/<[^>]+>/g, ' ')  // Remove HTML tags
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')  // Collapse whitespace
        .trim();

      // Remove "RT @username:" prefix
      content = content.replace(/^RT @\w+:\s*/, '');

      // Skip if too short
      if (content.length < 10) continue;

      tweets.push({
        author: authorMatch[1],
        content: content.substring(0, 280),
        link: linkMatch ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `https://nitter.net${linkMatch[1]}`) : 'https://nitter.net',
        date: dateMatch ? dateMatch[1].trim() : new Date().toISOString(),
      });
    }

    if (tweets.length >= 10) break;
  }

  return tweets;
}

/**
 * Fetch AI/Tools news from Hacker News (Algolia API)
 * used as fallback when Nitter is down
 */
async function fetchHackerNewsFallback(): Promise<Tweet[]> {
  try {
    console.log('Twitter: Nitter unavailable, trying Hacker News fallback...');
    const query = encodeURIComponent('ai tools OR llm OR coding');
    const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&hitsPerPage=10`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return [];

    const data = await response.json() as any;
    return (data.hits || []).map((hit: any) => ({
      author: hit.author,
      content: hit.title,
      link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      date: new Date(hit.created_at).toISOString(),
    }));
  } catch (err) {
    console.error('Twitter: Fallback failed:', err);
    return [];
  }
}

/**
 * Fetch Twitter/X digest using Nitter search
 */
export async function fetchTwitterDigest(): Promise<TwitterDigest> {
  const tweets: Tweet[] = [];
  let workingInstance = '';

  // Try each Nitter instance
  for (const instance of NITTER_INSTANCES) {
    // Try each search query
    for (const query of SEARCH_QUERIES) {
      try {
        const html = await fetchNitterSearch(instance, query);
        if (html) {
          const parsed = parseNitterHTML(html);
          if (parsed.length > 0) {
            tweets.push(...parsed);
            workingInstance = instance;
            console.log(`Twitter: Fetched ${parsed.length} tweets for "${query}" via ${instance}`);
          } else {
            console.log(`Twitter: No tweets parsed from ${instance} for "${query}"`);
          }
        }
      } catch (err) {
        console.error(`Twitter: Error processing ${instance}:`, err);
        continue;
      }
    }

    if (tweets.length >= 5) break; // Reduced from 10 to speed up
  }

  // Fallback to Hacker News if no tweets found
  if (tweets.length === 0) {
    const hnFallback = await fetchHackerNewsFallback();
    if (hnFallback.length > 0) {
      tweets.push(...hnFallback);
      workingInstance = 'Hacker News (Fallback)';
    }
  }

  // Log if no results
  if (tweets.length === 0) {
    console.log('Twitter: No tweets found and fallback failed');
  }

  // Deduplicate by link and limit results
  const seen = new Set<string>();
  const filtered = tweets.filter((tweet) => {
    if (seen.has(tweet.link)) return false;
    seen.add(tweet.link);
    return true;
  }).slice(0, 10);

  return {
    tweets: filtered,
    count: filtered.length,
    source: workingInstance || 'None',
  };
}

/**
 * Format Twitter digest for Telegram message
 */
export function formatTwitterDigest(digest: TwitterDigest): string {
  if (digest.tweets.length === 0) {
    return '🐦 X/Twitter Digest\n\n⚠️ No tweets found. Nitter instances may be overloaded or rate limited.\n\n💡 Tip: Check https://nitter.net/search?f=tweets&q=ai+%2F+tools manually.';
  }

  const tweets = digest.tweets
    .map((tweet) => {
      return `• <b>@${tweet.author}</b>: ${tweet.content.substring(0, 100)}${tweet.content.length > 100 ? '...' : ''}`;
    })
    .join('\n\n');

  return `🐦 X/Twitter Digest (AI/Tools)\n\n${tweets}`;
}

/**
 * CLI entry point
 */
export async function main(): Promise<void> {
  const digest = await fetchTwitterDigest();

  console.log(formatTwitterDigest(digest));

  if (digest.count === 0) {
    console.error('\n⚠️ Nitter instances are currently unavailable. This is common with public Nitter mirrors.');
  }
}

// Run if called directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('fetch-twitter.ts') ||
  process.argv[1].endsWith('fetch-twitter') ||
  process.argv[1].includes('fetch-twitter.ts')
);

if (isMain) {
  main().catch(console.error);
}
