const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storage = require('./storage');

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

function genId() { 
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); 
}

function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>"'&]/g, '') // Strip XSS dangerous characters
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

  const cfg = storage.getConfig();
  const currentPassword = process.env.ADMIN_PASSWORD || cfg?.adminPassword || 'admin123';

  const bufProvided = Buffer.from(provided);
  const bufCurrent = Buffer.from(currentPassword);

  if (bufProvided.length !== bufCurrent.length) return false;
  return crypto.timingSafeEqual(bufProvided, bufCurrent);
}

// ============ API ENDPOINTS ============

// General rate limiting for API
app.use('/api/', rateLimiter('general', 120, 60000, 'Çok fazla istek gönderildi.'));

// 1. Schedule config
app.get('/api/config/schedule', (req, res) => {
  const c = storage.getConfig();
  res.json({ schedule: c.schedule, defaultDuration: c.defaultDuration || 60 });
});

app.put('/api/config/schedule', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen tekrar giriş yapın.' });
  const c = { ...storage.getConfig() };
  if (req.body.schedule && typeof req.body.schedule === 'object') c.schedule = req.body.schedule;
  if (req.body.defaultDuration != null && Number.isInteger(req.body.defaultDuration)) {
    c.defaultDuration = Math.min(Math.max(req.body.defaultDuration, 30), 240);
  }
  storage.setConfig(c);
  res.json({ status: 'ok' });
});

// 2. Blocks
app.get('/api/blocks', (req, res) => {
  const allBlocks = storage.getBlocks();
  const isAdmin = verifyAdmin(req);

  // Admin sees full data (Student Name + Code)
  if (isAdmin) {
    return res.json({ blocks: allBlocks });
  }

  // Public / Student View (KVKK / GDPR Protection):
  // Students CANNOT see names of other students. They only see that it is 'Dolu' and the tag/code.
  const sanitized = allBlocks.map(b => ({
    id: b.id,
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    studentCode: b.studentCode || '',
    label: b.studentCode ? `Dolu [${b.studentCode}]` : 'Dolu'
  }));

  res.json({ blocks: sanitized });
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

  const allBlocks = [...storage.getBlocks()];
  const overlap = allBlocks.some(b => b.date === date && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
  if (overlap) return res.status(409).json({ error: 'Bu zaman dilimi başka bir ders veya kapalı blokla çakışıyor.' });

  const block = { id: genId(), date, startTime, endTime, label: label || '', studentCode: studentCode || '' };
  allBlocks.push(block);
  storage.setBlocks(allBlocks);

  if (label || studentCode) {
    storage.upsertStudent({ name: label, code: studentCode });
  }

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

  const allBlocks = [...storage.getBlocks()];
  const created = [];
  const groupId = genId();
  const d = new Date(startDate + 'T00:00:00');
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);

  const sM = toMin(startTime), eM = toMin(endTime);
  for (let w = 0; w < weeks; w++) {
    const cur = new Date(d); 
    cur.setDate(cur.getDate() + w * 7);
    const ds = cur.toISOString().split('T')[0];
    const overlap = allBlocks.some(b => b.date === ds && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
    if (!overlap) {
      const block = { id: genId(), groupId, date: ds, startTime, endTime, label: label || '', studentCode: studentCode || '', dayOfWeek };
      allBlocks.push(block);
      created.push(block);
    }
  }
  storage.setBlocks(allBlocks);

  if (label || studentCode) {
    storage.upsertStudent({ name: label, code: studentCode });
  }

  res.json({ status: 'ok', created, count: created.length, groupId });
});

app.get('/api/recurring-groups', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const allBlocks = storage.getBlocks();
  const groups = {};
  allBlocks.filter(b => b.groupId).forEach(b => {
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
  const allBlocks = storage.getBlocks();
  const toDelete = allBlocks.filter(b => b.groupId === safeGroupId);
  toDelete.forEach(b => storage.archiveRecord('block', b, `Taahhütlü grup toplu silindi (${safeGroupId})`));
  const remaining = allBlocks.filter(b => b.groupId !== safeGroupId);
  const deleted = allBlocks.length - remaining.length;
  storage.setBlocks(remaining);
  res.json({ status: 'ok', deleted });
});

app.delete('/api/blocks/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const allBlocks = storage.getBlocks();
  const blockToDelete = allBlocks.find(b => b.id === safeId);
  if (blockToDelete) {
    storage.archiveRecord('block', blockToDelete, 'Admin tarafından tekil blok silindi');
  }
  const remaining = allBlocks.filter(b => b.id !== safeId);
  storage.setBlocks(remaining);
  res.json({ status: 'ok' });
});

// 3. Requests
app.get('/api/requests/pending', (req, res) => {
  const allRequests = storage.getRequests();
  const pending = allRequests.filter(r => r.status === 'pending');
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

  const allRequests = [...storage.getRequests()];
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
  
  allRequests.push(r);
  storage.setRequests(allRequests);
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

  const allRequests = [...storage.getRequests()];
  const index = allRequests.findIndex(r => r.id === requestId && r.phone === phone);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Eşleşen aktif randevu talebi bulunamadı.' });
  }

  const reqToCancel = allRequests[index];
  storage.archiveRecord('cancel', reqToCancel, 'Öğrenci/Veli tarafından KVKK kapsamında iptal edildi');

  allRequests.splice(index, 1);
  storage.setRequests(allRequests);
  res.json({ status: 'ok', message: 'Talebiniz ve kişisel verileriniz başarıyla silindi.' });
});

