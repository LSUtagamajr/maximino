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
  console.error('MONGO_URI environment variable is missing.');
  process.exit(1);
}

let mongoConnection = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoConnection) {
    return mongoConnection;
  }

  mongoConnection = mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await mongoConnection;
    console.log('Connected to MongoDB successfully.');
    return mongoose.connection;
  } catch (err) {
    mongoConnection = null;
    console.error('MongoDB connection error:', err);
    throw err;
  }
}

const messageSchema = new mongoose.Schema({
  recipient: String,
  message: String,
  song_title: String,
  song_artist: String,
  album_art: String,
  preview_url: String,
  reactions: { type: Number, default: 0 },
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: 'updated_at' }
});

const Message = mongoose.model('Message', messageSchema);

const feedbackSchema = new mongoose.Schema({
  name: String,
  message: String,
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: 'updated_at' }
});

const Feedback = mongoose.model('Feedback', feedbackSchema);

const reportSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: 'updated_at' }
});

const Report = mongoose.model('Report', reportSchema);

const crypto = require('crypto');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin access is not configured on this server.' });
  }

  const provided = Buffer.from(req.get('x-admin-key') || '');
  const expected = Buffer.from(ADMIN_PASSWORD);

  const valid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid admin key.' });
  }
  next();
}

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a moment.' }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

app.get('/wall', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'wall.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'admin.html'));
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Wait a moment and try again.' }
});

app.get('/api/search-song', searchLimiter, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  try {
    const [globalRes, phRes] = await Promise.all([
      axios.get('https://itunes.apple.com/search', {
        params: { term: query, media: 'music', entity: 'song', limit: 15 }
      }),
      axios.get('https://itunes.apple.com/search', {
        params: { term: query, media: 'music', entity: 'song', limit: 15, country: 'PH' }
      })
    ]);

    const combined = [...globalRes.data.results, ...phRes.data.results];

    const seen = new Set();
    const deduped = combined.filter(track => {
      if (seen.has(track.trackId)) return false;
      seen.add(track.trackId);
      return true;
    });

    const tracks = deduped.slice(0, 15).map(track => ({
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
  max: 5, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages pinned. Wait a minute before pinning another.' }
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
      recipient: (recipient || '').trim().slice(0, 60),
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
    await connectDB();

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const query = {};

    if (req.query.before) {
      const beforeDate = new Date(req.query.before);

      if (!isNaN(beforeDate.getTime())) {
        query.timestamp = { $lt: beforeDate };
      }
    }

    const rows = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    res.json({ items, hasMore });
  } catch (err) {
    console.error('MongoDB fetch error:', err);
    res.status(500).json({
      error: 'Failed to fetch messages.',
      details: err.message
    });
  }
});

app.get('/api/messages/count', async (req, res) => {
  try {
    await connectDB();

    const count = await Message.countDocuments();

    res.json({ count });
  } catch (err) {
    console.error('MongoDB count error:', err);

    res.status(500).json({
      error: 'Failed to count messages.',
      details: err.message
    });
  }
});

app.get('/api/messages/:id', async (req, res) => {
  try {
    await connectDB();

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid note id.' });
    }

    const item = await Message.findById(id);
    if (!item) {
      return res.status(404).json({ error: 'Note not found.' });
    }

    res.json({ item });
  } catch (err) {
    console.error('MongoDB fetch-by-id error:', err);
    res.status(500).json({
      error: 'Failed to fetch note.',
      details: err.message
    });
  }
});

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports at once. Try again in a minute.' }
});

app.post('/api/messages/:id/report', reportLimiter, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid message id.' });
  }

  try {
    const exists = await Message.exists({ _id: id });
    if (!exists) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    await Report.create({ messageId: id });
    res.json({ success: true });
  } catch (err) {
    console.error('MongoDB report save error:', err);
    res.status(500).json({ error: err.message });
  }
});

const reactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reactions at once. Slow down a little.' }
});

app.post('/api/messages/:id/react', reactLimiter, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid message id.' });
  }

  try {
    const updated = await Message.findByIdAndUpdate(
      id,
      { $inc: { reactions: 1 } },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    res.json({ reactions: updated.reactions });
  } catch (err) {
    console.error('MongoDB reaction save error:', err);
    res.status(500).json({ error: err.message });
  }
});

const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too much feedback at once. Try again in a minute.' }
});

app.post('/api/feedback', feedbackLimiter, async (req, res) => {
  const { name, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Feedback message is required.' });
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length > 500) {
    return res.status(400).json({ error: 'Feedback is too long (500 characters max).' });
  }

  try {
    const newFeedback = new Feedback({
      name: (name || '').trim().slice(0, 60),
      message: trimmedMessage,
    });

    await newFeedback.save();
    res.json({ success: true });
  } catch (err) {
    console.error('MongoDB feedback save error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/verify', adminLimiter, requireAdmin, (req, res) => {
  res.json({ success: true });
});

app.get('/api/admin/messages', adminLimiter, requireAdmin, async (req, res) => {
  try {
    await connectDB();

    const messages = await Message.find()
      .sort({ timestamp: -1 })
      .limit(200);

    res.json(messages);
  } catch (err) {
    console.error('Admin messages fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/messages/:id', adminLimiter, requireAdmin, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid message id.' });
  }
  try {
    await Message.findByIdAndDelete(req.params.id);
    await Report.deleteMany({ messageId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/feedback', adminLimiter, requireAdmin, async (req, res) => {
  try {
    const feedback = await Feedback.find().sort({ timestamp: -1 }).limit(200);
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/reports', adminLimiter, requireAdmin, async (req, res) => {
  try {
    const reports = await Report.find().sort({ timestamp: -1 }).limit(200).populate('messageId');
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/reports/:id', adminLimiter, requireAdmin, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid report id.' });
  }
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Maximino server running on http://localhost:${PORT}`));