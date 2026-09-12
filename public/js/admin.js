// ============================================
//  sy — ADMIN PANEL
// ============================================
const API = '';
let adminPassword = '', currentView = 'weekly', currentDate = new Date();
let blocks = [], requests = [], SCHEDULE = {}, defaultDuration = 60;

// Drag state
let isDragging = false, dragStart = null, dragEnd = null, dragCol = null;

const CELL_H = 32;
const DAYS = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
const DAYS_S = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

// ---- Helpers ----
function toMin(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function toTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function isToday(d) { const t=new Date(); return d.getDate()===t.getDate()&&d.getMonth()===t.getMonth()&&d.getFullYear()===t.getFullYear(); }
function weekStart(d) { const x=new Date(d); const day=x.getDay(); x.setDate(x.getDate()-day+(day===0?-6:1)); return x; }
function esc(t) { const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }

function getAllSlots() {
  let minM = 1440, maxM = 0;
  if (SCHEDULE && typeof SCHEDULE === 'object') {
    Object.values(SCHEDULE).forEach(s => {
      if (s && s.start && s.end) {
        minM = Math.min(minM, toMin(s.start));
        maxM = Math.max(maxM, toMin(s.end));
      }
    });
  }
  if (minM >= maxM || minM === 1440) { minM = 1020; maxM = 1320; }
  maxM = Math.min(maxM, 1320); // 22:00'den sonra asla ders yok
  const slots = [];
  // Yarım saatlik (buçuklu) adımlarla 22:00 dahil satırlar
  for (let m = minM; m <= maxM; m += 30) slots.push(toTime(m));
  return slots;
}

function isOff(time, dow) {
  if (time === '22:00') return true;
  const s=SCHEDULE[dow]; if(!s) return true;
  const m=toMin(time); return m<toMin(s.start)||m>=toMin(s.end);
}

function fmtDateTR(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m-1]} ${y}`;
}

function formatPhoneTR(raw) {
  const c = (raw || '').replace(/\D/g, '');
  if (!c) return '';
  const s = c.startsWith('0') ? c.slice(1) : (c.startsWith('90') ? c.slice(2) : c);
  if (s.length === 10) {
    return `0${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 8)} ${s.slice(8, 10)}`;
  }
  return c.startsWith('0') ? c : '0' + c;
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('adminPassword');
  if (saved) { adminPassword = saved; initDashboard(); }

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = document.getElementById('adminPassword').value;
    const r = await fetch(`${API}/api/admin/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pw}) });
    if (r.ok) { adminPassword=pw; sessionStorage.setItem('adminPassword',pw); toast('Giriş başarılı ✓','success'); initDashboard(); }
    else toast('Hatalı şifre!','error');
  });
});

async function initDashboard() {
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('adminDashboard').classList.add('active');
  await loadConfig(); await loadBlocks(); await loadRequests(); await loadStudents();
  setupListeners(); setupStudentAutofill(); render(); stats();
  setInterval(async()=>{await loadBlocks();await loadRequests();render();stats();},15000);
}

// ---- API ----
async function loadConfig() {
  try { const r=await fetch(`${API}/api/config/schedule`); const d=await r.json(); SCHEDULE=d.schedule; defaultDuration=d.defaultDuration||60; } catch(e) {}
}
async function loadBlocks() {
  try {
    const headers = adminPassword ? { 'X-Admin-Password': adminPassword } : {};
    const r = await fetch(`${API}/api/blocks`, { headers });
    const d = await r.json();
    blocks = d.blocks || [];
  } catch(e) {}
}
async function loadRequests() {
  try { const r=await fetch(`${API}/api/requests`,{headers:{'X-Admin-Password':adminPassword}}); const d=await r.json(); requests=d.requests||[]; renderRequests(); } catch(e) {}
}

let savedStudents = [];

async function loadStudents() {
  try {
    const r = await fetch(`${API}/api/admin/students`, {
      headers: { 'X-Admin-Password': adminPassword }
    });
    if (r.ok) {
      const d = await r.json();
      savedStudents = d.students || [];
      updateStudentDatalists();
      renderStudentsDirectory();
    }
  } catch(e) {}
}

function updateStudentDatalists() {
  const codesDl = document.getElementById('studentCodesList');
  const namesDl = document.getElementById('studentNamesList');
  if (!codesDl || !namesDl) return;

  codesDl.innerHTML = savedStudents
    .filter(s => s.code)
    .map(s => `<option value="${esc(s.code)}">${esc(s.name || s.code)}</option>`)
    .join('');

  namesDl.innerHTML = savedStudents
    .filter(s => s.name)
    .map(s => `<option value="${esc(s.name)}">${s.code ? '[' + esc(s.code) + ']' : ''}</option>`)
    .join('');
}

function setupStudentAutofill() {
  const pairs = [
    { codeEl: document.getElementById('bmCode'), nameEl: document.getElementById('bmLabel') },
    { codeEl: document.getElementById('rcCode'), nameEl: document.getElementById('rcLabel') }
  ];

  pairs.forEach(({ codeEl, nameEl }) => {
    if (!codeEl || !nameEl) return;

    codeEl.addEventListener('input', () => {
      const val = codeEl.value.trim().toUpperCase();
      if (!val) return;
      const found = savedStudents.find(s => s.code && s.code.toUpperCase() === val);
      if (found && found.name) {
        nameEl.value = found.name;
      }
    });

    nameEl.addEventListener('input', () => {
      const val = nameEl.value.trim().toLowerCase();
      if (!val) return;
      const found = savedStudents.find(s => s.name && s.name.toLowerCase() === val);
      if (found && found.code && !codeEl.value.trim()) {
        codeEl.value = found.code;
      }
    });
  });
}

async function createBlock(date, startTime, endTime, label, studentCode) {
  const r=await fetch(`${API}/api/blocks`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':adminPassword},body:JSON.stringify({date,startTime,endTime,label,studentCode,password:adminPassword})});
  const d=await r.json();
  if(r.ok){toast(`${startTime}-${endTime} kapatıldı`,'success'); await loadBlocks(); render(); stats();}
  else toast(d.error||'Hata','error');
}

async function deleteBlock(id) {
  const r=await fetch(`${API}/api/blocks/${id}`,{method:'DELETE',headers:{'X-Admin-Password':adminPassword}});
  if(r.ok){toast('Blok silindi','info'); await loadBlocks(); render(); stats();}
}

async function createRecurring(data) {
  const r=await fetch(`${API}/api/blocks/recurring`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':adminPassword},body:JSON.stringify({...data,password:adminPassword})});
  const d=await r.json();
  if(r.ok){toast(`${d.count} blok oluşturuldu! ✓`,'success'); await loadBlocks(); render(); stats();}
  else toast(d.error||'Hata','error');
}

async function updateReqStatus(id, status, studentCode) {
  const body = { status };
  if (studentCode) body.studentCode = studentCode;
  const r=await fetch(`${API}/api/requests/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','X-Admin-Password':adminPassword},body:JSON.stringify(body)});
  if(r.ok){toast(status==='approved'?'Onaylandı ✓':'Reddedildi','success'); await loadRequests(); await loadBlocks(); render(); stats();}
}

async function deleteReq(id) {
  await fetch(`${API}/api/requests/${id}`,{method:'DELETE',headers:{'X-Admin-Password':adminPassword}});
  toast('Talep silindi','info'); await loadRequests(); render(); stats();
}

// ---- Recurring Groups ----
function buildRecurringGroupsFromBlocks() {
  const groups = {};
  const todayStr = fmtDate(new Date());
  
  blocks.forEach(b => {
    if (!b.label) return; // skip empty labels
    if (b.date < todayStr) return; // ONLY list future lessons in the active recurring groups menu!
    
    // Grouping key: if it has a groupId, group by it. Otherwise, group by label + day + time.
    let key;
    if (b.groupId) {
      key = b.groupId;
    } else {
      const d = new Date(b.date + 'T00:00:00');
      const dow = b.dayOfWeek !== undefined ? b.dayOfWeek : d.getDay();
      key = `virtual__${b.label.trim().toLowerCase()}__${dow}__${b.startTime}__${b.endTime}`;
    }
    
    if (!groups[key]) {
      const d = new Date(b.date + 'T00:00:00');
      const dow = b.dayOfWeek !== undefined ? b.dayOfWeek : d.getDay();
      groups[key] = {
        groupId: key,
        label: b.label,
        studentCode: b.studentCode || '',
        startTime: b.startTime,
        endTime: b.endTime,
        dayOfWeek: dow,
        blocks: []
      };
    }
    if (b.studentCode && !groups[key].studentCode) groups[key].studentCode = b.studentCode;
    groups[key].blocks.push({ id: b.id, date: b.date });
  });
  
  const result = Object.values(groups).map(g => {
    g.blocks.sort((a, b) => a.date.localeCompare(b.date));
    g.count = g.blocks.length;
    g.firstDate = g.blocks[0]?.date;
    g.lastDate = g.blocks[g.blocks.length - 1]?.date;
    return g;
  }).sort((a, b) => (b.firstDate || '').localeCompare(a.firstDate || ''));
  
  return result;
}

async function loadRecurringGroups() {
  try {
    const groups = buildRecurringGroupsFromBlocks();
    renderRecurringGroups(groups);
  } catch(e) { toast('Taahhütlü dersler yüklenemedi','error'); }
}

async function deleteRecurringGroup(groupId) {
  if (!confirm('Bu grubun bugünden itibaren olan TÜM dersleri silinecek (geçmiş dersleriniz korunacaktır). Emin misiniz?')) return;
  
  const todayStr = fmtDate(new Date());
  
  // Find blocks belonging to this group that are TODAY or in the FUTURE
  let toDelete = [];
  
  if (groupId.startsWith('virtual__')) {
    const parts = groupId.split('__');
    const targetLabel = parts[1];
    const targetDow = parseInt(parts[2]);
    const targetStart = parts[3];
    const targetEnd = parts[4];
    
    toDelete = blocks.filter(b => {
      if (b.date < todayStr) return false;
      const d = new Date(b.date + 'T00:00:00');
      const dow = b.dayOfWeek !== undefined ? b.dayOfWeek : d.getDay();
      return (b.label || '').trim().toLowerCase() === targetLabel &&
             dow === targetDow &&
             b.startTime === targetStart &&
             b.endTime === targetEnd;
    });
  } else {
    toDelete = blocks.filter(b => b.groupId === groupId && b.date >= todayStr);
  }
  
  if (!toDelete.length) {
    toast('Silinecek aktif/gelecek ders bulunamadı.', 'info');
    return;
  }
  
  let deletedCount = 0;
  for (const b of toDelete) {
    try {
      const r = await fetch(`${API}/api/blocks/${b.id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Password': adminPassword }
      });
      if (r.ok) deletedCount++;
    } catch(err) {}
  }
  
  toast(`${deletedCount} adet gelecek ders silindi (geçmiş dersler korundu).`, 'success');
  await loadBlocks();
  render();
  stats();
  loadRecurringGroups();
}

