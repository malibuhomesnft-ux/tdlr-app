const Parser = require('rss-parser');
const parser = new Parser();

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let cache = { data: null, timestamp: 0 };

module.exports = async function handler(req, res) {
  // CORS headers for frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Return cached data if fresh
  if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
    return res.status(200).json(cache.data);
  }

  try {
    const channels = JSON.parse(req.query.channels || '[]');
    const allPosts = [];
    const errors = [];

    for (const ch of channels) {
      try {
        if (ch.platform === 'YouTube') {
          // Resolve handle → Channel ID via Official API
          let channelId = ch.channelId;
          if (!channelId) {
            const handle = ch.url.split('@')[1]?.split('/')[0] || '';
            const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${handle}&type=channel&maxResults=1&key=${process.env.YOUTUBE_API_KEY}`);
            const ytData = await ytRes.json();
            if (ytData.items?.[0]?.id?.channelId) channelId = ytData.items[0].id.channelId;
          }

          if (channelId) {
            const feedRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&maxResults=3&type=video&key=${process.env.YOUTUBE_API_KEY}`);
            const feedData = await feedRes.json();
            if (feedData.items) {
              feedData.items.forEach(item => {
                allPosts.push({
                  id: `yt-${item.id.videoId}`,
                  creator: ch.name,
                  platform: 'YouTube',
                  category: ch.category,
                  title: item.snippet.title,
                  summary: (item.snippet.description || '').replace(/<[^>]*>/g, '').slice(0, 280) + '...',
                  link: `https://youtube.com/watch?v=${item.id.videoId}`,
                  timestamp: item.snippet.publishedAt
                });
              });
            }
          } else {
            errors.push(`${ch.name}: Could not resolve YouTube handle`);
          }
        } 
        else if (ch.platform === 'Substack') {
          let feedUrl = ch.url.includes('/feed') ? ch.url : `${ch.url.replace(/\/$/, '')}/feed`;
          const feedData = await parser.parseURL(feedUrl);
          feedData.items.slice(0, 3).forEach(item => {
            allPosts.push({
              id: `sub-${item.guid || item.link}`,
              creator: ch.name,
              platform: 'Substack',
              category: ch.category,
              title: item.title || 'Untitled',
              summary: (item.content || item.contentSnippet || '').replace(/<[^>]*>/g, '').slice(0, 280) + '...',
              link: item.link || ch.url,
              timestamp: item.pubDate || item.isoDate
            });
          });
        }
      } catch (err) {
        errors.push(`${ch.name}: ${err.message}`);
      }
    }

    allPosts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const result = { posts: allPosts, errors, fetchedAt: new Date().toISOString() };
    cache = { data: result, timestamp: Date.now() };
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Backend fetch failed', message: err.message });
  }
};