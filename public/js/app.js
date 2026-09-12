// ============================================
//  OZEL DERS TAKVIMI - STUDENT APP (ENTERPRISE)
// ============================================
const API = '';
let currentView = 'weekly', currentDate = new Date();
let blocks = [], pendingRequests = [], SCHEDULE = {}, defaultDuration = 60;
let isDragging = false, dragStart = null, dragEnd = null, dragCol = null;

const CELL_H = 32;
const DAYS = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
const DAYS_S = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function toMin(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
function toTime(m){return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');}
function fmtDate(d){return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');}
function isToday(d){const t=new Date();return d.getDate()===t.getDate()&&d.getMonth()===t.getMonth()&&d.getFullYear()===t.getFullYear();}
function weekStart(d){const x=new Date(d);const day=x.getDay();x.setDate(x.getDate()-day+(day===0?-6:1));return x;}

function esc(str){
  if(!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function getAllSlots(){
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

function isOff(time,dow){
  if(time === '22:00') return true;
  const s=SCHEDULE[dow];
  if(!s)return true;
  const m=toMin(time);
  return m<toMin(s.start)||m>=toMin(s.end);
}

function isCovered(date,time){
  const m=toMin(time);
  return blocks.some(b=>b.date===date&&toMin(b.startTime)<=m&&toMin(b.endTime)>m);
}

function isPending(date,time){
  const m=toMin(time);
  return pendingRequests.some(r=>r.date===date&&toMin(r.startTime)<=m&&toMin(r.endTime)>m);
}

document.addEventListener('DOMContentLoaded',async()=>{
  await loadConfig();
  await loadBlocks();
  await loadPending();
  setupListeners();
  setupFAQ();
  setupCookieBanner();
  setupStudentStatsForm();
  render();
  setInterval(async()=>{
    await loadBlocks();
    await loadPending();
    render();
  },15000);
});

async function loadConfig(){
  try{
    const r=await fetch(API + '/api/config/schedule');
    if(r.ok){
      const d=await r.json();
      SCHEDULE=d.schedule || {};
      defaultDuration=d.defaultDuration||60;
    }
  }catch(e){}
}

async function loadBlocks(){
  try{
    const r=await fetch(API + '/api/blocks');
    if(r.ok){
      const d=await r.json();
      blocks=d.blocks||[];
    }
  }catch(e){}
}

async function loadPending(){
  try{
    const r=await fetch(API + '/api/requests/pending');
    if(r.ok){
      const d=await r.json();
      pendingRequests=d.requests||[];
    }
  }catch(e){}
}

async function submitRequest(data){
  try{
    const r=await fetch(API + '/api/requests',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    const d=await r.json();
    if(r.ok){
      const reqId = d.request?.id || '';
      toast('Ders talebiniz iletildi! Talep Numaranız: ' + reqId + ' (Kaydedin)', 'success');
      await loadPending();
      render();
      return true;
    } else {
      toast(d.error||'Talep iletilirken hata oluştu.','error');
      return false;
    }
  } catch(e){
    toast('Bağlantı hatası. Lütfen tekrar deneyin.','error');
    return false;
  }
}

async function submitCancelRequest(requestId, phone){
  try {
    const r = await fetch(API + '/api/requests/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, phone })
    });
    const d = await r.json();
    if (r.ok) {
      toast(d.message || 'Talebiniz ve verileriniz silindi.', 'success');
      await loadPending();
      render();
      return true;
    } else {
      toast(d.error || 'İptal işlemi başarısız oldu.', 'error');
      return false;
    }
  } catch (e) {
    toast('Bağlantı hatası.', 'error');
    return false;
  }
}

function setupListeners(){
  document.querySelectorAll('.view-toggle button').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.view-toggle button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    currentView=b.dataset.view;
    render();
  }));

  document.getElementById('prevBtn').addEventListener('click',()=>nav(-1));
  document.getElementById('nextBtn').addEventListener('click',()=>nav(1));
  document.getElementById('todayBtn').addEventListener('click',()=>{currentDate=new Date();render();});

  document.getElementById('modalClose').addEventListener('click',closeModal);
  document.getElementById('requestModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});

  const lm = document.getElementById('legalModal');
  if(lm) lm.addEventListener('click',e=>{if(e.target===e.currentTarget)closeLegalModal();});

  const cm = document.getElementById('cancelRequestModal');
  if(cm) cm.addEventListener('click',e=>{if(e.target===e.currentTarget)closeCancelModal();});

  const phoneInput = document.getElementById('phone');
  if(phoneInput) setupPhoneMask(phoneInput);

  const cancelPhoneInput = document.getElementById('cancelPhone');
  if(cancelPhoneInput) setupPhoneMask(cancelPhoneInput);

  // Student Duration Chips
  document.querySelectorAll('#studentDurationChips .chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('#studentDurationChips .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      const dur = parseInt(c.dataset.dur, 10);
      const f = document.getElementById('requestForm');
      const start = f.dataset.start;
      if (start) {
        const end = toTime(toMin(start) + dur);
        f.dataset.end = end;
        document.getElementById('modalTime').textContent = `${start} – ${end} (${dur} dk)`;
      }
    });
  });

  document.getElementById('requestForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const phone = document.getElementById('phone').value.replace(/\D/g, '');
    const kvkk = document.getElementById('kvkkConsent');

    if (phone.length !== 10 || phone[0] !== '5') {
      toast('Telefon numarası 5 ile başlamalı ve 10 haneli olmalıdır (5XX XXX XX XX)','error');
      return;
    }

    if (!kvkk || !kvkk.checked) {
      toast('Lütfen KVKK ve Gizlilik onay kutusunu işaretleyiniz.','error');
      return;
    }

    const f = e.target;
    const ok = await submitRequest({
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      phone: phone,
      date: f.dataset.date,
      startTime: f.dataset.start,
      endTime: f.dataset.end
    });

    if(ok){
      closeModal();
      f.reset();
    }
  });

  const cancelForm = document.getElementById('cancelRequestForm');
  if(cancelForm) {
    cancelForm.addEventListener('submit', async e => {
      e.preventDefault();
      const reqId = document.getElementById('cancelRequestId').value.trim();
      const phone = document.getElementById('cancelPhone').value.replace(/\D/g, '');

      if (!reqId || phone.length !== 10) {
        toast('Lütfen geçerli Talep Numarası ve 10 haneli telefon numarası giriniz.', 'error');
        return;
      }

      const ok = await submitCancelRequest(reqId, phone);
      if (ok) {
        closeCancelModal();
        cancelForm.reset();
      }
    });
  }

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      closeModal();
      closeLegalModal();
      closeCancelModal();
    }
    if(e.key==='ArrowLeft') nav(-1);
    if(e.key==='ArrowRight') nav(1);
  });
}