async function resetAllRecurringGroups() {
  const groups = buildRecurringGroupsFromBlocks();
  if (!groups.length) {
    toast('Sıfırlanacak taahhütlü ders grubu bulunmuyor.', 'info');
    return;
  }
  
  if (!confirm(`Toplam ${groups.length} taahhütlü ders grubunun bugünden itibaren olan TÜM dersleri takvimden kaldırılacak (geçmiş ders kayıtları arşivde saklanacaktır). Onaylıyor musunuz?`)) {
    return;
  }
  
  const todayStr = fmtDate(new Date());
  
  // All blocks that belong to ANY recurring group (explicit groupId OR matching virtual group) and are >= todayStr
  const toDelete = blocks.filter(b => {
    if (b.date < todayStr) return false;
    if (!b.label) return false;
    if (b.groupId) return true;
    
    const d = new Date(b.date + 'T00:00:00');
    const dow = b.dayOfWeek !== undefined ? b.dayOfWeek : d.getDay();
    const virtualKey = `virtual__${b.label.trim().toLowerCase()}__${dow}__${b.startTime}__${b.endTime}`;
    return groups.some(g => g.groupId === virtualKey);
  });
  
  if (!toDelete.length) {
    toast('Silinecek gelecek ders bulunamadı.', 'info');
    return;
  }
  
  let deletedCount = 0;
  for (const b of toDelete) {
    try {
      const r = await fetch(`${API}/api/blocks/${b.id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Password': adminPassword }
      });
      if (r.ok) deletedCount++;
    } catch(err) {}
  }
  
  toast(`Tüm taahhütler sıfırlandı! Toplam ${deletedCount} gelecek ders kaldırıldı.`, 'success');
  await loadBlocks();
  render();
  stats();
  loadRecurringGroups();
}

function renderRecurringGroups(groups) {
  const c = document.getElementById('recurringList');
  if (!groups.length) {
    c.innerHTML = '<div class="empty-state"><div class="empty-icon">🔄</div><p>Henüz taahhütlü ders yok</p><p style="color:var(--text-muted);font-size:0.85rem;">Yeni bir taahhüt oluşturmak için yukarıdaki butona tıklayın.</p></div>';
    return;
  }
  let h = '';
  groups.forEach(g => {
    const dayName = g.dayOfWeek !== undefined ? DAYS[g.dayOfWeek] : '—';
    const timeRange = `${g.startTime} – ${g.endTime}`;
    const dur = toMin(g.endTime) - toMin(g.startTime);
    const durLabel = dur >= 60 ? `${Math.floor(dur/60)} saat${dur%60 ? ` ${dur%60} dk` : ''}` : `${dur} dk`;
    const dateRange = g.firstDate && g.lastDate ? `${fmtDateTR(g.firstDate)} → ${fmtDateTR(g.lastDate)}` : '—';
    const codeTag = g.studentCode ? `<span class="recurring-code-badge" style="background:var(--accent-primary);color:#fff;padding:2px 8px;border-radius:6px;font-size:0.75rem;font-weight:700;margin-left:6px;">Kod: ${esc(g.studentCode)}</span>` : '';

    h += `<div class="recurring-card">
      <div class="recurring-header">
        <div class="recurring-info">
          <div class="recurring-label">${g.label ? esc(g.label) : '<span style="color:var(--text-muted)">Etiketsiz</span>'}${codeTag}</div>
          <div class="recurring-meta">${dayName} günleri • ${timeRange} (${durLabel})</div>
        </div>
        <div class="recurring-badge">${g.count} ders</div>
      </div>
      <div class="recurring-details">
        <div class="detail-item"><span class="icon">📅</span><span>${dateRange}</span></div>
      </div>
      <div class="recurring-blocks-preview">`;

    // Show all dates as small pills
    g.blocks.forEach(b => {
      const [,m,d] = b.date.split('-').map(Number);
      const isPast = new Date(b.date) < new Date(new Date().toISOString().split('T')[0]);
      h += `<span class="date-pill${isPast ? ' past' : ''}">${d} ${MONTHS[m-1].substring(0,3)}</span>`;
    });

    h += `</div>
      <div class="recurring-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteRecurringGroup('${g.groupId}')">🗑 Tümünü Sil</button>
      </div>
    </div>`;
  });
  c.innerHTML = h;
}

// ---- Analytics ----
async function loadAnalytics() {
  try {
    const r=await fetch(`${API}/api/analytics`,{headers:{'X-Admin-Password':adminPassword}});
    const d=await r.json();
    renderAnalytics(d);
  } catch(e) { toast('Analiz yüklenemedi','error'); }
}

function renderAnalytics(data) {
  const c=document.getElementById('analyticsContent');
  let h='';

  h+=`<div class="analytics-summary">
    <div class="stat-card primary"><div class="stat-value">${data.total.blocks}</div><div class="stat-label">Toplam Ders</div></div>
    <div class="stat-card green"><div class="stat-value">${data.total.hours}</div><div class="stat-label">Toplam Saat</div></div>
    <div class="stat-card amber"><div class="stat-value">${data.total.requests}</div><div class="stat-label">Toplam Talep</div></div>
    <div class="stat-card red"><div class="stat-value">${data.total.approved}</div><div class="stat-label">Onaylanan</div></div>
  </div>`;

  const months = Object.entries(data.monthly).sort((a,b)=>b[0].localeCompare(a[0]));
  h+=`<h3 style="margin:24px 0 12px;font-size:1.1rem;">📊 Aylık Dağılım</h3>`;
  if(months.length){
    h+='<div class="analytics-table"><table><thead><tr><th>Ay</th><th>Ders Sayısı</th><th>Toplam Saat</th></tr></thead><tbody>';
    months.forEach(([ym, val])=>{
      const [y,m]=ym.split('-');
      h+=`<tr><td>${MONTHS[parseInt(m)-1]} ${y}</td><td>${val.count}</td><td>${Math.round(val.hours*10)/10}</td></tr>`;
    });
    h+='</tbody></table></div>';
  } else h+='<p style="color:var(--text-muted);font-size:0.85rem;">Henüz veri yok.</p>';

  // Group blocks by student for this month and overall
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthTitle = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  const thisMonthMap = {};
  const allTimeMap = {};

  blocks.forEach(b => {
    const sMin = toMin(b.startTime);
    const eMin = toMin(b.endTime);
    const durHours = (eMin - sMin) / 60;
    const bCode = (b.studentCode || '').trim().toUpperCase();
    const bLabel = (b.label || '').trim();

    if (!bCode && !bLabel) return;

    // Find student profile from savedStudents
    const profile = savedStudents.find(s => 
      (bCode && s.code && s.code.toUpperCase() === bCode) ||
      (bLabel && s.name && s.name.toLowerCase() === bLabel.toLowerCase())
    );

    const code = profile?.code || bCode;
    const name = profile?.name || bLabel || code;
    const key = (code || name).toUpperCase();

    // All time stats
    if (!allTimeMap[key]) {
      allTimeMap[key] = { key, code, name, count: 0, hours: 0 };
    }
    allTimeMap[key].count++;
    allTimeMap[key].hours += durHours;

    // This month stats
    if (b.date && b.date.startsWith(currentYM)) {
      if (!thisMonthMap[key]) {
        thisMonthMap[key] = { key, code, name, count: 0, hours: 0 };
      }
      thisMonthMap[key].count++;
      thisMonthMap[key].hours += durHours;
    }
  });

  const thisMonthList = Object.values(thisMonthMap).sort((a, b) => b.hours - a.hours);

  h += `<h3 style="margin:28px 0 12px;font-size:1.1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span>📅 Bu Ayın Öğrenci Ders Dağılımı (${currentMonthTitle})</span>
    <span style="font-size:0.82rem;font-weight:600;color:var(--accent-primary);background:rgba(93,138,78,0.12);padding:3px 10px;border-radius:12px;">${thisMonthList.length} Aktif Öğrenci</span>
  </h3>`;

  if (thisMonthList.length) {
    h += `<div class="analytics-table"><table>
      <thead>
        <tr>
          <th>Kod / Etiket</th>
          <th>Öğrenci Adı Soyadı</th>
          <th>Bu Ayki Ders</th>
          <th>Bu Ayki Toplam Saat</th>
          <th>Genel Toplam Saat</th>
          <th style="text-align:right;">İşlem</th>
        </tr>
      </thead>
      <tbody>`;

    thisMonthList.forEach(item => {
      const codeBadge = item.code ? `<span style="background:var(--accent-primary);color:#fff;padding:2px 8px;border-radius:6px;font-weight:700;font-size:0.8rem;">${esc(item.code)}</span>` : '<span style="color:var(--text-muted)">—</span>';
      const overall = allTimeMap[item.key] || { count: item.count, hours: item.hours };
      const qTarget = item.code || item.name;

      h += `<tr>
        <td>${codeBadge}</td>
        <td><strong>${esc(item.name)}</strong></td>
        <td><strong style="color:var(--accent-primary);">${item.count} ders</strong></td>
        <td><strong>${Math.round(item.hours * 10) / 10} saat</strong></td>
        <td><span style="color:var(--text-secondary);">${Math.round(overall.hours * 10) / 10} saat <small style="color:var(--text-muted);">(${overall.count} ders)</small></span></td>
        <td style="text-align:right;"><button class="student-action-btn analysis" onclick="openStudentAnalysisModal('${esc(qTarget)}')">📊 Analiz</button></td>
      </tr>`;
    });

    h += `</tbody></table></div>`;
  } else {
    h += `<div style="background:var(--bg-card);border:1px dashed var(--border-glass);border-radius:var(--radius-md);padding:20px;text-align:center;color:var(--text-secondary);font-size:0.9rem;margin-bottom:24px;">
      <span style="font-size:1.6rem;display:block;margin-bottom:6px;">📅</span>
      ${currentMonthTitle} ayında henüz tamamlanmış veya planlanmış ders bulunmuyor.
    </div>`;
  }

  c.innerHTML=h;
  renderQuickStudentChips();
}

// ---- Events ----
function setupListeners() {
  // Tab navigation
  document.querySelectorAll('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById(tab.dataset.panel).classList.add('active');
    if(tab.dataset.panel==='analyticsPanel') { loadAnalytics(); renderStudentsDirectory(); }
    if(tab.dataset.panel==='recurringPanel') loadRecurringGroups();
    if(tab.dataset.panel==='backupPanel') loadBackupPanel();
  }));

  // Student directory listeners
  const addStBtn = document.getElementById('openAddStudentBtn');
  if(addStBtn) addStBtn.addEventListener('click', openAddStudentModal);

  const searchStInput = document.getElementById('studentSearchInput');
  if(searchStInput) {
    searchStInput.addEventListener('input', e => renderStudentsDirectory(e.target.value));
  }

  const stForm = document.getElementById('studentForm');
  if(stForm) {
    stForm.addEventListener('submit', handleStudentFormSubmit);
  }

  const stAnalysisForm = document.getElementById('studentAnalysisForm');
  if(stAnalysisForm) {
    stAnalysisForm.addEventListener('submit', e => {
      e.preventDefault();
      const q = (document.getElementById('studentAnalysisInput').value || '').trim();
      if (q) openStudentAnalysisModal(q);
      else toast('Lütfen bir öğrenci kodu veya adı girin', 'info');
    });
  }

  document.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click',()=>{
    document.querySelectorAll('.view-toggle button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); currentView=b.dataset.view; render();
  }));
  document.getElementById('prevBtn').addEventListener('click',()=>nav(-1));
  document.getElementById('nextBtn').addEventListener('click',()=>nav(1));
  document.getElementById('todayBtn').addEventListener('click',()=>{currentDate=new Date();render();});
  document.getElementById('logoutBtn').addEventListener('click',e=>{e.preventDefault();sessionStorage.removeItem('adminPassword');location.reload();});
  document.getElementById('recurringBtn').addEventListener('click',openRecurringModal);
  document.getElementById('recurringBtn2').addEventListener('click',openRecurringModal);
  document.getElementById('resetRecurringBtn').addEventListener('click',resetAllRecurringGroups);
  
  // Backup & Restore listeners
  const expBtn1 = document.getElementById('exportDataBtnTop');
  if(expBtn1) expBtn1.addEventListener('click', exportFullBackup);
  const expBtn2 = document.getElementById('downloadBackupBtn');
  if(expBtn2) expBtn2.addEventListener('click', exportFullBackup);

  const impBtn = document.getElementById('importBackupBtn');
  const impInput = document.getElementById('importBackupInput');
  if(impBtn && impInput) {
    impBtn.addEventListener('click', () => impInput.click());
    impInput.addEventListener('change', handleBackupImport);
  }

  const pwBtn = document.getElementById('openPasswordBtn');
  if(pwBtn) pwBtn.addEventListener('click', openPasswordModal);

  // Password form
  const pwForm = document.getElementById('passwordForm');
  if(pwForm) {
    pwForm.addEventListener('submit', async e => {
      e.preventDefault();
      const currentPw = document.getElementById('currentAdminPw').value;
      const newPw = document.getElementById('newAdminPw').value;
      const newPwConfirm = document.getElementById('newAdminPwConfirm').value;

      if(newPw !== newPwConfirm) {
        toast('Yeni şifreler birbiriyle eşleşmiyor!', 'error');
        return;
      }
      if(newPw.length < 6) {
        toast('Yeni şifre en az 6 karakter olmalıdır!', 'error');
        return;
      }

      try {
        const r = await fetch(`${API}/api/admin/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Password': currentPw },
          body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        const d = await r.json();
        if(r.ok) {
          adminPassword = newPw;
          sessionStorage.setItem('adminPassword', newPw);
          toast('Şifreniz başarıyla güncellendi ✓', 'success');
          closePasswordModal();
          pwForm.reset();
        } else {
          toast(d.error || 'Şifre güncellenemedi!', 'error');
        }
      } catch(err) {
        toast('Bağlantı hatası.', 'error');
      }
    });
  }

  // Block form
  document.getElementById('blockForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const date=document.getElementById('blockForm').dataset.date;
    const st=document.getElementById('bmStart').value;
    const en=document.getElementById('bmEnd').value;
    const lb=document.getElementById('bmLabel').value.trim();
    const code=(document.getElementById('bmCode')?.value || '').trim().toUpperCase();
    if(toMin(en)<=toMin(st)){toast('Bitiş saati başlangıçtan sonra olmalı','error');return;}
    await createBlock(date,st,en,lb,code);
    closeBlockModal();
  });

  // Duration chips
  document.querySelectorAll('.duration-chips .chip').forEach(c=>c.addEventListener('click',()=>{
    document.querySelectorAll('.duration-chips .chip').forEach(x=>x.classList.remove('active'));
    c.classList.add('active');
    const dur=parseInt(c.dataset.dur);
    const st=document.getElementById('bmStart').value;
    if(st) {
      document.getElementById('bmEnd').value=toTime(toMin(st)+dur);
      document.getElementById('bmTime').textContent=`${st} – ${toTime(toMin(st)+dur)}`;
    }
  }));

  document.getElementById('bmStart').addEventListener('change',()=>{
    const ac=document.querySelector('.duration-chips .chip.active');
    if(ac){const dur=parseInt(ac.dataset.dur); const st=document.getElementById('bmStart').value;
    document.getElementById('bmEnd').value=toTime(toMin(st)+dur);
    document.getElementById('bmTime').textContent=`${st} – ${toTime(toMin(st)+dur)}`;}
  });

  // Recurring form
  document.getElementById('recurringForm').addEventListener('submit', async e=>{
    e.preventDefault();
    const dow=parseInt(document.getElementById('rcDay').value);
    const st=document.getElementById('rcStart').value;
    const dur=parseInt(document.getElementById('rcDuration').value);
    const en=toTime(toMin(st)+dur);
    const startDate=document.getElementById('rcStartDate').value;
    const weeks=parseInt(document.getElementById('rcWeeks').value);
    const label=document.getElementById('rcLabel').value.trim();
    const code=(document.getElementById('rcCode')?.value || '').trim().toUpperCase();
    await createRecurring({dayOfWeek:dow,startTime:st,endTime:en,label,studentCode:code,weeks,startDate});
    closeRecurringModal();
    // If recurring panel is active, refresh list
    if(document.getElementById('recurringPanel').classList.contains('active')) loadRecurringGroups();
  });

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeBlockModal();closeRecurringModal();}
    if(e.key==='ArrowLeft')nav(-1);if(e.key==='ArrowRight')nav(1);
  });
}