app.get('/api/requests', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  res.json({ requests: storage.getRequests() });
});

app.delete('/api/requests/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const allRequests = [...storage.getRequests()];
  const reqToDelete = allRequests.find(r => r.id === safeId);
  if (reqToDelete) {
    storage.archiveRecord('request', reqToDelete, 'Admin tarafından talep silindi');
  }
  const remaining = allRequests.filter(r => r.id !== safeId);
  storage.setRequests(remaining);
  res.json({ status: 'ok' });
});

app.patch('/api/requests/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const allRequests = [...storage.getRequests()];
  const r = allRequests.find(x => x.id === safeId);
  if (!r) return res.status(404).json({ error: 'Talep bulunamadı.' });
  
  const status = sanitizeString(req.body.status, 20);
  const studentCode = sanitizeString(req.body.studentCode, 20).toUpperCase();
  if (['pending', 'approved', 'rejected'].includes(status)) {
    r.status = status;
    if (studentCode) r.studentCode = studentCode;
    storage.setRequests(allRequests);

    if (r.status === 'approved') {
      const allBlocks = [...storage.getBlocks()];
      const sM = toMin(r.startTime), eM = toMin(r.endTime);
      const exists = allBlocks.some(b => b.date === r.date && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
      if (!exists) {
        allBlocks.push({
          id: genId(),
          date: r.date,
          startTime: r.startTime,
          endTime: r.endTime,
          label: `${r.firstName} ${r.lastName}`,
          studentCode: studentCode || r.studentCode || ''
        });
        storage.setBlocks(allBlocks);
      }

      storage.upsertStudent({
        name: `${r.firstName} ${r.lastName}`.trim(),
        code: studentCode || r.studentCode || '',
        phone: r.phone || ''
      });
    }
  }
  res.json({ status: 'ok', request: r });
});

// 4. Analytics
app.get('/api/analytics', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const allBlocks = storage.getBlocks();
  const allRequests = storage.getRequests();

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
  const totalRequests = allRequests.length;
  const approvedRequests = allRequests.filter(r => r.status === 'approved').length;

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

  const allBlocks = storage.getBlocks();
  const studentBlocks = allBlocks.filter(b => (b.studentCode || '').trim().toUpperCase() === code);

  if (!studentBlocks.length) {
    return res.status(404).json({ error: `"${code}" koduna ait ders kaydı bulunamadı. Lütfen kodunuzu kontrol ediniz.` });
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

// 4.2. Students Directory Management (Admin Only)
app.get('/api/admin/students', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  res.json({ students: storage.getStudents() });
});

app.post('/api/admin/students', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  let { id, name, code, grade, parentName, phone, notes } = req.body;
  name = sanitizeString(name, 50);
  code = sanitizeString(code, 20).toUpperCase();
  grade = sanitizeString(grade, 30);
  parentName = sanitizeString(parentName, 50);
  phone = sanitizeString(phone, 20).replace(/\D/g, '');
  notes = sanitizeString(notes, 300);

  if (!name && !code) {
    return res.status(400).json({ error: 'Öğrenci adı veya takip kodu zorunludur.' });
  }

  const updatedList = storage.upsertStudent({ id, name, code, grade, parentName, phone, notes });
  res.json({ status: 'ok', students: updatedList });
});

app.delete('/api/admin/students/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const list = storage.getStudents().filter(s => s.id !== safeId);
  storage.setStudents(list);
  res.json({ status: 'ok', students: list });
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
  const c = { ...storage.getConfig() };
  c.adminPassword = newPassword;
  storage.setConfig(c);
  res.json({ status: 'ok' });
});