function setupPhoneMask(inputEl) {
  inputEl.addEventListener('input', function() {
    let v = this.value.replace(/\D/g, '');
    if (v.length > 0 && v[0] !== '5') v = '5' + v.substring(1);
    if (v.length > 10) v = v.substring(0, 10);
    let formatted = '';
    if (v.length > 0) formatted += v.substring(0, 3);
    if (v.length > 3) formatted += ' ' + v.substring(3, 6);
    if (v.length > 6) formatted += ' ' + v.substring(6, 8);
    if (v.length > 8) formatted += ' ' + v.substring(8, 10);
    this.value = formatted;
  });
}

function nav(dir){
  if(currentView==='weekly'){
    const d=new Date(currentDate);
    d.setDate(d.getDate()+dir*7);
    currentDate=d;
  } else {
    const d=new Date(currentDate);
    d.setMonth(d.getMonth()+dir);
    currentDate=d;
  }
  render();
}

function render(){
  updatePeriod();
  currentView==='weekly' ? renderWeekly() : renderMonthly();
}

function updatePeriod(){
  const el=document.getElementById('currentPeriod');
  if(!el) return;
  if(currentView==='weekly'){
    const ws=weekStart(new Date(currentDate)),we=new Date(ws);we.setDate(we.getDate()+6);
    el.textContent=ws.getMonth()===we.getMonth()?(ws.getDate() + ' – ' + we.getDate() + ' ' + MONTHS[ws.getMonth()] + ' ' + ws.getFullYear()):(ws.getDate() + ' ' + MONTHS[ws.getMonth()] + ' – ' + we.getDate() + ' ' + MONTHS[we.getMonth()] + ' ' + we.getFullYear());
  } else {
    el.textContent=MONTHS[currentDate.getMonth()] + ' ' + currentDate.getFullYear();
  }
}