// ---- Navigation ----
function nav(dir) {
  if(currentView==='weekly') {
    const d=new Date(currentDate);d.setDate(d.getDate()+dir*7);currentDate=d;
  } else {
    const d=new Date(currentDate);d.setMonth(d.getMonth()+dir);currentDate=d;
  }
  render();
}

function render() {
  updatePeriod();
  currentView==='weekly'?renderWeekly():renderMonthly();
}

function updatePeriod() {
  const el=document.getElementById('currentPeriod');
  if(currentView==='weekly'){
    const ws=weekStart(new Date(currentDate)), we=new Date(ws); we.setDate(we.getDate()+6);
    el.textContent=ws.getMonth()===we.getMonth()?`${ws.getDate()} – ${we.getDate()} ${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`:`${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}`;
  } else el.textContent=`${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
}

function stats() {
  document.getElementById('statTotal').textContent=requests.length;
  document.getElementById('statPending').textContent=requests.filter(r=>r.status==='pending').length;
  document.getElementById('statApproved').textContent=requests.filter(r=>r.status==='approved').length;
  document.getElementById('statClosed').textContent=blocks.length;
}

// ---- Label Color Map ----
const STUDENT_COLOR_COUNT = 10;
function buildLabelColorMap() {
  const map = {};
  let idx = 0;
  blocks.forEach(b => {
    const lbl = (b.label || '').trim().toLowerCase();
    if (lbl && !(lbl in map)) { map[lbl] = idx % STUDENT_COLOR_COUNT; idx++; }
  });
  return map;
}

// ---- Weekly Render ----
function renderWeekly() {
  const wrap=document.getElementById('calendarWrapper');
  const ws=weekStart(new Date(currentDate));
  const days=[]; for(let i=0;i<7;i++){const d=new Date(ws);d.setDate(d.getDate()+i);days.push(d);}
  const slots=getAllSlots(); if(!slots.length){wrap.innerHTML='<p>Çalışma saati tanımlı değil.</p>';return;}
  const pendingReqs=requests.filter(r=>r.status==='pending');
  const labelColors = buildLabelColorMap();

  let h='';
  h+='<div class="cal-header">';
  h+='<div class="cal-corner">Saat</div>';
  days.forEach(d=>{
    const sun=d.getDay()===0, td=isToday(d);
    h+=`<div class="cal-day-hdr${td?' today':''}${sun?' sunday':''}"><span class="dn">${DAYS_S[d.getDay()]}</span><span class="dnum">${d.getDate()}</span></div>`;
  });
  h+='</div>';

  h+='<div class="cal-body">';
  h+='<div class="cal-gutter">';
  slots.forEach(s=>h+=`<div class="cal-time" style="height:${CELL_H}px">${s}</div>`);
  h+='</div>';

  days.forEach(d=>{
    const ds=fmtDate(d), dow=d.getDay();
    h+=`<div class="cal-col" data-date="${ds}">`;
    slots.forEach(s=>{
      const off=isOff(s,dow);
      h+=`<div class="cal-cell${off?' off':''}" data-date="${ds}" data-time="${s}" style="height:${CELL_H}px"></div>`;
    });
    // Blocks overlay
    const dayBlocks=blocks.filter(b=>b.date===ds).sort((a,b)=>toMin(a.startTime)-toMin(b.startTime));
    const firstSlot=slots[0];
    dayBlocks.forEach(b=>{
      const top=(toMin(b.startTime)-toMin(firstSlot))/30*CELL_H;
      const height=(toMin(b.endTime)-toMin(b.startTime))/30*CELL_H;
      const dur=toMin(b.endTime)-toMin(b.startTime);
      const lbl=(b.label||'').trim().toLowerCase();
      const ci=lbl in labelColors ? labelColors[lbl] : '';
      h+=`<div class="cal-block" style="top:${top}px;height:${height}px" data-id="${b.id}"${ci!==''?' data-color-index="'+ci+'"':''}>`;
      h+=`<span class="cb-time">${b.startTime}–${b.endTime}</span>`;
      const codeBadge = b.studentCode ? ` <small style="background:rgba(255,255,255,0.3);padding:1px 4px;border-radius:3px;font-size:0.7rem;">[${esc(b.studentCode)}]</small>` : '';
      if(dur>=60 && b.label) h+=`<span class="cb-label">${esc(b.label)}${codeBadge}</span>`;
      else if(b.label) h+=`<span class="cb-label small">${esc(b.label)}${codeBadge}</span>`;
      else if(b.studentCode) h+=`<span class="cb-label small">${codeBadge}</span>`;
      h+=`<button class="cb-del" onclick="event.stopPropagation();deleteBlock('${b.id}')">✕</button>`;
      h+=`</div>`;
    });
    // Pending requests overlay (yellow)
    const dayPending=pendingReqs.filter(r=>r.date===ds).sort((a,b)=>toMin(a.startTime)-toMin(b.startTime));
    dayPending.forEach(r=>{
      const top=(toMin(r.startTime)-toMin(firstSlot))/30*CELL_H;
      const height=(toMin(r.endTime)-toMin(r.startTime))/30*CELL_H;
      h+=`<div class="cal-block pending-block" style="top:${top}px;height:${height}px">`;
      h+=`<span class="cb-time">${r.startTime}–${r.endTime}</span>`;
      h+=`<span class="cb-label">${esc(r.firstName)} ${esc(r.lastName)}</span>`;
      h+=`</div>`;
    });
    h+='</div>';
  });
  h+='</div>';
  wrap.innerHTML=h;
  attachDrag();
}

// ---- Drag Selection ----
function attachDrag() {
  const wrapper=document.getElementById('calendarWrapper');
  const cells=wrapper.querySelectorAll('.cal-cell');

  cells.forEach(cell=>{
    cell.addEventListener('mousedown',e=>{
      e.preventDefault();
      isDragging=true;
      dragStart=cell; dragEnd=cell;
      dragCol=cell.closest('.cal-col');
      wrapper.classList.add('dragging');
      updateSel();
    });
    cell.addEventListener('mouseenter',()=>{
      if(isDragging && cell.closest('.cal-col')===dragCol){dragEnd=cell;updateSel();}
    });
  });

  const up=()=>{
    if(!isDragging)return;
    isDragging=false;
    wrapper.classList.remove('dragging');
    finalizeSel();
  };
  document.addEventListener('mouseup',up);
}

function updateSel() {
  document.querySelectorAll('.cal-cell.selecting').forEach(c=>c.classList.remove('selecting'));
  if(!dragCol)return;
  const cells=Array.from(dragCol.querySelectorAll('.cal-cell'));
  const si=cells.indexOf(dragStart), ei=cells.indexOf(dragEnd);
  const [a,b]=[Math.min(si,ei),Math.max(si,ei)];
  for(let i=a;i<=b;i++) cells[i].classList.add('selecting');
}

function finalizeSel() {
  const sel=dragCol?Array.from(dragCol.querySelectorAll('.cal-cell.selecting')):[];
  sel.forEach(c=>c.classList.remove('selecting'));
  if(!sel.length)return;
  const date=sel[0].dataset.date;
  const st=sel[0].dataset.time;
  const last=sel[sel.length-1].dataset.time;
  const en=toTime(toMin(last)+30);
  openBlockModal(date,st,en,sel.length>1);
}

// ---- Block Modal ----
function openBlockModal(date,start,end,fromDrag) {
  const [y,m,d]=date.split('-').map(Number);
  const dt=new Date(y,m-1,d);
  document.getElementById('bmDate').textContent=`${d} ${MONTHS[m-1]} ${y}, ${DAYS[dt.getDay()]}`;
  document.getElementById('bmTime').textContent=`${start} – ${end}`;
  document.getElementById('bmStart').value=start;
  document.getElementById('bmEnd').value=end;
  document.getElementById('bmLabel').value='';
  if(document.getElementById('bmCode')) document.getElementById('bmCode').value='';
  document.getElementById('blockForm').dataset.date=date;

  const dur=toMin(end)-toMin(start);
  document.querySelectorAll('.duration-chips .chip').forEach(c=>{
    c.classList.toggle('active',parseInt(c.dataset.dur)===dur);
  });

  document.getElementById('blockModal').classList.add('active');
  document.body.style.overflow='hidden';
  setTimeout(()=>document.getElementById('bmLabel').focus(),200);
}

function closeBlockModal(){document.getElementById('blockModal').classList.remove('active');document.body.style.overflow='';}

// ---- Recurring Modal ----
function openRecurringModal(){
  document.getElementById('rcStartDate').value=fmtDate(new Date());
  if(document.getElementById('rcLabel')) document.getElementById('rcLabel').value='';
  if(document.getElementById('rcCode')) document.getElementById('rcCode').value='';
  document.getElementById('recurringModal').classList.add('active');
  document.body.style.overflow='hidden';
}
function closeRecurringModal(){document.getElementById('recurringModal').classList.remove('active');document.body.style.overflow='';}

// ---- Monthly Render ----
function renderMonthly() {
  const wrap=document.getElementById('calendarWrapper');
  const y=currentDate.getFullYear(),mo=currentDate.getMonth();
  const first=new Date(y,mo,1), last=new Date(y,mo+1,0);
  let off=first.getDay()-1; if(off<0)off=6;
  const total=last.getDate(), cells=Math.ceil((off+total)/7)*7;
  const pendingReqs=requests.filter(r=>r.status==='pending');

  let h='<div class="month-header-row">';
  ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].forEach(n=>h+=`<div class="month-day-header">${n}</div>`);
  h+='</div><div class="calendar-monthly">';

  for(let i=0;i<cells;i++){
    const dn=i-off+1, dt=new Date(y,mo,dn);
    const cur=dn>=1&&dn<=total, sun=dt.getDay()===0;
    let cls='month-day'; if(!cur)cls+=' other-month'; if(sun)cls+=' sunday'; if(isToday(dt))cls+=' today';
    const ds=fmtDate(dt), dayBlks=blocks.filter(b=>b.date===ds);
    const dayPen=pendingReqs.filter(r=>r.date===ds);
    const sched=SCHEDULE[dt.getDay()];
    const click=cur&&!sun&&sched?`onclick="goWeek(new Date(${dt.getFullYear()},${dt.getMonth()},${dt.getDate()}))"`:''
    h+=`<div class="${cls}" ${click}><div class="day-num">${dt.getDate()}</div>`;
    if(cur&&sched){
      h+='<div class="slot-indicators">';
      if(dayBlks.length) h+=`<div class="slot-indicator has-closed">● ${dayBlks.length} blok</div>`;
      if(dayPen.length) h+=`<div class="slot-indicator has-pending">● ${dayPen.length} talep</div>`;
      h+='</div>';
    }
    h+='</div>';
  }
  h+='</div>';
  wrap.innerHTML=h;
}

function goWeek(d){currentDate=d;currentView='weekly';document.querySelectorAll('.view-toggle button').forEach(b=>b.classList.toggle('active',b.dataset.view==='weekly'));render();}

// ---- Requests ----
function renderRequests() {
  const c=document.getElementById('requestsList');
  if(!requests.length){c.innerHTML='<div class="empty-state"><div class="empty-icon">📭</div><p>Henüz ders talebi yok</p></div>';return;}
  const sorted=[...requests].sort((a,b)=>{if(a.status==='pending'&&b.status!=='pending')return -1;if(b.status==='pending'&&a.status!=='pending')return 1;return new Date(b.createdAt)-new Date(a.createdAt);});
  let h='';
  sorted.forEach(r=>{
    const [y,m,d]=r.date.split('-').map(Number);
    const dt=new Date(y,m-1,d);
    const dl=`${d} ${MONTHS[m-1]} ${y}, ${DAYS[dt.getDay()]}`;
    const tl=`${r.startTime} – ${r.endTime||'?'}`;
    const cd=new Date(r.createdAt);
    const cl=`${cd.getDate()} ${MONTHS[cd.getMonth()]} ${String(cd.getHours()).padStart(2,'0')}:${String(cd.getMinutes()).padStart(2,'0')}`;
    const sl={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi'};
    h+=`<div class="request-card"><div class="request-header"><div><div class="student-name">${esc(r.firstName)} ${esc(r.lastName)}</div><div class="request-time">Gönderim: ${cl}</div></div><span class="status-badge ${r.status}">${sl[r.status]}</span></div>`;
    h+=`<div class="request-details"><div class="detail-item"><span class="icon">📅</span><span>${dl}</span></div><div class="detail-item"><span class="icon">🕐</span><span>${tl}</span></div><div class="detail-item"><span class="icon">📞</span><span>${esc(r.phone)}</span></div></div>`;
    h+=`<div class="request-actions">${r.status==='pending'?`<button class="btn btn-success btn-sm" onclick="approveWithCode('${r.id}')">✓ Onayla</button><button class="btn btn-danger btn-sm" onclick="updateReqStatus('${r.id}','rejected')">✕ Reddet</button>`:''}<button class="btn btn-secondary btn-sm" onclick="deleteReq('${r.id}')">🗑 Sil</button></div></div>`;
  });
  c.innerHTML=h;
}

async function approveWithCode(id) {
  const code = prompt('Bu öğrenci için takvim etiketi / takip kodu belirlemek ister misiniz?\n(Örn: Z4 veya 115 - Öğrenci takviminde "Dolu [Z4]" olarak görünecektir. Boş bırakırsanız sadece "Dolu" yazar):');
  if (code === null) return; // User cancelled
  await updateReqStatus(id, 'approved', (code || '').trim().toUpperCase());
}

// ---- Toast ----
function toast(msg,type='info'){
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');t.className=`toast ${type}`;
  t.innerHTML=`<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||''}</span> ${msg}`;
  c.appendChild(t); setTimeout(()=>{t.classList.add('fade-out');setTimeout(()=>t.remove(),300);},3500);
}

function openPasswordModal() {
  document.getElementById('passwordModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePasswordModal() {
  document.getElementById('passwordModal').classList.remove('active');
  document.body.style.overflow = '';
}

// ---- Backup, Restore & Archive ----
async function exportFullBackup() {
  try {
    const res = await fetch(`${API}/api/admin/export-data`, {
      headers: { 'X-Admin-Password': adminPassword }
    });
    if (!res.ok) throw new Error('Yedek indirilemedi');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = fmtDate(new Date());
    a.download = `sibelkiral_takvim_tam_yedek_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast('Tüm takvim ve öğrenci verileri bilgisayarınıza indirildi ✓', 'success');
  } catch (err) {
    toast('Yedek indirme başarısız!', 'error');
  }
}

