const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use(cors());
app.use(express.json({ limit: '100kb' })); // Mitigate large payload DoS attacks

// Comprehensive HTTP Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: https:; " +
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; " +
    "connect-src 'self' https://www.google-analytics.com;"
  );
  next();
});

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting (In-Memory IP tracking)
const rateLimits = {
  login: new Map(),
  requests: new Map(),
  studentStats: new Map(),
  general: new Map()
};

function cleanExpiredRateLimits() {
  const now = Date.now();
  for (const store of Object.values(rateLimits)) {
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }
}
setInterval(cleanExpiredRateLimits, 60000); // Clean every minute

function rateLimiter(storeName, maxAttempts, windowMs, errorMessage) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const store = rateLimits[storeName];
    const now = Date.now();
    
    let record = store.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(ip, record);
      return next();
    }
    
    record.count++;
    if (record.count > maxAttempts) {
      const waitMinutes = Math.ceil((record.resetTime - now) / 60000);
      return res.status(429).json({ 
        error: `${errorMessage} Lütfen ${waitMinutes} dakika sonra tekrar deneyin.`
      });
    }
    next();
  };
}

// Data directory & paths
const DATA_DIR = path.join(__dirname, 'data');
const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  schedule: {
    1: { start: '19:00', end: '22:00' },
    2: { start: '17:00', end: '22:00' },
    3: { start: '17:00', end: '22:00' },
    4: { start: '17:00', end: '22:00' },
    5: { start: '19:00', end: '22:00' },
    6: { start: '09:00', end: '22:00' }
  },
  defaultDuration: 90
};

// Helpers & Sanitization
function readJSON(f) {
  try { 
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8')); 
  }
  catch { return null; }
}

function writeJSON(f, d) { 
  try {
    fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8'); 
  } catch (err) {
    console.error('File write error:', err.message);
  }
}

function genId() { 
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); 
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>\"'&]/g, '') // Strip XSS dangerous characters
    .trim()
    .substring(0, maxLength);
}

function addMin(t, m) {
  const [h, mi] = t.split(':').map(Number);
  const tot = h * 60 + mi + m;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

function toMin(t) { 
  const [h, m] = t.split(':').map(Number); 
  return h * 60 + m; 
}

// Timing-safe password verification
function verifyAdmin(req) {
  const provided = req.headers['x-admin-password'] || req.body?.password;
  if (!provided || typeof provided !== 'string') return false;

  const cfg = readJSON(CONFIG_FILE);
  const currentPassword = process.env.ADMIN_PASSWORD || cfg?.adminPassword || 'admin123';

  const bufProvided = Buffer.from(provided);
  const bufCurrent = Buffer.from(currentPassword);

  if (bufProvided.length !== bufCurrent.length) return false;
  return crypto.timingSafeEqual(bufProvided, bufCurrent);
}

// Init data files
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BLOCKS_FILE)) writeJSON(BLOCKS_FILE, { blocks: [] });
if (!fs.existsSync(REQUESTS_FILE)) writeJSON(REQUESTS_FILE, { requests: [] });
if (!fs.existsSync(CONFIG_FILE)) writeJSON(CONFIG_FILE, DEFAULT_CONFIG);

const cfg = readJSON(CONFIG_FILE);
if (!cfg || !cfg.schedule) { 
  writeJSON(CONFIG_FILE, DEFAULT_CONFIG); 
}

// ============ API ENDPOINTS ============

// General rate limiting for API
app.use('/api/', rateLimiter('general', 120, 60000, 'Çok fazla istek gönderildi.'));

// 1. Schedule config
app.get('/api/config/schedule', (req, res) => {
  const c = readJSON(CONFIG_FILE) || DEFAULT_CONFIG;
  res.json({ schedule: c.schedule || DEFAULT_CONFIG.schedule, defaultDuration: c.defaultDuration || 90 });
});

