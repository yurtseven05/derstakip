// ============================================
//  sy — ADMIN PANEL
// ============================================
const API = '';
let adminPassword = '', currentView = 'weekly', currentDate = new Date();
let blocks = [], requests = [], SCHEDULE = {}, defaultDuration = 90;

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
  const slots=[];
  for (let m=480; m<1380; m+=30) slots.push(toTime(m)); // 08:00 to 23:00
  return slots;
}

function isOff(time, dow) {
  const s=SCHEDULE[dow]; if(!s) return true;
  const m=toMin(time); return m<toMin(s.start)||m>=toMin(s.end);
}

function fmtDateTR(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m-1]} ${y}`;
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
  await loadConfig(); await loadBlocks(); await loadRequests();
  setupListeners(); render(); stats();
  setInterval(async()=>{await loadBlocks();await loadRequests();render();stats();},15000);
}

// ---- API ----
async function loadConfig() {
  try { const r=await fetch(`${API}/api/config/schedule`); const d=await r.json(); SCHEDULE=d.schedule; defaultDuration=d.defaultDuration||90; } catch(e) {}
}
async function loadBlocks() {
  try { const r=await fetch(`${API}/api/blocks`); const d=await r.json(); blocks=d.blocks||[]; } catch(e) {}
}
async function loadRequests() {
  try { const r=await fetch(`${API}/api/requests`,{headers:{'X-Admin-Password':adminPassword}}); const d=await r.json(); requests=d.requests||[]; renderRequests(); } catch(e) {}
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

  const students = Object.entries(data.students).sort((a,b)=>b[1].hours-a[1].hours);
  h+=`<h3 style="margin:24px 0 12px;font-size:1.1rem;">👤 Öğrenci & Takip Kodları</h3>`;
  if(students.length){
    h+='<div class="analytics-table"><table><thead><tr><th>Öğrenci / Etiket</th><th>Takip Kodu</th><th>Ders Sayısı</th><th>Toplam Saat</th></tr></thead><tbody>';
    students.forEach(([name, val])=>{
      const codeBadge = val.studentCode ? `<span style="background:var(--accent-primary);color:#fff;padding:2px 8px;border-radius:6px;font-weight:700;font-size:0.8rem;">${esc(val.studentCode)}</span>` : '<span style="color:var(--text-muted)">—</span>';
      h+=`<tr><td><strong>${esc(name)}</strong></td><td>${codeBadge}</td><td>${val.count} ders</td><td>${Math.round(val.hours*10)/10} saat</td></tr>`;
    });
    h+='</tbody></table></div>';
  } else h+='<p style="color:var(--text-muted);font-size:0.85rem;">Etiketli ders bloğu yok.</p>';

  if(data.studentCodes && data.studentCodes.length) {
    h+=`<h3 style="margin:24px 0 12px;font-size:1.1rem;">🔑 Tanımlı Veli / Öğrenci Kodları Özeti</h3>`;
    h+='<div class="analytics-table"><table><thead><tr><th>Öğrenci Kodu</th><th>Eşleşen Öğrenci</th><th>Toplam Ders</th><th>Toplam Saat</th></tr></thead><tbody>';
    data.studentCodes.forEach(sc => {
      h+=`<tr><td><strong style="color:var(--accent-primary);font-size:1rem;">${esc(sc.code)}</strong></td><td>${esc(sc.studentName || '—')}</td><td>${sc.count} ders</td><td>${Math.round(sc.hours*10)/10} saat</td></tr>`;
    });
    h+='</tbody></table></div>';
  }

  c.innerHTML=h;
}

// ---- Events ----
function setupListeners() {
  // Tab navigation
  document.querySelectorAll('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById(tab.dataset.panel).classList.add('active');
    if(tab.dataset.panel==='analyticsPanel') loadAnalytics();
    if(tab.dataset.panel==='recurringPanel') loadRecurringGroups();
  }));

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
  const code = prompt('Bu öğrenci için veli/öğrenci takip kodu belirlemek ister misiniz? (Örn: Z4 veya 115 - Boş bırakabilirsiniz):');
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

// Globals
window.deleteBlock=deleteBlock; window.updateReqStatus=updateReqStatus; window.deleteReq=deleteReq;
window.goWeek=goWeek; window.closeBlockModal=closeBlockModal; window.closeRecurringModal=closeRecurringModal;
window.deleteRecurringGroup=deleteRecurringGroup; window.resetAllRecurringGroups=resetAllRecurringGroups;
window.openPasswordModal=openPasswordModal; window.closePasswordModal=closePasswordModal;
window.approveWithCode=approveWithCode;