async function handleBackupImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!confirm(`"${file.name}" adlı yedek dosyası sisteme yüklenecektir. Mevcut verilerin anlık yedeği otomatik alınacaktır. Onaylıyor musunuz?`)) {
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      const res = await fetch(`${API}/api/admin/import-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': adminPassword
        },
        body: JSON.stringify(data)
      });
      const resData = await res.json();
      if (res.ok) {
        toast('Yedek başarıyla geri yüklendi ✓', 'success');
        await loadConfig();
        await loadBlocks();
        await loadRequests();
        render();
        stats();
        loadBackupPanel();
      } else {
        toast(resData.error || 'Geri yükleme başarısız!', 'error');
      }
    } catch (err) {
      toast('Geçersiz JSON dosyası formatı!', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

async function loadBackupPanel() {
  const c = document.getElementById('archiveList');
  if (!c) return;
  try {
    const [archRes, bkpRes, storageRes] = await Promise.all([
      fetch(`${API}/api/admin/archive`, { headers: { 'X-Admin-Password': adminPassword } }),
      fetch(`${API}/api/admin/backups-list`, { headers: { 'X-Admin-Password': adminPassword } }),
      fetch(`${API}/api/admin/storage-status`, { headers: { 'X-Admin-Password': adminPassword } })
    ]);
    const archiveData = archRes.ok ? await archRes.json() : { deletedBlocks: [] };
    const backupData = bkpRes.ok ? await bkpRes.json() : { backups: [] };
    const storageData = storageRes.ok ? await storageRes.json() : { isCloud: false, engine: 'Yerel Disk' };

    const snapCountEl = document.getElementById('backupSnapshotsCount');
    if (snapCountEl) snapCountEl.textContent = (backupData.backups || []).length;
    const archCountEl = document.getElementById('archivedBlocksCount');
    if (archCountEl) archCountEl.textContent = (archiveData.deletedBlocks || []).length;

    // Storage Status Card & Banner Updates
    const engineEl = document.getElementById('storageEngineStatus');
    const bannerEl = document.getElementById('cloudStorageBanner');
    const titleEl = document.getElementById('cloudStorageTitle');
    const descEl = document.getElementById('cloudStorageDesc');
    const iconEl = document.getElementById('cloudStorageIcon');
    const engineCard = document.getElementById('storageEngineCard');

    if (storageData.isCloud) {
      if (engineEl) engineEl.textContent = '☁️ Bulut Aktif';
      if (engineCard) { engineCard.className = 'stat-card green'; }
      if (titleEl) titleEl.textContent = '☁️ MongoDB Atlas Bulut Koruması Aktif (Veriler Asla Sıfırlanmaz)';
      if (iconEl) iconEl.textContent = '🛡️';
      if (descEl) descEl.innerHTML = 'Tüm verileriniz MongoDB Atlas bulutunda güvence altındadır. Render sunucusu uyusa, kapansa veya yeniden başlasa dahi <strong>hiçbir veriniz asla sıfırlanmaz veya silinmez</strong>.';
      if (bannerEl) bannerEl.style.borderColor = 'rgba(176, 197, 87, 0.5)';
    } else {
      if (engineEl) engineEl.textContent = '📁 Yerel Disk';
      if (engineCard) { engineCard.className = 'stat-card amber'; }
      if (titleEl) titleEl.textContent = '📁 Yerel Disk Modu (Bulut Koruması İçin MongoDB Bağlayın)';
      if (iconEl) iconEl.textContent = '💡';
      if (descEl) descEl.innerHTML = 'Veriler şu anda sunucunun yerel diskinde saklanıyor. Render platformundaki ücretsiz servislerin yeniden başlama durumunda sıfırlanmasını engellemek için ücretsiz <strong>MongoDB Atlas</strong> veritabanı bağlayabilirsiniz (Render panelinde Environment sekmesinden <code>MONGODB_URI</code> ekleyiniz). Ayrıca istediğiniz an yukarıdaki butondan tek tıkla tam yedek indirebilirsiniz.';
      if (bannerEl) bannerEl.style.borderColor = 'rgba(217, 119, 6, 0.4)';
    }

    const deletedBlocks = (archiveData.deletedBlocks || []).sort((a,b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));

    if (!deletedBlocks.length) {
      c.innerHTML = '<div class="empty-state"><div class="empty-icon">🗄️</div><p>Henüz silinmiş veya arşivlenmiş ders kaydı bulunmuyor. Takvimden silinen tüm dersler burada güvenle saklanır.</p></div>';
      return;
    }

    let h = '<div class="analytics-table"><table><thead><tr><th>Tarih</th><th>Saat</th><th>Öğrenci / Kod</th><th>Silinme Nedeni / Zamanı</th><th>İşlem</th></tr></thead><tbody>';
    deletedBlocks.forEach(b => {
      const archDate = b.archivedAt ? new Date(b.archivedAt).toLocaleString('tr-TR') : '—';
      const codeBadge = b.studentCode ? ` <small style="background:rgba(255,255,255,0.2);padding:1px 4px;border-radius:3px;">[${esc(b.studentCode)}]</small>` : '';
      h += `<tr>
        <td><strong>${esc(b.date)}</strong></td>
        <td>${esc(b.startTime)}–${esc(b.endTime)}</td>
        <td><strong>${esc(b.label || 'İsimsiz')}</strong>${codeBadge}</td>
        <td><small style="color:var(--text-muted);">${esc(b.archiveReason || 'Silindi')} (${archDate})</small></td>
        <td><button class="btn btn-primary btn-sm" onclick="restoreArchivedBlock('${b.id}')">🔄 Geri Yükle</button></td>
      </tr>`;
    });
    h += '</tbody></table></div>';
    c.innerHTML = h;
  } catch (err) {
    c.innerHTML = '<p style="color:var(--accent-red);">Arşiv yüklenirken hata oluştu.</p>';
  }
}

async function restoreArchivedBlock(id) {
  if (!confirm('Bu ders kaydını takvime geri yüklemek istediğinize emin misiniz?')) return;
  try {
    const res = await fetch(`${API}/api/admin/restore-block/${id}`, {
      method: 'POST',
      headers: { 'X-Admin-Password': adminPassword }
    });
    const d = await res.json();
    if (res.ok) {
      toast('Ders başarıyla takvime geri yüklendi ✓', 'success');
      await loadBlocks();
      render();
      stats();
      loadBackupPanel();
    } else {
      toast(d.error || 'Geri yükleme başarısız!', 'error');
    }
  } catch (err) {
    toast('Bağlantı hatası.', 'error');
  }
}

// ---- Students Directory (Öğrencilerim & Veli Rehberi) ----
function renderStudentsDirectory(filterQuery = '') {
  const container = document.getElementById('studentsDirectoryList');
  if (!container) return;

  let list = [...savedStudents];
  if (filterQuery) {
    const q = filterQuery.toLowerCase().trim();
    list = list.filter(s => 
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.code && s.code.toLowerCase().includes(q)) ||
      (s.parentName && s.parentName.toLowerCase().includes(q)) ||
      (s.phone && s.phone.includes(q)) ||
      (s.grade && s.grade.toLowerCase().includes(q))
    );
  }

  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>${filterQuery ? 'Aramanızla eşleşen öğrenci bulunamadı.' : 'Henüz kayıtlı öğrenci yok. "+ Yeni Öğrenci Ekle" butonuna basarak ilk öğrencinizi ekleyebilirsiniz.'}</p></div>`;
    return;
  }

  // Calculate lesson stats per student from blocks
  const studentStats = {};
  blocks.forEach(b => {
    const code = (b.studentCode || '').trim().toUpperCase();
    const name = (b.label || '').trim().toLowerCase();
    const dur = (toMin(b.endTime) - toMin(b.startTime)) / 60;
    if (code) {
      if (!studentStats[code]) studentStats[code] = { count: 0, hours: 0 };
      studentStats[code].count++;
      studentStats[code].hours += dur;
    }
    if (name) {
      if (!studentStats[name]) studentStats[name] = { count: 0, hours: 0 };
      studentStats[name].count++;
      studentStats[name].hours += dur;
    }
  });

  let h = `<div class="analytics-table"><table>
    <thead>
      <tr>
        <th>Kod / Etiket</th>
        <th>Öğrenci Adı Soyadı</th>
        <th>Sınıf / Düzey</th>
        <th>Veli İsim Soyisim</th>
        <th>Veli İletişim (Tel & WP)</th>
        <th>Toplam Ders</th>
        <th style="text-align:right;">İşlem</th>
      </tr>
    </thead>
    <tbody>`;

  list.forEach(s => {
    const stats = (s.code && studentStats[s.code.toUpperCase()]) || 
                  (s.name && studentStats[s.name.toLowerCase()]) || 
                  { count: 0, hours: 0 };
    
    const codeBadge = s.code ? `<span style="background:var(--accent-primary);color:#fff;padding:3px 8px;border-radius:6px;font-weight:800;font-size:0.82rem;">${esc(s.code)}</span>` : '<span style="color:var(--text-muted)">—</span>';
    
    const cleanPhone = (s.phone || '').replace(/\D/g, '');
    let phoneActions = '<span style="color:var(--text-muted)">—</span>';
    if (cleanPhone) {
      const waNumber = cleanPhone.startsWith('90') ? cleanPhone : (cleanPhone.startsWith('0') ? '9' + cleanPhone : '90' + cleanPhone);
      const displayPhone = formatPhoneTR(cleanPhone);
      phoneActions = `
        <div style="display:inline-flex;align-items:center;gap:8px;white-space:nowrap;">
          <span style="font-weight:700;font-size:0.86rem;letter-spacing:0.3px;">${esc(displayPhone)}</span>
          <div style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
            <a href="https://wa.me/${waNumber}" target="_blank" class="student-action-btn wa" title="WhatsApp Mesajı Gönder" style="padding:4px 8px;font-size:0.78rem;white-space:nowrap;">💬 WP</a>
            <a href="tel:${cleanPhone}" class="student-action-btn call" title="Telefonla Ara" style="padding:4px 8px;font-size:0.78rem;white-space:nowrap;">📞 Ara</a>
          </div>
        </div>
      `;
    }

    h += `<tr>
      <td>${codeBadge}</td>
      <td><strong>${esc(s.name || 'İsimsiz')}</strong></td>
      <td>${esc(s.grade || '—')}</td>
      <td>${esc(s.parentName || '—')}</td>
      <td>${phoneActions}</td>
      <td><strong>${Math.round(stats.hours * 10) / 10} saat</strong> <small style="color:var(--text-muted)">(${stats.count} ders)</small></td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="student-action-btn analysis" onclick="openStudentAnalysisModal('${esc(s.code || s.name)}')">📊 Analiz</button>
        <button class="student-action-btn edit" onclick="openEditStudentModal('${s.id}')">✏️ Düzenle</button>
        <button class="student-action-btn delete" onclick="deleteStudent('${s.id}')">🗑️ Sil</button>
      </td>
    </tr>`;
  });

  h += '</tbody></table></div>';
  container.innerHTML = h;
}