app.put('/api/config/schedule', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen tekrar giriş yapın.' });
  const c = readJSON(CONFIG_FILE) || DEFAULT_CONFIG;
  if (req.body.schedule && typeof req.body.schedule === 'object') c.schedule = req.body.schedule;
  if (req.body.defaultDuration != null && Number.isInteger(req.body.defaultDuration)) {
    c.defaultDuration = Math.min(Math.max(req.body.defaultDuration, 30), 240);
  }
  writeJSON(CONFIG_FILE, c);
  res.json({ status: 'ok' });
});

// 2. Blocks
app.get('/api/blocks', (req, res) => {
  const data = readJSON(BLOCKS_FILE) || { blocks: [] };
  res.json(data);
});

app.post('/api/blocks', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  
  let { date, startTime, endTime, label, studentCode } = req.body;
  date = sanitizeString(date, 10);
  startTime = sanitizeString(startTime, 5);
  endTime = sanitizeString(endTime, 5);
  label = sanitizeString(label, 60);
  studentCode = sanitizeString(studentCode, 20).toUpperCase();

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!date || !dateRegex.test(date) || !startTime || !timeRegex.test(startTime) || !endTime || !timeRegex.test(endTime)) {
    return res.status(400).json({ error: 'Geçersiz tarih veya saat formatı.' });
  }

  const sM = toMin(startTime), eM = toMin(endTime);
  if (eM <= sM) {
    return res.status(400).json({ error: 'Bitiş saati başlangıç saatinden sonra olmalıdır.' });
  }

  const data = readJSON(BLOCKS_FILE) || { blocks: [] };
  const overlap = data.blocks.some(b => b.date === date && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
  if (overlap) return res.status(409).json({ error: 'Bu zaman dilimi başka bir ders veya kapalı blokla çakışıyor.' });

  const block = { id: genId(), date, startTime, endTime, label: label || '', studentCode: studentCode || '' };
  data.blocks.push(block);
  writeJSON(BLOCKS_FILE, data);
  res.json({ status: 'ok', block });
});

app.post('/api/blocks/recurring', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  
  let { dayOfWeek, startTime, endTime, label, studentCode, weeks, startDate } = req.body;
  startTime = sanitizeString(startTime, 5);
  endTime = sanitizeString(endTime, 5);
  startDate = sanitizeString(startDate, 10);
  label = sanitizeString(label, 60);
  studentCode = sanitizeString(studentCode, 20).toUpperCase();
  weeks = parseInt(weeks, 10);
  dayOfWeek = parseInt(dayOfWeek, 10);

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 ||
      isNaN(weeks) || weeks < 1 || weeks > 52 ||
      !startDate || !dateRegex.test(startDate) ||
      !startTime || !timeRegex.test(startTime) ||
      !endTime || !timeRegex.test(endTime)) {
    return res.status(400).json({ error: 'Geçersiz taahhüt parametreleri.' });
  }

  const data = readJSON(BLOCKS_FILE) || { blocks: [] };
  const created = [];
  const groupId = genId();
  const d = new Date(startDate + 'T00:00:00');
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);

  const sM = toMin(startTime), eM = toMin(endTime);
  for (let w = 0; w < weeks; w++) {
    const cur = new Date(d); 
    cur.setDate(cur.getDate() + w * 7);
    const ds = cur.toISOString().split('T')[0];
    const overlap = data.blocks.some(b => b.date === ds && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
    if (!overlap) {
      const block = { id: genId(), groupId, date: ds, startTime, endTime, label: label || '', studentCode: studentCode || '', dayOfWeek };
      data.blocks.push(block);
      created.push(block);
    }
  }
  writeJSON(BLOCKS_FILE, data);
  res.json({ status: 'ok', created, count: created.length, groupId });
});