const STUDENT_COLOR_COUNT = 10;
function buildLabelColorMap() {
  const map = {};
  let idx = 0;
  blocks.forEach(b => {
    const key = (b.studentCode || '').trim().toLowerCase();
    if (key && !(key in map)) {
      map[key] = idx % STUDENT_COLOR_COUNT;
      idx++;
    }
  });
  return map;
}

function renderWeekly(){
  const wrap=document.getElementById('calendarWrapper');
  if(!wrap) return;
  const ws=weekStart(new Date(currentDate));
  const days=[];for(let i=0;i<7;i++){const d=new Date(ws);d.setDate(d.getDate()+i);days.push(d);}
  const slots=getAllSlots();if(!slots.length){wrap.innerHTML='';return;}
  const labelColors = buildLabelColorMap();

  let h='<div class="cal-header"><div class="cal-corner">Saat</div>';
  days.forEach(d=>{
    const sun=d.getDay()===0,td=isToday(d);
    h+='<div class="cal-day-hdr' + (td?' today':'') + (sun?' sunday':'') + '"><span class="dn">' + DAYS_S[d.getDay()] + '</span><span class="dnum">' + d.getDate() + '</span></div>';
  });
  h+='</div><div class="cal-body"><div class="cal-gutter">';
  slots.forEach(s=>h+='<div class="cal-time" style="height:' + CELL_H + 'px">' + s + '</div>');
  h+='</div>';

  const fs=slots[0];
  const weekdayOffEnd = '17:00';
  if (toMin(weekdayOffEnd) > toMin(fs)) {
    const top = 0;
    const height = (toMin(weekdayOffEnd) - toMin(fs)) / 30 * CELL_H;
    h += '<div class="cal-weekday-banner" style="top:' + top + 'px;height:' + height + 'px;">';
    h += '<span class="cb-time">' + fs + ' – ' + weekdayOffEnd + '</span>';
    h += '<span class="cb-label">Haftaiçi 17:00\'ye Kadar Müsait Değil</span>';
    h += '<span class="cb-sub">(Dersler 17:00\'de başlamaktadır)</span>';
    h += '</div>';
  }

  days.forEach(d=>{
    const ds=fmtDate(d),dow=d.getDay();
    const isWeekday = (dow >= 1 && dow <= 5);
    h+='<div class="cal-col" data-date="' + ds + '">';
    slots.forEach(s=>{
      const off=isOff(s,dow), cov=isCovered(ds,s), pen=isPending(ds,s);
      if(s==='22:00') {
        h+='<div class="cal-cell off cal-cell-22" style="height:' + CELL_H + 'px" aria-hidden="true"></div>';
      } else if(off) {
        h+='<div class="cal-cell off" style="height:' + CELL_H + 'px" aria-hidden="true"></div>';
      } else if(cov) {
        h+='<div class="cal-cell" style="height:' + CELL_H + 'px" aria-hidden="true"></div>';
      } else if(pen) {
        h+='<div class="cal-cell pending-cell" style="height:' + CELL_H + 'px" title="Onay Bekleyen Talep"></div>';
      } else {
        h+='<div class="cal-cell avail" data-date="' + ds + '" data-time="' + s + '" style="height:' + CELL_H + 'px" role="button" aria-label="' + ds + ' ' + s + ' için randevu al"><span class="cell-lbl">Müsait</span></div>';
      }
    });

    // Contiguous Off-Hours Blocks (for weekend or after-hours)
    // Weekday 09:00-17:00 is covered by the unified banner above
    const offRanges = [];
    let curOffStart = null;
    let prevOffSlot = null;

    slots.forEach(s => {
      const off = isOff(s, dow);
      if (isWeekday && toMin(s) < toMin(weekdayOffEnd)) return;

      if (off) {
        if (!curOffStart) curOffStart = s;
        prevOffSlot = s;
      } else {
        if (curOffStart && prevOffSlot) {
          offRanges.push({ start: curOffStart, end: toTime(toMin(prevOffSlot) + 30) });
          curOffStart = null;
          prevOffSlot = null;
        }
      }
    });
    if (curOffStart && prevOffSlot) {
      offRanges.push({ start: curOffStart, end: toTime(toMin(prevOffSlot) + 30) });
    }

    offRanges.forEach(rng => {
      const sMin = toMin(rng.start);
      const eMin = toMin(rng.end);
      const top = (sMin - toMin(fs)) / 30 * CELL_H;
      const height = (eMin - sMin) / 30 * CELL_H;
      const dur = eMin - sMin;
      const labelText = 'Müsait Değil';

      if (dur <= 30) {
        h += '<div class="cal-block off-block compact" style="top:' + top + 'px;height:' + height + 'px">';
        h += '<span class="cb-label" style="font-size:0.68rem;opacity:0.85;">' + labelText + '</span>';
        h += '</div>';
      } else {
        h += '<div class="cal-block off-block" style="top:' + top + 'px;height:' + height + 'px">';
        h += '<span class="cb-time">' + rng.start + '–' + rng.end + '</span>';
        h += '<span class="cb-label">' + labelText + '</span>';
        h += '</div>';
      }
    });

    const dayBlks=blocks.filter(b=>b.date===ds).sort((a,b)=>toMin(a.startTime)-toMin(b.startTime));
    dayBlks.forEach(b=>{
      const top=(toMin(b.startTime)-toMin(fs))/30*CELL_H;
      const height=(toMin(b.endTime)-toMin(b.startTime))/30*CELL_H;
      const tag = (b.studentCode || '').trim();
      const ci = tag && tag.toLowerCase() in labelColors ? labelColors[tag.toLowerCase()] : '';
      h+='<div class="cal-block closed-block" style="top:' + top + 'px;height:' + height + 'px"' + (ci!==''?' data-color-index="'+ci+'"':'') + '>';
      h+='<span class="cb-time">' + esc(b.startTime) + '–' + esc(b.endTime) + '</span>';
      const badge = tag ? ' <span class="cb-badge" style="background:rgba(255,255,255,0.22);padding:1px 5px;border-radius:3px;font-weight:700;font-size:0.75rem;">[' + esc(tag) + ']</span>' : '';
      h+='<span class="cb-label">Dolu' + badge + '</span>';
      h+='</div>';
    });

    const dayPen=pendingRequests.filter(r=>r.date===ds).sort((a,b)=>toMin(a.startTime)-toMin(b.startTime));
    dayPen.forEach(r=>{
      const top=(toMin(r.startTime)-toMin(fs))/30*CELL_H;
      const height=(toMin(r.endTime)-toMin(r.startTime))/30*CELL_H;
      h+='<div class="cal-block pending-block" style="top:' + top + 'px;height:' + height + 'px">';
      h+='<span class="cb-time">' + esc(r.startTime) + '–' + esc(r.endTime) + '</span>';
      h+='<span class="cb-label">Talep Edildi</span>';
      h+='</div>';
    });
    h+='</div>';
  });
  h+='</div>';
  wrap.innerHTML=h;
  attachDrag();
}

