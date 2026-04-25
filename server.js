require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const port = Number(process.env.PORT || 4242);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).trim();
const adminPassword = (process.env.ADMIN_PASSWORD || 'Ksgc9122').trim();
const whatsappNumber = (process.env.WHATSAPP_NUMBER || '212600000000').trim();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_KEY || '').trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function makeReference(prefix = 'LAYLA') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function isAdmin(req) {
  return req.headers['x-admin-password'] === adminPassword;
}

function toGuest(row) {
  return {
    id: row.id,
    reference: row.reference,
    fullName: row.full_name,
    phone: row.phone,
    instagram: row.instagram || '',
    passType: row.pass_type,
    guests: row.guests || 1,
    message: row.message || '',
    status: row.status || 'pending',
    qrUrl:
      row.status === 'approved'
        ? `${appUrl}/ticket.html?ref=${encodeURIComponent(row.reference)}`
        : '',
    used: row.ticket_status === 'used',
    usedAt: row.used_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

app.get('/api/config', (_req, res) => {
  res.json({
    whatsappNumber,
    appUrl
  });
});

app.get('/api/test-supabase', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .limit(1);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      supabaseUrl: SUPABASE_URL,
      rows: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      supabaseUrl: SUPABASE_URL,
      error: error.message
    });
  }
});

app.post('/api/access-request', async (req, res) => {
  try {
    const { fullName, phone, instagram, passType, guests, message } = req.body || {};

    if (!fullName || !phone || !passType) {
      return res.status(400).json({
        error: 'fullName, phone and passType are required.'
      });
    }

    const reference = makeReference('LAYLA');

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        reference,
        full_name: String(fullName).trim(),
        phone: String(phone).trim(),
        instagram: instagram ? String(instagram).trim() : '',
        pass_type: String(passType).trim(),
        guests: Math.max(1, Math.min(10, Number(guests || 1))),
        message: message ? String(message).trim() : '',
        status: 'pending',
        ticket_status: 'unused'
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      guest: toGuest(data)
    });
  } catch (error) {
    console.error('ACCESS REQUEST ERROR:', error.message);
    res.status(500).json({
      error: error.message || 'Unable to register access request.'
    });
  }
});

app.get('/api/guests', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      throw error;
    }

    res.json({
      guests: data.map(toGuest)
    });
  } catch (error) {
    console.error('GUESTS ERROR:', error.message);
    res.status(500).json({
      error: error.message || 'Unable to list guests.'
    });
  }
});

app.post('/api/guests/:reference/status', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const { status } = req.body || {};

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const { data, error } = await supabase
      .from('tickets')
      .update({ status })
      .eq('reference', req.params.reference)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      guest: toGuest(data)
    });
  } catch (error) {
    console.error('STATUS ERROR:', error.message);
    res.status(500).json({
      error: error.message || 'Unable to update guest.'
    });
  }
});

app.get('/api/ticket/:reference', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('reference', req.params.reference)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }

    const guest = toGuest(data);

    if (guest.status !== 'approved') {
      return res.status(403).json({
        error: 'Invitation not approved yet.'
      });
    }

    res.json({ guest });
  } catch (error) {
    console.error('TICKET ERROR:', error.message);
    res.status(500).json({
      error: error.message || 'Unable to fetch ticket.'
    });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const reference = String(req.body.reference || '').trim();

    if (!reference) {
      return res.status(400).json({
        error: 'reference is required.'
      });
    }

    const { data: ticket, error: findError } = await supabase
      .from('tickets')
      .select('*')
      .eq('reference', reference)
      .single();

    if (findError || !ticket) {
      return res.status(404).json({
        error: 'Invitation not found.'
      });
    }

    const guest = toGuest(ticket);

    if (guest.status !== 'approved') {
      return res.status(400).json({
        error: 'Invitation is not approved.',
        guest
      });
    }

    if (guest.used) {
      return res.status(409).json({
        error: 'Invitation already used.',
        guest
      });
    }

    const { data, error } = await supabase
      .from('tickets')
      .update({
        ticket_status: 'used',
        used_at: new Date().toISOString()
      })
      .eq('reference', reference)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      guest: toGuest(data)
    });
  } catch (error) {
    console.error('SCAN ERROR:', error.message);
    res.status(500).json({
      error: error.message || 'Unable to scan invitation.'
    });
  }
});

app.listen(port, () => {
  console.log(`Layla Nights running on port ${port}`);
  console.log(`Public URL: ${appUrl}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
});