app.get('/api/recurring-groups', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const data = readJSON(BLOCKS_FILE) || { blocks: [] };
  const groups = {};
  data.blocks.filter(b => b.groupId).forEach(b => {
    if (!groups[b.groupId]) {
      groups[b.groupId] = { groupId: b.groupId, label: b.label, studentCode: b.studentCode || '', startTime: b.startTime, endTime: b.endTime, dayOfWeek: b.dayOfWeek, blocks: [] };
    }
    groups[b.groupId].blocks.push({ id: b.id, date: b.date });
  });
  const result = Object.values(groups).map(g => {
    g.blocks.sort((a, b) => a.date.localeCompare(b.date));
    g.count = g.blocks.length;
    g.firstDate = g.blocks[0]?.date;
    g.lastDate = g.blocks[g.blocks.length - 1]?.date;
    return g;
  }).sort((a, b) => (b.firstDate || '').localeCompare(a.firstDate || ''));
  res.json({ groups: result });
});

app.delete('/api/recurring-groups/:groupId', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeGroupId = sanitizeString(req.params.groupId, 64);
  const data = readJSON(BLOCKS_FILE) || { blocks: [] };
  const before = data.blocks.length;
  data.blocks = data.blocks.filter(b => b.groupId !== safeGroupId);
  const deleted = before - data.blocks.length;
  writeJSON(BLOCKS_FILE, data);
  res.json({ status: 'ok', deleted });
});

app.delete('/api/blocks/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const data = readJSON(BLOCKS_FILE) || { blocks: [] };
  data.blocks = data.blocks.filter(b => b.id !== safeId);
  writeJSON(BLOCKS_FILE, data);
  res.json({ status: 'ok' });
});

// 3. Requests
app.get('/api/requests/pending', (req, res) => {
  const data = readJSON(REQUESTS_FILE) || { requests: [] };
  const pending = data.requests.filter(r => r.status === 'pending');
  // Obfuscate phone numbers in public pending view for student privacy
  const sanitizedPending = pending.map(r => ({
    id: r.id,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    status: r.status
  }));
  res.json({ requests: sanitizedPending });
});

// Student Booking Form Submission with Spam Rate Limiting
app.post('/api/requests', rateLimiter('requests', 5, 600000, 'Çok fazla ders talebi gönderdiniz.'), (req, res) => {
  let { firstName, lastName, phone, date, startTime, endTime } = req.body;
  
  firstName = sanitizeString(firstName, 40);
  lastName = sanitizeString(lastName, 40);
  phone = sanitizeString(phone, 20).replace(/\D/g, '');
  date = sanitizeString(date, 10);
  startTime = sanitizeString(startTime, 5);
  endTime = sanitizeString(endTime, 5);

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!firstName || !lastName || !phone || !date || !startTime) {
    return res.status(400).json({ error: 'Lütfen tüm zorunlu alanları doldurun.' });
  }

  if (!dateRegex.test(date) || !timeRegex.test(startTime)) {
    return res.status(400).json({ error: 'Geçersiz randevu tarihi veya saati.' });
  }

  // Turkish Mobile Phone Number Check (Must start with 5 and be exactly 10 digits)
  if (phone.length !== 10 || phone[0] !== '5') {
    return res.status(400).json({ error: 'Telefon numarası 5 ile başlamalı ve 10 haneli olmalıdır (Örn: 5XX XXX XX XX).' });
  }

  const data = readJSON(REQUESTS_FILE) || { requests: [] };
  const r = {
    id: genId(),
    firstName,
    lastName,
    phone,
    date,
    startTime,
    endTime: endTime || addMin(startTime, 90),
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  
  data.requests.push(r);
  writeJSON(REQUESTS_FILE, data);
  res.json({ status: 'ok', request: { id: r.id, date: r.date, startTime: r.startTime, endTime: r.endTime } });
});