function renderMonthly(){
  const wrap=document.getElementById('calendarWrapper');
  if(!wrap) return;
  const y=currentDate.getFullYear(),mo=currentDate.getMonth();
  const first=new Date(y,mo,1),last=new Date(y,mo+1,0);
  let off=first.getDay()-1;if(off<0)off=6;
  const total=last.getDate(),cells=Math.ceil((off+total)/7)*7;

  let h='<div class="month-header-row">';
  ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].forEach(n=>h+='<div class="month-day-header">' + n + '</div>');
  h+='</div><div class="calendar-monthly">';

  for(let i=0;i<cells;i++){
    const dn=i-off+1,dt=new Date(y,mo,dn);
    const cur=dn>=1&&dn<=total,sun=dt.getDay()===0;
    let cls='month-day';if(!cur)cls+=' other-month';if(sun)cls+=' sunday';if(isToday(dt))cls+=' today';
    const ds=fmtDate(dt),dayBlks=blocks.filter(b=>b.date===ds),sched=SCHEDULE[dt.getDay()];
    const dayPen=pendingRequests.filter(r=>r.date===ds);
    const click=cur&&sched?('onclick="goWeek(new Date(' + dt.getFullYear() + ',' + dt.getMonth() + ',' + dt.getDate() + '))"'):'';
    h+='<div class="' + cls + '" ' + click + '><div class="day-num">' + dt.getDate() + '</div>';
    if(cur&&sched){
      const totalSlots=Math.floor((toMin(sched.end)-toMin(sched.start))/60);
      let coveredSlots=0;
      dayBlks.forEach(b=>{coveredSlots+=Math.floor((toMin(b.endTime)-toMin(b.startTime))/60);});
      const avail=Math.max(0, totalSlots-coveredSlots);
      h+='<div class="slot-indicators">';
      if(avail>0)h+='<div class="slot-indicator has-available">● ' + avail + ' saat müsait</div>';
      if(dayBlks.length)h+='<div class="slot-indicator has-closed">● ' + dayBlks.length + ' kapalı</div>';
      if(dayPen.length)h+='<div class="slot-indicator has-pending">● ' + dayPen.length + ' talep</div>';
      h+='</div>';
    }
    h+='</div>';
  }
  h+='</div>';
  wrap.innerHTML=h;
}

