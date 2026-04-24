require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Datastore = require('nedb-promises');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 4242);
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
const whatsappNumber = process.env.WHATSAPP_NUMBER || '212600000000';

const db = Datastore.create({ filename: path.join(__dirname, 'guests.db'), autoload: true });
db.ensureIndex({ fieldName: 'reference', unique: true }).catch(() => {});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function makeReference(prefix = 'LAYLA') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function isAdmin(req) {
  return req.headers['x-admin-password'] === adminPassword;
}

app.get('/api/config', (_req, res) => {
  res.json({ whatsappNumber, appUrl });
});

app.post('/api/access-request', async (req, res) => {
  try {
    const { fullName, phone, instagram, passType, guests, message } = req.body || {};
    if (!fullName || !phone || !passType) {
      return res.status(400).json({ error: 'fullName, phone and passType are required.' });
    }

    const doc = {
      reference: makeReference('LAYLA'),
      fullName: String(fullName).trim(),
      phone: String(phone).trim(),
      instagram: instagram ? String(instagram).trim() : '',
      passType: String(passType).trim(),
      guests: Math.max(1, Math.min(10, Number(guests || 1))),
      message: message ? String(message).trim() : '',
      status: 'pending',
      qrUrl: '',
      used: false,
      usedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const inserted = await db.insert(doc);
    res.json({ guest: inserted });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to register access request.' });
  }
});

app.get('/api/guests', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const guests = await db.find({}).sort({ createdAt: -1 }).limit(500);
    res.json({ guests });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to list guests.' });
  }
});

app.post('/api/guests/:reference/status', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const { status } = req.body || {};
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const reference = req.params.reference;
    const qrUrl = status === 'approved' ? `${appUrl}/ticket.html?ref=${encodeURIComponent(reference)}` : '';
    await db.update({ reference }, { $set: { status, qrUrl, updatedAt: new Date().toISOString() } });
    const guest = await db.findOne({ reference });
    if (!guest) return res.status(404).json({ error: 'Guest not found.' });
    res.json({ guest });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to update guest.' });
  }
});

app.get('/api/ticket/:reference', async (req, res) => {
  try {
    const guest = await db.findOne({ reference: req.params.reference });
    if (!guest) return res.status(404).json({ error: 'Invitation not found.' });
    if (guest.status !== 'approved') return res.status(403).json({ error: 'Invitation not approved yet.' });
    res.json({ guest: { reference: guest.reference, fullName: guest.fullName, passType: guest.passType, guests: guest.guests, used: guest.used, usedAt: guest.usedAt } });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to fetch ticket.' });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const { reference } = req.body || {};
    if (!reference) return res.status(400).json({ error: 'reference is required.' });

    const guest = await db.findOne({ reference: String(reference).trim() });
    if (!guest) return res.status(404).json({ error: 'Invitation not found.' });
    if (guest.status !== 'approved') return res.status(400).json({ error: 'Invitation is not approved.', guest });
    if (guest.used) return res.status(409).json({ error: 'Invitation already used.', guest });

    await db.update({ reference: guest.reference }, { $set: { used: true, usedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    const updated = await db.findOne({ reference: guest.reference });
    res.json({ guest: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to scan invitation.' });
  }
});

app.listen(port, () => console.log(`Layla Nights Club Mode running on http://localhost:${port}`));
