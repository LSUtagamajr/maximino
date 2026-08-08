require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  // Allow Google Fonts and inline styles used by the page.
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "https:"],
      "media-src": ["'self'", "https:"],
    },
  },
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI in .env — see .env.example');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB successfully.'))
  .catch(err => console.error('MongoDB connection error:', err.message));

const messageSchema = new mongoose.Schema({
  recipient: String,
  message: String,
  song_title: String,
  song_artist: String,
  album_art: String,
  preview_url: String,
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: 'updated_at' }
});

const Message = mongoose.model('Message', messageSchema);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
let spotifyAccessToken = '';

async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.warn('Spotify credentials not set — skipping token refresh.');
    return;
  }
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    spotifyAccessToken = response.data.access_token;
    setTimeout(getSpotifyToken, (response.data.expires_in - 60) * 1000);
    console.log('Spotify background token refreshed.');
  } catch (error) {
    console.error('Failed to get Spotify token:', error.message);
  }
}
getSpotifyToken();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 searches per minute per IP — generous for normal typing, blocks scripted abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Wait a moment and try again.' }
});

app.get('/api/search-song', searchLimiter, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  try {
    const response = await axios.get('https://itunes.apple.com/search', {
      params: { term: query, media: 'music', entity: 'song', limit: 6 }
    });

    const tracks = response.data.results.map(track => ({
      title: track.trackName,
      artist: track.artistName,
      album_art: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : '',
      preview_url: track.previewUrl || ''
    }));

    res.json(tracks);
  } catch (err) {
    console.error('iTunes API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch song data.' });
  }
});

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // 5 pins per minute per IP — enough for a real person, not for a spam script
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many dedications pinned. Wait a minute before pinning another.' }
});

app.post('/api/messages', postLimiter, async (req, res) => {
  const { recipient, message, song_title, song_artist, album_art, preview_url } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'A message is required.' });
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length > 220) {
    return res.status(400).json({ error: 'Message is too long (220 characters max).' });
  }

  try {
    const newMessage = new Message({
      recipient: (recipient || 'Someone').slice(0, 60),
      message: trimmedMessage,
      song_title: song_title || '',
      song_artist: song_artist || '',
      album_art: album_art || '',
      preview_url: preview_url || ''
    });

    await newMessage.save();
    res.json({ success: true, message: newMessage });
  } catch (err) {
    console.error('MongoDB save error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const message = await Message.find()
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(message);
  } catch (err) {
    console.error('MongoDB fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Maximino server running on http://localhost:${PORT}`));