function goWeek(d){
  currentDate=d;
  currentView='weekly';
  document.querySelectorAll('.view-toggle button').forEach(b=>b.classList.toggle('active',b.dataset.view==='weekly'));
  render();
}

function openReqModal(date, start, end, fromDrag){
  const [y,m,d]=date.split('-').map(Number);
  const dt=new Date(y,m-1,d);
  
  let finalEnd = end;
  if(!finalEnd) {
    finalEnd = toTime(toMin(start) + defaultDuration);
  }
  
  const dur = toMin(finalEnd) - toMin(start);
  document.getElementById('modalDate').textContent=d + ' ' + MONTHS[m-1] + ' ' + y + ', ' + DAYS[dt.getDay()];
  document.getElementById('modalTime').textContent=start + ' – ' + finalEnd + ' (' + dur + ' dk)';
  const f=document.getElementById('requestForm');
  f.dataset.date=date;
  f.dataset.start=start;
  f.dataset.end=finalEnd;

  // Sync active chip
  document.querySelectorAll('#studentDurationChips .chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.dur, 10) === dur);
  });

  document.getElementById('requestModal').classList.add('active');
  document.body.style.overflow='hidden';
  setTimeout(()=>document.getElementById('firstName').focus(),200);
}

// Drag Selection for Students (Touch & Mouse Support)
function attachDrag() {
  const wrapper = document.getElementById('calendarWrapper');
  if(!wrapper) return;
  const cells = wrapper.querySelectorAll('.cal-cell.avail');

  cells.forEach(cell => {
    cell.addEventListener('mousedown', e => {
      if (e.button !== 0) return; // Only primary mouse button
      e.preventDefault();
      isDragging = true;
      dragStart = cell;
      dragEnd = cell;
      dragCol = cell.closest('.cal-col');
      wrapper.classList.add('dragging');
      updateSel();
    });

    cell.addEventListener('mouseenter', () => {
      if (isDragging && cell.closest('.cal-col') === dragCol) {
        dragEnd = cell;
        updateSel();
      }
    });
  });

  if (!window._studentDragAttached) {
    window._studentDragAttached = true;
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      const wrap = document.getElementById('calendarWrapper');
      if (wrap) wrap.classList.remove('dragging');
      finalizeSel();
    });
  }
}

function updateSel() {
  document.querySelectorAll('.cal-cell.selecting').forEach(c => c.classList.remove('selecting'));
  if (!dragCol || !dragStart || !dragEnd) return;
  const colCells = Array.from(dragCol.querySelectorAll('.cal-cell.avail'));
  const si = colCells.indexOf(dragStart);
  const ei = colCells.indexOf(dragEnd);
  if (si === -1 || ei === -1) return;
  const [a, b] = [Math.min(si, ei), Math.max(si, ei)];
  for (let i = a; i <= b; i++) {
    colCells[i].classList.add('selecting');
  }
}

function finalizeSel() {
  if (!dragCol) return;
  const sel = Array.from(dragCol.querySelectorAll('.cal-cell.selecting'));
  sel.forEach(c => c.classList.remove('selecting'));
  if (!sel.length) return;

  const date = sel[0].dataset.date;
  const st = sel[0].dataset.time;
  const last = sel[sel.length - 1].dataset.time;
  const en = toTime(toMin(last) + 30);
  dragCol = null;
  dragStart = null;
  dragEnd = null;

  openReqModal(date, st, en, sel.length > 1);
}