function openAddStudentModal() {
  document.getElementById('studentModalTitle').textContent = '➕ Yeni Öğrenci Ekle';
  document.getElementById('stEditId').value = '';
  document.getElementById('studentForm').reset();
  document.getElementById('studentModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function openEditStudentModal(id) {
  const student = savedStudents.find(s => s.id === id);
  if (!student) return;
  document.getElementById('studentModalTitle').textContent = '✏️ Öğrenci Bilgilerini Düzenle';
  document.getElementById('stEditId').value = student.id;
  document.getElementById('stName').value = student.name || '';
  document.getElementById('stCode').value = student.code || '';
  document.getElementById('stGrade').value = student.grade !== '—' ? (student.grade || '') : '';
  document.getElementById('stParentName').value = student.parentName !== '—' ? (student.parentName || '') : '';
  document.getElementById('stPhone').value = student.phone || '';
  document.getElementById('stNotes').value = student.notes || '';
  document.getElementById('studentModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeStudentModal() {
  document.getElementById('studentModal').classList.remove('active');
  document.body.style.overflow = '';
}

async function handleStudentFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('stEditId').value;
  const name = document.getElementById('stName').value.trim();
  const code = document.getElementById('stCode').value.trim().toUpperCase();
  const grade = document.getElementById('stGrade').value.trim();
  const parentName = document.getElementById('stParentName').value.trim();
  const phone = document.getElementById('stPhone').value.trim().replace(/\D/g, '');
  const notes = document.getElementById('stNotes').value.trim();

  if (!name || !code) {
    toast('Öğrenci adı ve takip kodu zorunludur!', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/admin/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Password': adminPassword
      },
      body: JSON.stringify({ id, name, code, grade, parentName, phone, notes })
    });
    const d = await res.json();
    if (res.ok) {
      toast(id ? 'Öğrenci güncellendi ✓' : 'Yeni öğrenci eklendi ✓', 'success');
      closeStudentModal();
      savedStudents = d.students || [];
      updateStudentDatalists();
      renderStudentsDirectory();
    } else {
      toast(d.error || 'Hata oluştu', 'error');
    }
  } catch (err) {
    toast('Bağlantı hatası', 'error');
  }
}