// KVKK / GDPR Data Deletion / Request Cancellation by Student
app.post('/api/requests/cancel', rateLimiter('requests', 5, 300000, 'Çok fazla işlem denemesi.'), (req, res) => {
  let { requestId, phone } = req.body;
  requestId = sanitizeString(requestId, 64);
  phone = sanitizeString(phone, 20).replace(/\D/g, '');

  if (!requestId || !phone) {
    return res.status(400).json({ error: 'Talep ID ve telefon numarası zorunludur.' });
  }

  const data = readJSON(REQUESTS_FILE) || { requests: [] };
  const index = data.requests.findIndex(r => r.id === requestId && r.phone === phone);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Eşleşen aktif randevu talebi bulunamadı.' });
  }

  data.requests.splice(index, 1);
  writeJSON(REQUESTS_FILE, data);
  res.json({ status: 'ok', message: 'Talebiniz ve kişisel verileriniz başarıyla silindi.' });
});

app.get('/api/requests', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  res.json(readJSON(REQUESTS_FILE) || { requests: [] });
});

app.delete('/api/requests/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const data = readJSON(REQUESTS_FILE) || { requests: [] };
  data.requests = data.requests.filter(r => r.id !== safeId);
  writeJSON(REQUESTS_FILE, data);
  res.json({ status: 'ok' });
});

app.patch('/api/requests/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const data = readJSON(REQUESTS_FILE) || { requests: [] };
  const r = data.requests.find(x => x.id === safeId);
  if (!r) return res.status(404).json({ error: 'Talep bulunamadı.' });
  
  const status = sanitizeString(req.body.status, 20);
  const studentCode = sanitizeString(req.body.studentCode, 20).toUpperCase();
  if (['pending', 'approved', 'rejected'].includes(status)) {
    r.status = status;
    if (studentCode) r.studentCode = studentCode;
    writeJSON(REQUESTS_FILE, data);

    if (r.status === 'approved') {
      const bd = readJSON(BLOCKS_FILE) || { blocks: [] };
      const sM = toMin(r.startTime), eM = toMin(r.endTime);
      const exists = bd.blocks.some(b => b.date === r.date && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
      if (!exists) {
        bd.blocks.push({
          id: genId(),
          date: r.date,
          startTime: r.startTime,
          endTime: r.endTime,
          label: `${r.firstName} ${r.lastName}`,
          studentCode: studentCode || r.studentCode || ''
        });
        writeJSON(BLOCKS_FILE, bd);
      }
    }
  }
  res.json({ status: 'ok', request: r });
});

// 4. Analytics
app.get('/api/analytics', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const blocksData = readJSON(BLOCKS_FILE) || { blocks: [] };
  const reqData = readJSON(REQUESTS_FILE) || { requests: [] };
  const allBlocks = blocksData.blocks;

  const monthly = {};
  allBlocks.forEach(b => {
    const ym = b.date.substring(0, 7);
    if (!monthly[ym]) monthly[ym] = { count: 0, hours: 0 };
    monthly[ym].count++;
    monthly[ym].hours += (toMin(b.endTime) - toMin(b.startTime)) / 60;
  });

  const students = {};
  const studentCodes = {};

  allBlocks.filter(b => (b.label && b.label.trim()) || (b.studentCode && b.studentCode.trim())).forEach(b => {
    const name = (b.label || '').trim() || (b.studentCode || '').trim();
    if (!students[name]) students[name] = { count: 0, hours: 0, studentCode: b.studentCode || '' };
    students[name].count++;
    students[name].hours += (toMin(b.endTime) - toMin(b.startTime)) / 60;
    if (b.studentCode && !students[name].studentCode) {
      students[name].studentCode = b.studentCode;
    }

    if (b.studentCode) {
      const code = b.studentCode.trim().toUpperCase();
      if (!studentCodes[code]) {
        studentCodes[code] = { code, studentName: b.label || '', count: 0, hours: 0 };
      }
      studentCodes[code].count++;
      studentCodes[code].hours += (toMin(b.endTime) - toMin(b.startTime)) / 60;
      if (b.label && !studentCodes[code].studentName) {
        studentCodes[code].studentName = b.label;
      }
    }
  });

  const totalBlocks = allBlocks.length;
  const totalHours = allBlocks.reduce((sum, b) => sum + (toMin(b.endTime) - toMin(b.startTime)) / 60, 0);
  const totalRequests = reqData.requests.length;
  const approvedRequests = reqData.requests.filter(r => r.status === 'approved').length;

  res.json({
    total: { blocks: totalBlocks, hours: Math.round(totalHours * 10) / 10, requests: totalRequests, approved: approvedRequests },
    monthly,
    students,
    studentCodes: Object.values(studentCodes)
  });
});