function closeModal(){
  document.getElementById('requestModal').classList.remove('active');
  document.body.style.overflow='';
}

function openLegalModal(tabId){
  const m = document.getElementById('legalModal');
  if(m){
    m.classList.add('active');
    document.body.style.overflow='hidden';
    if(tabId) switchLegalTab('tab-' + tabId);
  }
}

function closeLegalModal(){
  const m = document.getElementById('legalModal');
  if(m){
    m.classList.remove('active');
    document.body.style.overflow='';
  }
}

function switchLegalTab(tabId){
  document.querySelectorAll('.legal-tab-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.target === tabId);
  });
  document.querySelectorAll('.legal-text-content').forEach(pane=>{
    pane.style.display = (pane.id === tabId) ? 'block' : 'none';
  });
}

function openCancelModal(){
  const m = document.getElementById('cancelRequestModal');
  if(m){
    m.classList.add('active');
    document.body.style.overflow='hidden';
  }
}

function closeCancelModal(){
  const m = document.getElementById('cancelRequestModal');
  if(m){
    m.classList.remove('active');
    document.body.style.overflow='';
  }
}

function setupFAQ(){
  document.querySelectorAll('.faq-question').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const item = btn.closest('.faq-item');
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(x=> {
        x.classList.remove('active');
        x.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });
      if(!isActive){
        item.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

function setupCookieBanner(){
  const consent = localStorage.getItem('cookie_consent');
  if(!consent){
    const banner = document.getElementById('cookieBanner');
    if(banner) setTimeout(() => banner.classList.add('active'), 1200);
  }
}

function acceptCookies(all){
  localStorage.setItem('cookie_consent', all ? 'all' : 'essential');
  const banner = document.getElementById('cookieBanner');
  if(banner) banner.classList.remove('active');
  toast(all ? 'Çerez tercihleriniz kaydedildi.' : 'Yalnızca gerekli çerezler aktif edildi.', 'info');
}

function toast(msg,type){
  type = type || 'info';
  const c=document.getElementById('toastContainer');
  if(!c) return;
  const t=document.createElement('div');
  t.className='toast ' + type;
  const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');
  t.innerHTML='<span>' + icon + '</span> ' + esc(msg);
  c.appendChild(t);
  setTimeout(()=>{
    t.classList.add('fade-out');
    setTimeout(()=>t.remove(),300);
  }, 4500);
}

// ---- Student / Parent Code Statistics Query ----
function setupStudentStatsForm() {
  const form = document.getElementById('studentStatsForm');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const input = document.getElementById('studentCodeInput');
    const code = (input.value || '').trim().toUpperCase();

    if (!code) {
      toast('Lütfen geçerli bir öğrenci kodu giriniz.', 'error');
      return;
    }

    await queryStudentStats(code);
  });
}