async function deleteStudent(id) {
  const student = savedStudents.find(s => s.id === id);
  const name = student ? student.name : 'Bu öğrenci';
  if (!confirm(`"${name}" adlı öğrenciyi rehberden silmek istediğinize emin misiniz? (Geçmiş takvim dersleri silinmez)`)) return;

  try {
    const res = await fetch(`${API}/api/admin/students/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Password': adminPassword }
    });
    const d = await res.json();
    if (res.ok) {
      toast('Öğrenci silindi', 'info');
      savedStudents = d.students || [];
      updateStudentDatalists();
      renderStudentsDirectory();
    } else {
      toast(d.error || 'Silinemedi', 'error');
    }
  } catch (err) {
    toast('Bağlantı hatası', 'error');
  }
}

// ---- Student-Specific Detailed Analysis ----
function renderQuickStudentChips() {
  const container = document.getElementById('quickStudentChips');
  if (!container) return;
  const codes = new Set();
  savedStudents.forEach(s => { if (s.code) codes.add(s.code.toUpperCase()); });
  blocks.forEach(b => { if (b.studentCode) codes.add(b.studentCode.toUpperCase()); });

  if (!codes.size) {
    container.innerHTML = '';
    return;
  }

  let h = '<span style="font-size:0.8rem;color:var(--text-muted);font-weight:600;margin-right:4px;">Hızlı Analiz:</span>';
  Array.from(codes).sort().forEach(code => {
    h += `<button type="button" class="student-action-btn analysis" onclick="openStudentAnalysisModal('${esc(code)}')" style="font-size:0.78rem;padding:3px 9px;cursor:pointer;">${esc(code)}</button>`;
  });
  container.innerHTML = h;
}

function generateWhatsAppReportText(data) {
  const student = data.student || {};
  const studentName = student.name || 'Öğrencimiz';
  const studentCode = student.code ? `[${student.code}]` : '';
  const parentName = (student.parentName && student.parentName !== '—') ? `Sayın ${student.parentName}` : 'Değerli Velimiz';

  const thisMonthHours = data.thisMonth?.hours || 0;
  const thisMonthCount = data.thisMonth?.count || 0;
  const totalHours = data.total?.hours || 0;
  const totalCount = data.total?.count || 0;

  let nextLessonStr = 'Planlanmış ders bulunmuyor';
  if (data.upcomingLessons && data.upcomingLessons.length) {
    const next = data.upcomingLessons[0];
    const [y, m, d] = next.date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    nextLessonStr = `${d} ${MONTHS[m - 1]} ${DAYS[dt.getDay()]} (${next.startTime} - ${next.endTime})`;
  }

  return `Merhaba ${parentName},\n\n` +
    `Sibel Hoca Özel Ders Bilgilendirmesi 📚\n` +
    `Öğrenci: ${studentName} ${studentCode}\n\n` +
    `📊 Bu Ayki Dersler: ${thisMonthCount} ders (${thisMonthHours} saat)\n` +
    `🎯 Genel Toplam: ${totalCount} ders (${totalHours} saat)\n` +
    `🗓️ Sıradaki Ders: ${nextLessonStr}\n\n` +
    `İyi günler, başarılar dileriz.`;
}

async function openStudentAnalysisModal(query) {
  if (!query) return;
  const modal = document.getElementById('studentAnalysisModal');
  const loading = document.getElementById('samLoading');
  const body = document.getElementById('samBody');
  if (!modal) return;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  if (loading) loading.style.display = 'block';
  if (body) body.style.display = 'none';

  // Pre-fill search input
  const searchInput = document.getElementById('studentAnalysisInput');
  if (searchInput) searchInput.value = query;

  try {
    const res = await fetch(`${API}/api/admin/student-analysis/${encodeURIComponent(query.trim())}`, {
      headers: { 'X-Admin-Password': adminPassword }
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Öğrenci analizi getirilemedi', 'error');
      closeStudentAnalysisModal();
      return;
    }

    const st = data.student || {};
    const nameEl = document.getElementById('samStudentName');
    if (nameEl) nameEl.textContent = st.name || query;

    const codeEl = document.getElementById('samStudentCode');
    if (codeEl) {
      if (st.code) {
        codeEl.textContent = `Kod: ${st.code}`;
        codeEl.style.display = 'inline-block';
      } else {
        codeEl.style.display = 'none';
      }
    }

    const gradeEl = document.getElementById('samStudentGrade');
    if (gradeEl) {
      if (st.grade && st.grade !== '—') {
        gradeEl.textContent = st.grade;
        gradeEl.style.display = 'inline-block';
      } else {
        gradeEl.style.display = 'none';
      }
    }

    const metaEl = document.getElementById('samStudentMeta');
    if (metaEl) {
      metaEl.textContent = `Toplam ${data.total.count} ders kaydı eşleşti • Son kontrol: ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Parent information & Actions
    const parentInfoEl = document.getElementById('samParentInfo');
    const parentActionsEl = document.getElementById('samParentActions');
    const parentNameStr = (st.parentName && st.parentName !== '—') ? st.parentName : '';
    const cleanPhone = (st.phone || '').replace(/\D/g, '');

    if (parentInfoEl) {
      if (parentNameStr && cleanPhone) {
        parentInfoEl.innerHTML = `<strong>${esc(parentNameStr)}</strong> • 0${cleanPhone.slice(-10)}`;
      } else if (parentNameStr) {
        parentInfoEl.innerHTML = `<strong>${esc(parentNameStr)}</strong>`;
      } else if (cleanPhone) {
        parentInfoEl.innerHTML = `Veli Tel: <strong>0${cleanPhone.slice(-10)}</strong>`;
      } else {
        parentInfoEl.innerHTML = `<span style="color:var(--text-muted)">Veli bilgisi henüz girilmemiş</span>`;
      }
    }

    // Prepare WhatsApp Message text
    const waText = generateWhatsAppReportText(data);
    let actionButtonsHtml = '';

    if (cleanPhone) {
      const waNumber = cleanPhone.startsWith('90') ? cleanPhone : (cleanPhone.startsWith('0') ? '9' + cleanPhone : '90' + cleanPhone);
      actionButtonsHtml += `<a href="https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}" target="_blank" class="student-action-btn wa" title="Veliye WhatsApp Ders Raporu Gönder">💬 Veliye WhatsApp Raporu</a>`;
      actionButtonsHtml += `<a href="tel:${cleanPhone}" class="student-action-btn call" title="Telefonla Ara">📞 Ara</a>`;
    }

    actionButtonsHtml += `<button type="button" class="student-action-btn copy" id="samCopyReportBtn" title="Rapor metnini panoya kopyala">📋 Raporu Kopyala</button>`;
    if (parentActionsEl) parentActionsEl.innerHTML = actionButtonsHtml;

    const copyBtn = document.getElementById('samCopyReportBtn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(waText).then(() => {
            toast('Rapor metni panoya kopyalandı ✓', 'success');
          }).catch(() => {
            prompt('Rapor Metni (Ctrl+C ile kopyalayabilirsiniz):', waText);
          });
        } else {
          prompt('Rapor Metni (Ctrl+C ile kopyalayabilirsiniz):', waText);
        }
      };
    }

    // Stat Cards
    const totalHoursEl = document.getElementById('samTotalHours');
    if (totalHoursEl) totalHoursEl.textContent = `${data.total.hours} sa`;

    const totalCountEl = document.getElementById('samTotalCount');
    if (totalCountEl) totalCountEl.textContent = `${data.total.count} ders`;

    const thisMonthEl = document.getElementById('samThisMonth');
    if (thisMonthEl) thisMonthEl.textContent = `${data.thisMonth.hours} sa (${data.thisMonth.count} ders)`;

    const upCountEl = document.getElementById('samUpcomingCount');
    if (upCountEl) upCountEl.textContent = `${data.upcomingLessons.length} ders`;

    // Monthly Distribution Table
    const monthlyContainer = document.getElementById('samMonthlyTable');
    if (monthlyContainer) {
      const months = Object.entries(data.monthly || {}).sort((a, b) => b[0].localeCompare(a[0]));
      if (months.length) {
        let mh = '<table><thead><tr><th>Dönem / Ay</th><th>Ders Sayısı</th><th>Toplam Saat</th><th>Açıklama</th></tr></thead><tbody>';
        months.forEach(([ym, val]) => {
          const [y, m] = ym.split('-');
          const isCurrent = ym === data.thisMonth.yearMonth;
          mh += `<tr style="${isCurrent ? 'background: rgba(93, 138, 78, 0.08); font-weight: 600;' : ''}">
            <td><strong>${MONTHS[parseInt(m) - 1]} ${y}</strong>${isCurrent ? ' <small style="color:var(--accent-primary);font-weight:700;">(Bu Ay)</small>' : ''}</td>
            <td>${val.count} ders</td>
            <td><strong>${Math.round(val.hours * 10) / 10} saat</strong></td>
            <td><small style="color:var(--text-muted)">Tamamlanan & planlanan</small></td>
          </tr>`;
        });
        mh += '</tbody></table>';
        monthlyContainer.innerHTML = mh;
      } else {
        monthlyContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px 0;">Bu öğrenciye ait kayıtlı ay bulunmuyor.</p>';
      }
    }

    // Upcoming Lessons
    const upContainer = document.getElementById('samUpcomingList');
    const upBadge = document.getElementById('samUpcomingBadge');
    if (upBadge) upBadge.textContent = `${data.upcomingLessons.length} planlı ders`;
    if (upContainer) {
      if (data.upcomingLessons && data.upcomingLessons.length) {
        let uh = '<div class="analytics-table" style="margin-bottom:0;"><table><thead><tr><th>Tarih</th><th>Saat</th><th>Süre</th><th>Etiket / Durum</th></tr></thead><tbody>';
        data.upcomingLessons.forEach(l => {
          const [y, m, d] = l.date.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          const durHours = Math.round((l.durationMinutes / 60) * 10) / 10;
          uh += `<tr>
            <td><strong>${d} ${MONTHS[m - 1]} ${y}</strong> <small style="color:var(--text-muted)">(${DAYS[dt.getDay()]})</small></td>
            <td><strong>${l.startTime} – ${l.endTime}</strong></td>
            <td>${durHours} saat (${l.durationMinutes} dk)</td>
            <td><span class="status-badge approved">Planlandı</span></td>
          </tr>`;
        });
        uh += '</tbody></table></div>';
        upContainer.innerHTML = uh;
      } else {
        upContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;background:var(--bg-glass);padding:12px 14px;border-radius:var(--radius-sm);border:1px dashed var(--border-glass);">Yaklaşan planlanmış ders bulunmuyor.</p>';
      }
    }

    // Past Lessons History
    const pastContainer = document.getElementById('samPastList');
    const pastBadge = document.getElementById('samPastBadge');
    if (pastBadge) pastBadge.textContent = `${data.pastLessons.length} tamamlanan ders`;
    if (pastContainer) {
      if (data.pastLessons && data.pastLessons.length) {
        let ph = '<div class="analytics-table" style="margin-bottom:0; max-height:260px; overflow-y:auto;"><table><thead><tr><th>Tarih</th><th>Saat</th><th>Süre</th><th>Etiket</th></tr></thead><tbody>';
        data.pastLessons.forEach(l => {
          const [y, m, d] = l.date.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          const durHours = Math.round((l.durationMinutes / 60) * 10) / 10;
          ph += `<tr>
            <td><strong>${d} ${MONTHS[m - 1]} ${y}</strong> <small style="color:var(--text-muted)">(${DAYS[dt.getDay()]})</small></td>
            <td>${l.startTime} – ${l.endTime}</td>
            <td>${durHours} saat</td>
            <td><small style="background:var(--bg-glass);padding:2px 6px;border-radius:4px;border:1px solid var(--border-glass);">${esc(l.studentCode || l.label || 'Ders')}</small></td>
          </tr>`;
        });
        ph += '</tbody></table></div>';
        pastContainer.innerHTML = ph;
      } else {
        pastContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;background:var(--bg-glass);padding:12px 14px;border-radius:var(--radius-sm);border:1px dashed var(--border-glass);">Henüz tamamlanmış geçmiş ders kaydı bulunmuyor.</p>';
      }
    }

    if (loading) loading.style.display = 'none';
    if (body) body.style.display = 'block';

  } catch (err) {
    toast('Öğrenci analiz verisi yüklenirken hata oluştu', 'error');
    closeStudentAnalysisModal();
  }
}

function closeStudentAnalysisModal() {
  const modal = document.getElementById('studentAnalysisModal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
}

// Globals
window.deleteBlock=deleteBlock; window.updateReqStatus=updateReqStatus; window.deleteReq=deleteReq;
window.restoreArchivedBlock=restoreArchivedBlock;
window.goWeek=goWeek; window.closeBlockModal=closeBlockModal; window.closeRecurringModal=closeRecurringModal;
window.deleteRecurringGroup=deleteRecurringGroup; window.resetAllRecurringGroups=resetAllRecurringGroups;
window.openPasswordModal=openPasswordModal; window.closePasswordModal=closePasswordModal;
window.approveWithCode=approveWithCode;
window.openAddStudentModal=openAddStudentModal; window.openEditStudentModal=openEditStudentModal;
window.closeStudentModal=closeStudentModal; window.deleteStudent=deleteStudent;
window.openStudentAnalysisModal=openStudentAnalysisModal; window.closeStudentAnalysisModal=closeStudentAnalysisModal;


