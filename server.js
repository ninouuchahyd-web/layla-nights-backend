require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

const port = Number(process.env.PORT || 4242);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).trim();
const adminPassword = (process.env.ADMIN_PASSWORD || 'Ksgc9122').trim();
const whatsappNumber = (process.env.WHATSAPP_NUMBER || '212600000000').trim();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_KEY || '').trim();

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
    promoCode: row.promo_code || '',
    promoDj: row.promo_dj || '',
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

async function supabaseRequest(endpoint, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in Render Environment.');
  }

  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    console.error('SUPABASE ERROR:', data);
    throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  }

  return data;
}

app.get('/api/config', (_req, res) => {
  res.json({
    whatsappNumber,
    appUrl
  });
});

/* DEBUG SUPABASE */
app.get('/api/test-supabase', async (_req, res) => {
  try {
    const rows = await supabaseRequest(
      'tickets?select=*&limit=1',
      { method: 'GET' }
    );

    res.json({
      success: true,
      supabaseUrl: SUPABASE_URL,
      rows
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      supabaseUrl: SUPABASE_URL,
      errorName: error.name,
      errorMessage: error.message,
      errorCause: error.cause ? {
        code: error.cause.code,
        errno: error.cause.errno,
        syscall: error.cause.syscall,
        hostname: error.cause.hostname,
        message: error.cause.message
      } : null,
      fullError: String(error)
    });
  }
});

/* ACCESS REQUEST + PROMO CODE */
app.post('/api/access-request', async (req, res) => {
  try {
    const {
      fullName,
      phone,
      instagram,
      passType,
      guests,
      message,
      promoCode
    } = req.body || {};

    if (!fullName || !phone || !passType) {
      return res.status(400).json({
        error: 'fullName, phone and passType are required.'
      });
    }

    let finalPromoCode = '';
    let promoDj = '';

    if (promoCode && String(promoCode).trim() !== '') {
      finalPromoCode = String(promoCode).trim().toUpperCase();

      const promoRows = await supabaseRequest(
        `promo_codes?code=eq.${encodeURIComponent(finalPromoCode)}&select=*`,
        { method: 'GET' }
      );

      if (!promoRows || !promoRows.length) {
        return res.status(400).json({
          error: 'Invalid promo code.'
        });
      }

      const promo = promoRows[0];

      if (!promo.active) {
        return res.status(400).json({
          error: 'This promo code is not active.'
        });
      }

      if (Number(promo.used_count || 0) >= Number(promo.max_uses || 10)) {
        return res.status(400).json({
          error: 'This promo code has reached its limit.'
        });
      }

      promoDj = promo.dj_name;
    }

    const reference = makeReference('LAYLA');

    const inserted = await supabaseRequest('tickets', {
      method: 'POST',
      body: JSON.stringify({
        reference,
        full_name: String(fullName).trim(),
        phone: String(phone).trim(),
        instagram: instagram ? String(instagram).trim() : '',
        pass_type: String(passType).trim(),
        guests: Math.max(1, Math.min(10, Number(guests || 1))),
        message: message ? String(message).trim() : '',
        promo_code: finalPromoCode,
        promo_dj: promoDj,
        status: 'pending',
        ticket_status: 'unused'
      })
    });

    if (finalPromoCode) {
      const promoRowsAfterInsert = await supabaseRequest(
        `promo_codes?code=eq.${encodeURIComponent(finalPromoCode)}&select=*`,
        { method: 'GET' }
      );

      if (promoRowsAfterInsert && promoRowsAfterInsert.length) {
        const promo = promoRowsAfterInsert[0];
        const nextUsedCount = Number(promo.used_count || 0) + 1;

        await supabaseRequest(
          `promo_codes?code=eq.${encodeURIComponent(finalPromoCode)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              used_count: nextUsedCount
            })
          }
        );
      }
    }

    res.json({
      success: true,
      guest: toGuest(inserted[0])
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

    const rows = await supabaseRequest(
      'tickets?select=*&order=created_at.desc&limit=500',
      { method: 'GET' }
    );

    res.json({
      guests: rows.map(toGuest)
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

    const reference = req.params.reference;

    const updated = await supabaseRequest(
      `tickets?reference=eq.${encodeURIComponent(reference)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status
        })
      }
    );

    if (!updated || !updated.length) {
      return res.status(404).json({ error: 'Guest not found.' });
    }

    res.json({
      guest: toGuest(updated[0])
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
    const reference = req.params.reference;

    const rows = await supabaseRequest(
      `tickets?reference=eq.${encodeURIComponent(reference)}&select=*`,
      { method: 'GET' }
    );

    if (!rows || !rows.length) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }

    const guest = toGuest(rows[0]);

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

    const { reference } = req.body || {};

    if (!reference) {
      return res.status(400).json({
        error: 'reference is required.'
      });
    }

    const cleanReference = String(reference).trim();

    const rows = await supabaseRequest(
      `tickets?reference=eq.${encodeURIComponent(cleanReference)}&select=*`,
      { method: 'GET' }
    );

    if (!rows || !rows.length) {
      return res.status(404).json({
        error: 'Invitation not found.'
      });
    }

    const guest = toGuest(rows[0]);

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

    const updated = await supabaseRequest(
      `tickets?reference=eq.${encodeURIComponent(cleanReference)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ticket_status: 'used',
          used_at: new Date().toISOString()
        })
      }
    );

    res.json({
      success: true,
      guest: toGuest(updated[0])
    });

  } catch (error) {
    console.error('SCAN ERROR:', error.message);
    res.status(500).json({
      error: error.message || 'Unable to scan invitation.'
    });
  }
});
app.get('/api/current-phase', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return res.status(500).json({ error: 'Could not count tickets' });
    }

    const sold = count || 0;

    if (sold < 20) {
      return res.json({
        phaseNumber: 1,
        phase: 'Phase 1 — Early Access',
        price: 150,
        limit: 20,
        sold,
        remaining: 20 - sold,
        soldOut: false
      });
    }

    if (sold < 40) {
      return res.json({
        phaseNumber: 2,
        phase: 'Phase 2 — Regular Access',
        price: 200,
        limit: 20,
        sold,
        remaining: 40 - sold,
        soldOut: false
      });
    }

    if (sold < 70) {
      return res.json({
        phaseNumber: 3,
        phase: 'Phase 3 — Last Call',
        price: 250,
        limit: 30,
        sold,
        remaining: 70 - sold,
        soldOut: false
      });
    }

    return res.json({
      phaseNumber: 0,
      phase: 'Sold Out',
      price: 0,
      limit: 0,
      sold,
      remaining: 0,
      soldOut: true
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});
app.listen(port, () => {
  console.log(`Layla Nights running on port ${port}`);
  console.log(`Public URL: ${appUrl}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
});