async function queryStudentStats(code) {
  const resultDiv = document.getElementById('studentStatsResult');
  if (!resultDiv) return;

  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-secondary);"><span style="display:inline-block;animation:spin 1s infinite linear;">⏳</span> İstatistikler yükleniyor...</div>';

  try {
    const res = await fetch(API + '/api/student-stats/' + encodeURIComponent(code));
    const data = await res.json();

    if (!res.ok) {
      resultDiv.innerHTML = '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-md);padding:16px;color:var(--accent-red);font-size:0.95rem;text-align:center;">' +
        '✕ ' + esc(data.error || 'Ders kaydı bulunamadı.') +
      '</div>';
      return;
    }

    let h = '';
    h += '<div style="background:rgba(19,138,77,0.06);border:1px solid rgba(19,138,77,0.2);border-radius:var(--radius-md);padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">';
    h += '<div>';
    h += '<span style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);font-weight:700;">Öğrenci Takip Kodu</span>';
    h += '<div style="font-size:1.5rem;font-weight:800;color:var(--accent-primary);">' + esc(data.studentCode) + '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    h += '<div style="background:var(--bg-card);border:1px solid var(--border-glass);padding:8px 14px;border-radius:var(--radius-sm);text-align:center;">';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary);">Bu Ay (Toplam)</div>';
    h += '<div style="font-size:1.2rem;font-weight:800;color:var(--accent-green);">' + data.thisMonth.hours + ' saat <span style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">(' + data.thisMonth.count + ' ders)</span></div>';
    h += '</div>';
    h += '<div style="background:var(--bg-card);border:1px solid var(--border-glass);padding:8px 14px;border-radius:var(--radius-sm);text-align:center;">';
    h += '<div style="font-size:0.75rem;color:var(--text-secondary);">Genel Toplam</div>';
    h += '<div style="font-size:1.2rem;font-weight:800;color:var(--accent-primary);">' + data.total.hours + ' saat <span style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">(' + data.total.count + ' ders)</span></div>';
    h += '</div>';
    h += '</div>';
    h += '</div>';

    // Monthly breakdown table
    const months = Object.entries(data.monthly || {}).sort((a, b) => b[0].localeCompare(a[0]));
    if (months.length) {
      h += '<h4 style="font-size:1rem;margin:16px 0 8px;color:var(--text-primary);display:flex;align-items:center;gap:6px;">📅 Aylık Ders Dağılımı</h4>';
      h += '<div style="overflow-x:auto;margin-bottom:16px;"><table style="width:100%;border-collapse:collapse;font-size:0.9rem;">';
      h += '<thead><tr style="background:var(--bg-glass);border-bottom:2px solid var(--border-glass);text-align:left;">';
      h += '<th style="padding:8px 12px;color:var(--text-secondary);">Dönem / Ay</th>';
      h += '<th style="padding:8px 12px;color:var(--text-secondary);text-align:center;">Ders Sayısı</th>';
      h += '<th style="padding:8px 12px;color:var(--text-secondary);text-align:right;">Toplam Süre</th>';
      h += '</tr></thead><tbody>';

      months.forEach(([ym, info]) => {
        const [y, m] = ym.split('-');
        const monthName = MONTHS[parseInt(m) - 1] || m;
        h += '<tr style="border-bottom:1px solid var(--border-glass);">';
        h += '<td style="padding:10px 12px;font-weight:600;color:var(--text-primary);">' + monthName + ' ' + y + '</td>';
        h += '<td style="padding:10px 12px;text-align:center;color:var(--text-primary);">' + info.count + ' seans</td>';
        h += '<td style="padding:10px 12px;text-align:right;font-weight:700;color:var(--accent-green);">' + (Math.round(info.hours * 10) / 10) + ' saat</td>';
        h += '</tr>';
      });

      h += '</tbody></table></div>';
    }

    // Upcoming lessons
    if (data.upcomingLessons && data.upcomingLessons.length) {
      h += '<h4 style="font-size:1rem;margin:16px 0 8px;color:var(--text-primary);display:flex;align-items:center;gap:6px;">⏳ Planlanan Yaklaşan Dersler</h4>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
      data.upcomingLessons.forEach(l => {
        const [y, m, d] = l.date.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const dayName = DAYS[dt.getDay()];
        h += '<div style="background:var(--bg-card);border:1px solid var(--border-glass);padding:8px 12px;border-radius:var(--radius-sm);font-size:0.85rem;display:flex;align-items:center;gap:8px;">';
        h += '<span style="color:var(--accent-primary);font-weight:700;">' + d + ' ' + MONTHS[m - 1] + '</span>';
        h += '<span style="color:var(--text-secondary);">' + dayName + '</span>';
        h += '<span style="background:var(--bg-glass);padding:2px 6px;border-radius:4px;font-weight:600;">' + l.startTime + ' – ' + l.endTime + '</span>';
        h += '</div>';
      });
      h += '</div>';
    }

    resultDiv.innerHTML = h;
  } catch (err) {
    resultDiv.innerHTML = '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-md);padding:16px;color:var(--accent-red);font-size:0.95rem;text-align:center;">' +
      'Bağlantı hatası oluştu. Lütfen daha sonra tekrar deneyiniz.' +
    '</div>';
  }
}

window.openReqModal=openReqModal;
window.goWeek=goWeek;
window.openLegalModal=openLegalModal;
window.closeLegalModal=closeLegalModal;
window.switchLegalTab=switchLegalTab;
window.openCancelModal=openCancelModal;
window.closeCancelModal=closeCancelModal;
window.acceptCookies=acceptCookies;
window.queryStudentStats=queryStudentStats;