// 4.1. Public Student / Parent Stats by Student Code (Privacy Protected)
app.get('/api/student-stats/:code', rateLimiter('studentStats', 30, 60000, 'Çok fazla sorgulama yaptınız.'), (req, res) => {
  const code = sanitizeString(req.params.code, 20).toUpperCase();
  if (!code) {
    return res.status(400).json({ error: 'Lütfen geçerli bir öğrenci kodu giriniz.' });
  }

  const blocksData = readJSON(BLOCKS_FILE) || { blocks: [] };
  const allBlocks = blocksData.blocks;

  // Filter lessons matching this student code
  const studentBlocks = allBlocks.filter(b => (b.studentCode || '').trim().toUpperCase() === code);

  if (!studentBlocks.length) {
    return res.status(404).json({ error: `\"${code}\" koduna ait ders kaydı bulunamadı. Lütfen kodunuzu kontrol ediniz.` });
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const currentYM = todayStr.substring(0, 7);

  let totalCount = 0;
  let totalHours = 0;
  let thisMonthCount = 0;
  let thisMonthHours = 0;
  const monthlyBreakdown = {};
  const upcomingLessons = [];
  const pastLessons = [];

  studentBlocks.sort((a, b) => a.date.localeCompare(b.date));

  studentBlocks.forEach(b => {
    const hours = (toMin(b.endTime) - toMin(b.startTime)) / 60;
    totalCount++;
    totalHours += hours;

    const ym = b.date.substring(0, 7);
    if (!monthlyBreakdown[ym]) monthlyBreakdown[ym] = { count: 0, hours: 0 };
    monthlyBreakdown[ym].count++;
    monthlyBreakdown[ym].hours += hours;

    if (ym === currentYM) {
      thisMonthCount++;
      thisMonthHours += hours;
    }

    const lessonItem = {
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      durationMinutes: toMin(b.endTime) - toMin(b.startTime)
    };

    if (b.date >= todayStr) {
      upcomingLessons.push(lessonItem);
    } else {
      pastLessons.push(lessonItem);
    }
  });

  res.json({
    status: 'ok',
    studentCode: code,
    total: {
      count: totalCount,
      hours: Math.round(totalHours * 10) / 10
    },
    thisMonth: {
      yearMonth: currentYM,
      count: thisMonthCount,
      hours: Math.round(thisMonthHours * 10) / 10
    },
    monthly: monthlyBreakdown,
    upcomingLessons: upcomingLessons.slice(0, 10),
    pastCount: pastLessons.length
  });
});

// 5. Authentication with Brute Force Protection
app.post('/api/admin/login', rateLimiter('login', 5, 900000, 'Çok fazla hatalı giriş denemesi yapıldı.'), (req, res) => {
  const isAuth = verifyAdmin(req);
  if (isAuth) {
    res.json({ status: 'ok' });
  } else {
    res.status(401).json({ error: 'Hatalı yönetici şifresi girdiniz.' });
  }
});

app.post('/api/admin/change-password', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
  const newPassword = sanitizeString(req.body.newPassword, 64);
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
  }
  const c = readJSON(CONFIG_FILE) || DEFAULT_CONFIG;
  c.adminPassword = newPassword;
  writeJSON(CONFIG_FILE, c);
  res.json({ status: 'ok' });
});

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Global Error Handler (Masking system internals from users)
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  res.status(500).json({ error: 'Sunucu tarafında bir hata oluştu. Lütfen daha sonra tekrar deneyiniz.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Ders Takip Sunucusu: http://localhost:${PORT}`);
  console.log(`📋 Admin Paneli: http://localhost:${PORT}/admin.html`);
});
