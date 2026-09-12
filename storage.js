const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

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
  defaultDuration: 60
};

// In-Memory Fast Cache
let memoryStore = {
  blocks: [],
  requests: [],
  students: [],
  config: DEFAULT_CONFIG,
  archive: { deletedBlocks: [], deletedRequests: [], cancelledRequests: [] }
};

let mongoClient = null;
let mongoCol = null;
let isMongoConnected = false;

// Helpers
function readJSON(f) {
  try {
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSONAtomic(f, d) {
  if (d === null || d === undefined) return;
  try {
    const content = JSON.stringify(d, null, 2);
    if (fs.existsSync(f)) {
      try { fs.copyFileSync(f, f + '.bak'); } catch (e) {}
    }
    const tmpFile = f + '.' + Date.now() + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, f);
  } catch (err) {
    console.error('File write error for', f, ':', err.message);
  }
}

// Background sync to MongoDB Atlas
function syncToMongo(key, data) {
  if (!isMongoConnected || !mongoCol) return;
  mongoCol.updateOne(
    { _id: key },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  ).catch(err => {
    console.error('[MongoDB Sync Error] ' + key + ':', err.message);
  });
}

// Storage Manager
const storage = {
  async init() {
    // 1. Ensure local folders exist
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

    // 2. Load local files into memoryStore initially
    const localBlocks = readJSON(BLOCKS_FILE);
    memoryStore.blocks = localBlocks && Array.isArray(localBlocks.blocks) ? localBlocks.blocks : [];

    const localRequests = readJSON(REQUESTS_FILE);
    memoryStore.requests = localRequests && Array.isArray(localRequests.requests) ? localRequests.requests : [];

    const localStudents = readJSON(STUDENTS_FILE);
    memoryStore.students = localStudents && Array.isArray(localStudents.students) ? localStudents.students : [];

    const localConfig = readJSON(CONFIG_FILE);
    memoryStore.config = localConfig && localConfig.schedule ? localConfig : DEFAULT_CONFIG;

    const localArchive = readJSON(ARCHIVE_FILE);
    memoryStore.archive = localArchive || { deletedBlocks: [], deletedRequests: [], cancelledRequests: [] };

    // Save defaults if files don't exist
    if (!fs.existsSync(BLOCKS_FILE)) writeJSONAtomic(BLOCKS_FILE, { blocks: memoryStore.blocks });
    if (!fs.existsSync(REQUESTS_FILE)) writeJSONAtomic(REQUESTS_FILE, { requests: memoryStore.requests });
    if (!fs.existsSync(STUDENTS_FILE)) writeJSONAtomic(STUDENTS_FILE, { students: memoryStore.students });
    if (!fs.existsSync(CONFIG_FILE)) writeJSONAtomic(CONFIG_FILE, memoryStore.config);
    if (!fs.existsSync(ARCHIVE_FILE)) writeJSONAtomic(ARCHIVE_FILE, memoryStore.archive);

    // 3. Connect to MongoDB Atlas if MONGODB_URI is provided
    const uri = process.env.MONGODB_URI;
    if (uri && typeof uri === 'string' && uri.trim().startsWith('mongodb')) {
      try {
        console.log('🔄 [MongoDB] Bulut veritabanina baglaniliyor...');
        mongoClient = new MongoClient(uri, {
          serverSelectionTimeoutMS: 8000,
          connectTimeoutMS: 8000
        });
        await mongoClient.connect();
        const dbName = process.env.MONGODB_DB_NAME || 'derstakip';
        const db = mongoClient.db(dbName);
        mongoCol = db.collection('app_store');
        isMongoConnected = true;

        console.log('✅ [MongoDB Atlas] Baglanti basarili! Verileriniz bulutta kalici olarak korunuyor.');

        // Hydrate from MongoDB or Migrate local data to MongoDB if empty
        const [mBlocks, mRequests, mStudents, mConfig, mArchive] = await Promise.all([
          mongoCol.findOne({ _id: 'blocks' }),
          mongoCol.findOne({ _id: 'requests' }),
          mongoCol.findOne({ _id: 'students' }),
          mongoCol.findOne({ _id: 'config' }),
          mongoCol.findOne({ _id: 'archive' })
        ]);

        if (mBlocks && Array.isArray(mBlocks.data)) {
          memoryStore.blocks = mBlocks.data;
          writeJSONAtomic(BLOCKS_FILE, { blocks: memoryStore.blocks });
        } else if (memoryStore.blocks.length > 0) {
          syncToMongo('blocks', memoryStore.blocks);
        }

        if (mRequests && Array.isArray(mRequests.data)) {
          memoryStore.requests = mRequests.data;
          writeJSONAtomic(REQUESTS_FILE, { requests: memoryStore.requests });
        } else if (memoryStore.requests.length > 0) {
          syncToMongo('requests', memoryStore.requests);
        }

        if (mStudents && Array.isArray(mStudents.data)) {
          memoryStore.students = mStudents.data;
          writeJSONAtomic(STUDENTS_FILE, { students: memoryStore.students });
        } else if (memoryStore.students.length > 0) {
          syncToMongo('students', memoryStore.students);
        }

        if (mConfig && mConfig.data && mConfig.data.schedule) {
          memoryStore.config = mConfig.data;
          writeJSONAtomic(CONFIG_FILE, memoryStore.config);
        } else {
          syncToMongo('config', memoryStore.config);
        }

        if (mArchive && mArchive.data) {
          memoryStore.archive = mArchive.data;
          writeJSONAtomic(ARCHIVE_FILE, memoryStore.archive);
        } else {
          syncToMongo('archive', memoryStore.archive);
        }
      } catch (err) {
        console.error('⚠️ [MongoDB Baglanti Hatasi]:', err.message);
        console.log('📁 [Fallback]: Yerel disk depolamasi uzerinden calismaya devam ediliyor.');
        isMongoConnected = false;
      }
    } else {
      console.log('📁 [Yerel Depolama]: MONGODB_URI tanimli degil, veriler yerel diskte (data/) saklaniyor.');
    }

    // Auto-seed students from blocks and requests if empty
    this.autoSeedStudents();

    // 4. Create initial snapshot and schedule recurring snapshot
    this.createDailySnapshot();
    setInterval(() => this.createDailySnapshot(), 1000 * 60 * 60 * 12);
  },

  autoSeedStudents() {
    if (memoryStore.students && memoryStore.students.length > 0) return;
    const studentMap = {};

    // Check requests for student names and phone numbers
    (memoryStore.requests || []).forEach(r => {
      const name = `${r.firstName || ''} ${r.lastName || ''}`.trim();
      const code = (r.studentCode || '').trim().toUpperCase();
      const phone = (r.phone || '').trim();
      const key = code || name;
      if (key && !studentMap[key]) {
        studentMap[key] = {
          id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
          name: name || code,
          code: code,
          grade: '—',
          parentName: name ? `Sayın Veli (${name})` : '—',
          phone: phone,
          notes: '',
          createdAt: new Date().toISOString()
        };
      }
    });

    // Check blocks
    (memoryStore.blocks || []).forEach(b => {
      const name = (b.label || '').trim();
      const code = (b.studentCode || '').trim().toUpperCase();
      const key = code || name;
      if (key && !studentMap[key]) {
        studentMap[key] = {
          id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
          name: name || code,
          code: code,
          grade: '—',
          parentName: '—',
          phone: '',
          notes: '',
          createdAt: new Date().toISOString()
        };
      }
    });

    const list = Object.values(studentMap);
    if (list.length > 0) {
      this.setStudents(list);
    }
  },

  getBlocks() {
    return memoryStore.blocks;
  },

  setBlocks(blocks) {
    memoryStore.blocks = Array.isArray(blocks) ? blocks : [];
    writeJSONAtomic(BLOCKS_FILE, { blocks: memoryStore.blocks });
    syncToMongo('blocks', memoryStore.blocks);
  },

  getRequests() {
    return memoryStore.requests;
  },

  setRequests(requests) {
    memoryStore.requests = Array.isArray(requests) ? requests : [];
    writeJSONAtomic(REQUESTS_FILE, { requests: memoryStore.requests });
    syncToMongo('requests', memoryStore.requests);
  },

  getStudents() {
    return memoryStore.students || [];
  },

  setStudents(students) {
    memoryStore.students = Array.isArray(students) ? students : [];
    writeJSONAtomic(STUDENTS_FILE, { students: memoryStore.students });
    syncToMongo('students', memoryStore.students);
  },

  upsertStudent(studentData) {
    const list = [...(memoryStore.students || [])];
    const index = list.findIndex(s => 
      (studentData.id && s.id === studentData.id) ||
      (studentData.code && s.code && s.code.toUpperCase() === studentData.code.toUpperCase()) ||
      (studentData.name && s.name && s.name.toLowerCase() === studentData.name.toLowerCase())
    );

    if (index >= 0) {
      list[index] = { ...list[index], ...studentData, updatedAt: new Date().toISOString() };
    } else {
      const newStudent = {
        id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
        name: studentData.name || '',
        code: (studentData.code || '').toUpperCase(),
        grade: studentData.grade || '—',
        parentName: studentData.parentName || '—',
        phone: studentData.phone || '',
        notes: studentData.notes || '',
        createdAt: new Date().toISOString()
      };
      list.push(newStudent);
    }
    this.setStudents(list);
    return list;
  },

  getConfig() {
    return memoryStore.config;
  },

  setConfig(cfg) {
    memoryStore.config = cfg || DEFAULT_CONFIG;
    writeJSONAtomic(CONFIG_FILE, memoryStore.config);
    syncToMongo('config', memoryStore.config);
  },

  getArchive() {
    return memoryStore.archive;
  },

  setArchive(archive) {
    memoryStore.archive = archive || { deletedBlocks: [], deletedRequests: [], cancelledRequests: [] };
    writeJSONAtomic(ARCHIVE_FILE, memoryStore.archive);
    syncToMongo('archive', memoryStore.archive);
  },

  archiveRecord(type, record, reason = 'Kullanici/Admin tarafindan silindi') {
    const archive = memoryStore.archive || { deletedBlocks: [], deletedRequests: [], cancelledRequests: [] };
    const entry = {
      ...record,
      archivedAt: new Date().toISOString(),
      archiveReason: reason
    };
    if (type === 'block') {
      if (!archive.deletedBlocks) archive.deletedBlocks = [];
      archive.deletedBlocks.push(entry);
    } else if (type === 'request') {
      if (!archive.deletedRequests) archive.deletedRequests = [];
      archive.deletedRequests.push(entry);
    } else if (type === 'cancel') {
      if (!archive.cancelledRequests) archive.cancelledRequests = [];
      archive.cancelledRequests.push(entry);
    }
    this.setArchive(archive);
  },

  createDailySnapshot() {
    try {
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      const today = new Date().toISOString().split('T')[0];
      const snapFile = path.join(BACKUPS_DIR, 'snapshot-' + today + '.json');

      const snapshot = {
        snapshotDate: today,
        createdAt: new Date().toISOString(),
        isCloudConnected: isMongoConnected,
        stats: {
          blocksCount: memoryStore.blocks.length,
          requestsCount: memoryStore.requests.length,
          studentsCount: (memoryStore.students || []).length
        },
        blocks: memoryStore.blocks,
        requests: memoryStore.requests,
        students: memoryStore.students,
        config: memoryStore.config,
        archive: memoryStore.archive
      };

      writeJSONAtomic(snapFile, snapshot);

      // Prune backups older than 30 days
      const files = fs.readdirSync(BACKUPS_DIR);
      files.forEach(file => {
        if (file.startsWith('snapshot-') && file.endsWith('.json')) {
          const filePath = path.join(BACKUPS_DIR, file);
          const stats = fs.statSync(filePath);
          const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
          if (ageInDays > 30) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }
        }
      });
    } catch (err) {
      console.error('Snapshot creation error:', err.message);
    }
  },

  getStorageStatus() {
    return {
      isCloud: isMongoConnected,
      engine: isMongoConnected ? 'MongoDB Atlas (Bulut Veritabanı — Asla Sıfırlanmaz)' : 'Yerel Disk (Atomik JSON)',
      backupFolder: BACKUPS_DIR,
      hasMongoUri: !!process.env.MONGODB_URI,
      studentsCount: (memoryStore.students || []).length
    };
  }
};

module.exports = storage;