// 6. Data Persistence, Backup & Restore Endpoints
app.get('/api/admin/export-data', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const blocks = storage.getBlocks();
  const requests = storage.getRequests();
  const students = storage.getStudents();
  const config = storage.getConfig();
  const archive = storage.getArchive();

  const dump = {
    exportedAt: new Date().toISOString(),
    system: 'Ders Takip Sistemi Bulut & Yerel Kalıcı Yedek',
    version: '2.0',
    stats: {
      blocksCount: blocks.length,
      requestsCount: requests.length,
      studentsCount: students.length,
      archiveCount: (archive.deletedBlocks || []).length
    },
    blocks,
    requests,
    students,
    config,
    archive
  };

  const dateStr = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="derstakip_tam_yedek_${dateStr}.json"`);
  res.send(JSON.stringify(dump, null, 2));
});

app.post('/api/admin/import-data', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const { blocks, requests, students, config, archive } = req.body;

  if (!Array.isArray(blocks) && !Array.isArray(requests)) {
    return res.status(400).json({ error: 'Geçersiz yedek dosyası yapısı. "blocks" veya "requests" dizisi bulunamadı.' });
  }

  // Create immediate pre-restore snapshot
  storage.createDailySnapshot();

  if (Array.isArray(blocks)) {
    storage.setBlocks(blocks);
  }
  if (Array.isArray(requests)) {
    storage.setRequests(requests);
  }
  if (Array.isArray(students)) {
    storage.setStudents(students);
  }
  if (config && typeof config === 'object' && config.schedule) {
    storage.setConfig(config);
  }
  if (archive && typeof archive === 'object') {
    storage.setArchive(archive);
  }

  res.json({
    status: 'ok',
    message: 'Yedek başarıyla geri yüklendi ve bulutla senkronize edildi.',
    blocksCount: blocks ? blocks.length : 0,
    requestsCount: requests ? requests.length : 0,
    studentsCount: students ? students.length : 0
  });
});

app.get('/api/admin/archive', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  res.json(storage.getArchive());
});

app.post('/api/admin/restore-block/:id', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  const safeId = sanitizeString(req.params.id, 64);
  const archiveData = { ...storage.getArchive() };
  archiveData.deletedBlocks = archiveData.deletedBlocks || [];
  const idx = archiveData.deletedBlocks.findIndex(b => b.id === safeId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Arşivde belirtilen ders bloğu bulunamadı.' });
  }

  const restored = archiveData.deletedBlocks.splice(idx, 1)[0];
  delete restored.archivedAt;
  delete restored.archiveReason;

  const allBlocks = [...storage.getBlocks()];
  const sM = toMin(restored.startTime), eM = toMin(restored.endTime);
  const overlap = allBlocks.some(b => b.date === restored.date && toMin(b.startTime) < eM && toMin(b.endTime) > sM);
  if (overlap) {
    // Put it back
    archiveData.deletedBlocks.splice(idx, 0, restored);
    return res.status(409).json({ error: 'Bu saat diliminde şu an başka bir ders bloğu bulunuyor! Çakışma nedeniyle geri yüklenemedi.' });
  }

  allBlocks.push(restored);
  storage.setBlocks(allBlocks);
  storage.setArchive(archiveData);
  res.json({ status: 'ok', restored });
});

app.get('/api/admin/backups-list', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  try {
    const status = storage.getStorageStatus();
    const bDir = status.backupFolder;
    if (!fs.existsSync(bDir)) fs.mkdirSync(bDir, { recursive: true });
    const files = fs.readdirSync(bDir)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .map(f => {
        const p = path.join(bDir, f);
        const st = fs.statSync(p);
        return {
          filename: f,
          sizeBytes: st.size,
          createdAt: st.mtime
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ backups: files });
  } catch (err) {
    res.status(500).json({ error: 'Yedek listesi alınamadı.' });
  }
});

app.get('/api/admin/storage-status', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Yetkisiz erişim.' });
  res.json(storage.getStorageStatus());
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

// Storage Init & Server Start
storage.init().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Ders Takip Sunucusu: http://localhost:${PORT}`);
    console.log(`📋 Admin Paneli: http://localhost:${PORT}/admin.html`);
  });
}).catch(err => {
  console.error('Storage initialization failed:', err);
  app.listen(PORT, () => {
    console.log(`🚀 Ders Takip Sunucusu (Fallback): http://localhost:${PORT}`);
  });
});
