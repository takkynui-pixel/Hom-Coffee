/* ระบบจัดการออเดอร์และสต็อก — vanilla JS + Supabase (ธีมเดียวกับ stock-app เดิม) */
'use strict';
const db = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => Number(n ?? 0).toLocaleString('th-TH');
const baht = n => '฿' + Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const ROLE_TH = { admin:'ผู้ดูแลระบบ', sales:'ฝ่ายขาย', warehouse:'คลังสินค้า', packer:'แพ็กของ/จัดส่ง', accounting:'บัญชี', executive:'ผู้บริหาร' };
const STAT_TH = { draft:'ร่าง', confirmed:'ยืนยันแล้ว', cancelled:'ยกเลิก', pending:'รอแพ็ก', packed:'แพ็กแล้ว', shipped:'ส่งแล้ว', delivered:'ถึงผู้รับ', returned:'ตีกลับ', unpaid:'ยังไม่ชำระ', cod_pending:'รอเก็บ COD', paid:'รับเงินแล้ว', mismatch:'ยอดไม่ตรง' };
const MOVE_TH = { receive:'รับเข้า', issue_sale:'เบิกขาย', issue_free:'เบิกแถม', issue_request:'เบิกตามใบคำขอ', issue_manual:'เบิกออก', transfer_out:'โอนออก', transfer_in:'โอนเข้า', adjust:'ปรับยอด', count_adjust:'ปรับจากตรวจนับ', cancel_return:'คืนจากยกเลิก' };
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = { box: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'), bell: svg('<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  download: svg('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'), refresh: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>'),
  building: svg('<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>'), clip: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>') };
const imgUrl = path => path ? `${APP_CONFIG.SUPABASE_URL}/storage/v1/object/public/product-images/${encodeURIComponent(path)}` : '';
const thumbHTML = (p, cls = 'thumb') => p?.image_path
  ? `<img class="${cls}" src="${esc(imgUrl(p.image_path))}" alt="${esc(p.name)}" loading="lazy">`
  : `<span class="${cls} ph" aria-hidden="true">${IC.box}</span>`;

const state = { me: null };
const can = (...r) => r.includes(state.me?.role);
const must = async q => { const { data, error } = await q; if (error) throw error; return data; };
const must0 = async q => { const r = await q; if (r.error) throw r.error; return r; };

function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ''), bad ? 5000 : 2500); }
function openModal(title, body, { submitText = 'บันทึก', onSubmit } = {}) {
  const m = $('#modal');
  m.innerHTML = `<form method="dialog" id="mform" novalidate><div class="mhead"><h2>${esc(title)}</h2><button type="button" class="x" aria-label="ปิด" data-close>&times;</button></div>
    <div class="mbody"><div id="merr"></div>${body}</div><div class="mfoot"><button type="button" class="btn ghost" data-close>${onSubmit ? 'ยกเลิก' : 'ปิด'}</button>${onSubmit ? `<button type="submit" class="btn" id="msubmit">${esc(submitText)}</button>` : ''}</div></form>`;
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.close());
  $('#mform').onsubmit = async e => { e.preventDefault(); if (!onSubmit) return; const b = $('#msubmit'); b.disabled = true; $('#merr').innerHTML = '';
    try { await onSubmit($('#mform')); m.close(); route(); } catch (err) { $('#merr').innerHTML = `<div class="err">${esc(err.message)}</div>`; b.disabled = false; } };
  m.showModal();
}
const tag = (s, cls) => `<span class="tag ${cls || (['confirmed','paid','delivered','ok'].includes(s) ? 'ok' : ['cancelled','mismatch','returned','out'].includes(s) ? 'bad' : '')}">${esc(STAT_TH[s] || s)}</span>`;

/* ---------- หน้าต่าง ๆ ---------- */
async function loadRef() { const [w, c] = await Promise.all([must(db.from('warehouses').select('*').eq('active', true).order('is_main', { ascending: false })), must(db.from('categories').select('*').order('name'))]); state.wh = w; state.cats = c; }
const whOpts = sel => state.wh.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
const dkey = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const dayLabel = s => { const [, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]}`; };
const stOf = (bal, rp) => bal <= 0 ? 'out' : (rp > 0 && bal <= rp ? 'low' : 'ok');
const stTag = s => `<span class="tag ${s === 'out' ? 'bad' : s === 'ok' ? 'ok' : 'warn'}">${s === 'out' ? 'หมด' : s === 'low' ? 'ใกล้หมด' : 'ปกติ'}</span>`;
function csv(name, rows) { const b = new Blob(['\ufeff' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); }
function smoothPath(pts, H) {                            // Catmull-Rom → Bézier
  if (pts.length < 2) return '';
  const cl = y => Math.max(0, Math.min(H, y));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${cl(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${cl(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function lineChart(vals) {
  const W = 300, H = 110, pad = 4, max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => [pad + (W - 2 * pad) * i / Math.max(1, vals.length - 1), H - pad - (H - 2 * pad - 8) * v / max]);
  const d = smoothPath(pts, H), last = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="กราฟแนวโน้มการเบิกจ่าย">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D5CF0" stop-opacity=".25"/><stop offset="1" stop-color="#1D5CF0" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${last[0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z" fill="url(#ga)"/>
    <path d="${d}" fill="none" stroke="#1D5CF0" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

async function pageDashboard(el) {
  await loadRef();
  const [st, stw, daily, monthly, prods, reqs, pend] = await Promise.all([
    must(db.from('v_stock').select('*').order('sku')), must(db.from('v_stock_wh').select('*')),
    must(db.from('v_issued_daily').select('*').order('day', { ascending: false }).limit(60)),
    must(db.from('v_issued_monthly').select('*').order('month', { ascending: false }).limit(6)),
    must(db.from('products').select('id,category_id').eq('active', true)),
    must(db.from('stock_requests').select('doc_no,requester:profiles!requested_by(full_name)').eq('status', 'pending').order('created_at', { ascending: false }).limit(4)),
    db.from('stock_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')]);
  monthly.reverse();
  const dm = new Map(daily.map(r => [r.day, +r.qty])), days = [];
  for (let i = 59; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dkey(d); days.push({ day: k, qty: dm.get(k) || 0 }); }
  const arr = days.map(x => x.qty), cur = arr.slice(-30), prev = arr.slice(0, 30), dl = days.slice(-30);
  const curSum = cur.reduce((s, x) => s + x, 0), prevSum = prev.reduce((s, x) => s + x, 0);
  const delta = prevSum > 0 ? `${curSum >= prevSum ? '+' : ''}${Math.round((curSum - prevSum) / prevSum * 100)}%` : (curSum > 0 ? 'ใหม่' : '–');
  const issuedMonth = +(monthly.find(r => r.month === dkey(new Date()).slice(0, 7))?.qty || 0);
  const total = st.reduce((s, x) => s + x.balance, 0), nOut = st.filter(x => stOf(x.balance, x.reorder_point) === 'out').length, nLow = st.filter(x => stOf(x.balance, x.reorder_point) === 'low').length, nOk = st.length - nOut - nLow;
  const low = st.filter(x => stOf(x.balance, x.reorder_point) !== 'ok').sort((a, b) => a.balance - b.balance);
  const byWh = state.wh.map(w => ({ name: w.name, qty: stw.filter(r => r.warehouse_id === w.id).reduce((s, r) => s + r.balance, 0) }));
  const bm = new Map(st.map(x => [x.product_id, x.balance]));
  const byCat = state.cats.map(c => ({ name: c.name, qty: prods.filter(p => p.category_id === c.id).reduce((s, p) => s + (bm.get(p.id) || 0), 0) }));
  const maxWh = Math.max(1, ...byWh.map(x => x.qty)), maxCat = Math.max(1, ...byCat.map(x => x.qty));
  const mv = monthly.map(r => +r.qty), mmax = Math.max(1, ...mv), mavg = mv.reduce((s, x) => s + x, 0) / Math.max(1, mv.length);
  const bars = monthly.map((r, i) => `<div class="bw ${i === monthly.length - 1 ? 'on' : ''}" style="--h:${Math.max(4, Math.round(mv[i] / mmax * 100))}%" tabindex="0"><span class="tip">${MONTHS[+r.month.split('-')[1] - 1]} · ${nf(mv[i])} ชิ้น</span><div class="bar"></div></div>`).join('');
  const seg = (n, c) => n ? `<i style="flex:${n};background:${c}"></i>` : '';
  const h = new Date().getHours(), part = h < 12 ? 'ตอนเช้า' : h < 17 ? 'ตอนบ่าย' : 'ตอนเย็น';
  el.innerHTML = `<div class="head"><h1 class="greet">สวัสดี${part}, ${esc(state.me.full_name || '')}!</h1><div class="actions">${can('admin', 'warehouse') ? '<a class="btn" href="#/moves">+ รับ / เบิกสินค้า</a>' : '<a class="btn" href="#/orders">+ สร้างออเดอร์</a>'}</div></div>
    <div class="toolbar"><a class="pill" href="#/reports">${IC.download} ดาวน์โหลดรายงาน</a><button class="pill" id="refresh" type="button">${IC.refresh} รีเฟรช</button><span class="pill" style="cursor:default">ข้อมูล ณ ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span></div>
    <div class="grid dash1">
      <section class="card hero"><div class="top"><span class="dot">${IC.box}</span><a class="pillw" href="#/products">ดูสินค้า</a></div><h2>สต็อกคงเหลือรวม</h2><div class="num">${nf(total)}</div>
        <p>ใน ${nf(st.length)} รายการสินค้า · ${nf(state.wh.length)} คลัง · เบิกเดือนนี้ ${nf(issuedMonth)} ชิ้น</p><div class="seg">${seg(nOk, '#fff')}${seg(nLow, '#FFE08A')}${seg(nOut, '#FF9E9E')}</div>
        <div class="legend"><span><b style="background:#fff"></b>ปกติ ${nOk}</span><span><b style="background:#FFE08A"></b>ใกล้หมด ${nLow}</span><span><b style="background:#FF9E9E"></b>หมด ${nOut}</span></div></section>
      <section class="card"><div class="chead"><h2>แนวโน้มการเบิก</h2><span class="muted small">30 วันล่าสุด</span></div><div><span class="big">${nf(curSum)}</span><span class="delta" title="เทียบ 30 วันก่อนหน้า">${delta}</span></div>${lineChart(cur)}
        <div class="xl"><span>${dayLabel(dl[0].day)}</span><span>${dayLabel(dl[15].day)}</span><span>${dayLabel(dl[29].day)}</span></div></section>
      <section class="card"><div class="chead"><h2>คงเหลือตามคลัง</h2></div>${byWh.map(w => `<div class="lrow"><span class="circ">${IC.building}</span><div class="grow"><b>${esc(w.name)}</b><div class="pbar"><i style="width:${w.qty / maxWh * 100}%"></i></div></div><b>${nf(w.qty)}</b></div>`).join('')}</section>
      <section class="card"><div class="chead"><h2>ใบคำขอเบิก</h2><a class="pill out" href="#/requests">ดูทั้งหมด</a></div><div><span class="big">${nf(pend.count || 0)}</span> <span class="muted small">รออนุมัติ</span></div>
        <div style="margin-top:.6rem">${reqs.length ? reqs.map(r => `<div class="lrow"><span class="circ">${IC.clip}</span><div class="grow"><b>${esc(r.requester?.full_name ?? '-')}</b><span class="muted small">#${esc(r.doc_no)}</span></div><span class="tag">รออนุมัติ</span></div>`).join('') : '<p class="muted">ไม่มีใบคำขอที่รอดำเนินการ</p>'}</div></section></div>
    <div class="grid dash2">
      <section class="card"><div class="chead"><h2>สินค้าใกล้หมด</h2><a class="pill out" href="#/products">ดูรายละเอียด</a></div>
        ${low.length ? low.slice(0, 5).map(p => `<div class="lrow"><span class="circ">${IC.box}</span><div class="grow"><b>${esc(p.name)}</b><span class="muted small">${esc(p.sku)} · จุดเตือน ${nf(p.reorder_point)}</span></div><span class="tag ${p.balance <= 0 ? 'bad' : ''}">${nf(p.balance)} ชิ้น</span></div>`).join('') + (low.length > 5 ? `<p class="muted small" style="margin-top:.6rem">และอีก ${low.length - 5} รายการ</p>` : '') : '<p class="muted">ยังไม่มีสินค้าที่ถึงจุดเตือน</p>'}</section>
      <section class="card span2"><div class="chead"><h2>เบิกจ่ายรายเดือน</h2><span class="muted small">ย้อนหลัง 6 เดือน (ชิ้น)</span></div>
        <div class="plot">${bars}<div class="avg" style="bottom:${Math.min(100, mavg / mmax * 100)}%"><span>เฉลี่ย ${nf(Math.round(mavg))}</span></div></div><div class="xlab">${monthly.map(r => `<span>${MONTHS[+r.month.split('-')[1] - 1]}</span>`).join('')}</div></section>
      <section class="card"><div class="chead"><h2>คงเหลือตามหมวด</h2></div>${byCat.map(c => `<div class="lrow"><div class="grow"><b>${esc(c.name)}</b><div class="pbar"><i style="width:${c.qty / maxCat * 100}%"></i></div></div><b>${nf(c.qty)}</b></div>`).join('')}</section></div>`;
  $('#refresh').onclick = () => route();
}

/* --- รูปสินค้า: ย่อรูปในเครื่องก่อนอัปโหลด (ไม่เกิน 900px) --- */
async function resizeImage(file, max = 900, quality = 0.82) {
  let src, w, h, revoke;
  try { src = await createImageBitmap(file); w = src.width; h = src.height; }
  catch {
    const url = URL.createObjectURL(file); revoke = url;
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('อ่านไฟล์รูปไม่ได้')); im.src = url; });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height);
  if (revoke) URL.revokeObjectURL(revoke);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('ย่อรูปไม่สำเร็จ')), 'image/jpeg', quality));
}
async function uploadProductImage(file) {
  const blob = await resizeImage(file);
  const path = `p-${crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + error.message);
  return path;
}
const removeProductImage = async path => { if (path) { try { await db.storage.from('product-images').remove([path]); } catch { /* ไม่เป็นไร */ } } };

const zoomImage = p => openModal(p.name, `<img class="zoomimg" src="${esc(imgUrl(p.image_path))}" alt="${esc(p.name)}">`);
function labelTables(root) {
  if (!root) return;
  root.querySelectorAll('table').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()); if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach(tr => { let col = 0; [...tr.children].forEach(td => { const span = td.colSpan || 1; td.dataset.label = td.hasAttribute('data-nolabel') || span > 1 ? '' : (heads[col] || ''); col += span; }); });
  });
}
async function pageProducts(el) {
  await loadRef();
  const [prods, stw] = await Promise.all([must(db.from('products').select('*').order('sku')), must(db.from('v_stock_wh').select('*'))]);
  const canEdit = can('admin', 'warehouse'), f = state.pf ??= { q: '', cat: '', off: false };
  const bal = (pid, w) => stw.filter(r => r.product_id === pid && (!w || r.warehouse_id === w)).reduce((s, r) => s + r.balance, 0);
  const cn = id => state.cats.find(c => c.id === id)?.name || '-';
  el.innerHTML = `<div class="head"><h1>สินค้า</h1><div class="actions">${canEdit ? '<button class="btn" id="addp">+ เพิ่มสินค้า</button>' : ''}</div></div>
    <div class="filters"><input type="search" id="fq" placeholder="ค้นหารหัส / ชื่อสินค้า" value="${esc(f.q)}"><select id="fc"><option value="">ทุกหมวด</option>${state.cats.map(c => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label class="switch" style="margin:0 .4rem"><input type="checkbox" id="fo" ${f.off ? 'checked' : ''}> แสดงที่ปิดใช้งาน</label></div>
    <div class="tablewrap"><table><thead><tr><th>สินค้า</th>${state.wh.map(w => `<th class="num">${esc(w.name)}</th>`).join('')}<th class="num">รวม</th><th class="num">ต้นทุน/ชิ้น</th><th>สถานะ</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody id="pb"></tbody></table></div>`;
  const draw = () => { const q = f.q.trim().toLowerCase();
    $('#pb').innerHTML = prods.filter(p => (f.off || p.active) && (!f.cat || p.category_id === f.cat) && (!q || (p.sku + p.name).toLowerCase().includes(q))).map(p => { const t = bal(p.id);
      return `<tr><td data-nolabel><span class="pname"><button type="button" class="thumbbtn" data-zoomp="${p.id}" aria-label="ดูรูป">${thumbHTML(p)}</button><span><b>${esc(p.sku)}</b> ${esc(p.name)}<div class="muted small">${esc(cn(p.category_id))} · ลังละ ${nf(p.units_per_case)}${p.active ? '' : ' · ปิดใช้งาน'}</div></span></span></td>${state.wh.map(w => `<td class="num">${nf(bal(p.id, w.id))}</td>`).join('')}<td class="num"><b>${nf(t)}</b> ${esc(p.sell_unit)}</td><td class="num">${Number(p.cost) ? baht(p.cost) : '<b>ยังไม่ตั้ง</b>'}</td><td>${stTag(stOf(t, p.reorder_point))}</td>${canEdit ? `<td><button class="btn ghost sm" data-ed="${p.id}">แก้ไข</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="9" class="empty">ไม่พบสินค้า</td></tr>`; };
  draw(); $('#fq').oninput = e => { f.q = e.target.value; draw(); }; $('#fc').onchange = e => { f.cat = e.target.value; draw(); }; $('#fo').onchange = e => { f.off = e.target.checked; draw(); };
  el.onclick = e => { const z = e.target.closest('[data-zoomp]'), b = e.target.closest('[data-ed]');
    if (z) { const p = prods.find(x => x.id === z.dataset.zoomp); if (p?.image_path) zoomImage(p); } if (b && canEdit) productModal(prods.find(p => p.id === b.dataset.ed)); };
  if (canEdit) $('#addp').onclick = () => productModal();
}
function productModal(p) {
  openModal(p ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า', `
    <div class="imgpick"><span id="imgprev">${thumbHTML(p)}</span><div style="flex:1;min-width:0"><label style="margin:0">รูปสินค้า (ช่วยให้เลือกสินค้าได้ถูกต้อง)
      <input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label>${p?.image_path ? '<label class="switch" style="margin:.5rem 0 0;font-weight:400"><input type="checkbox" name="rmimg"> ลบรูปเดิม</label>' : ''}</div></div>
    <label>รหัสสินค้า (SKU)<input name="sku" required value="${esc(p?.sku)}" placeholder="เช่น P011"></label>
    <label>ชื่อสินค้า<input name="pname" required value="${esc(p?.name)}" placeholder="เช่น กาแฟ"></label>
    <label>หมวดหมู่<select name="cat" required>${state.cats.map(c => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>หน่วยนับ<input name="unit" required value="${esc(p?.sell_unit ?? 'ชิ้น')}" placeholder="ชิ้น / กล่อง / ขวด"></label>
    <label>จำนวนชิ้นต่อลัง<input name="upc" type="number" min="1" step="1" inputmode="numeric" value="${p?.units_per_case ?? 1}"></label>
    <label>จำนวนขั้นต่ำเพื่อแจ้งเตือน (รวมทุกคลัง)<input name="rp" type="number" min="0" step="1" inputmode="numeric" value="${p?.reorder_point ?? 0}"><span class="muted small">เมื่อคงเหลือเท่ากับหรือต่ำกว่าค่านี้ จะแสดงเป็นสินค้าใกล้หมด</span></label>
    <label>ราคาต้นทุนต่อหน่วย (บาท)<input name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${p && Number(p.cost) ? p.cost : ''}" placeholder="เช่น 250.00"><span class="muted small">ใช้คำนวณมูลค่าสต็อกในเมนูรายงาน</span></label>
    <label>ราคาตัวแทน (บาท)<input name="ag" type="number" min="0" step="0.01" inputmode="decimal" value="${p?.agent_price ?? 90}"></label>
    <label>ราคาลูกค้าทั่วไป (บาท)<input name="rt" type="number" min="0" step="0.01" inputmode="decimal" value="${p?.retail_price ?? 145}"><span class="muted small">ใช้เป็นตัวเลือกราคาตอนสร้างออเดอร์</span></label>
    ${p ? `<label class="switch"><input type="checkbox" name="act" ${p.active ? 'checked' : ''}> เปิดใช้งาน</label>` : ''}`,
    { onSubmit: async f => { const g = k => f.elements[k];
      const row = { sku: g('sku').value.trim(), name: g('pname').value.trim(), category_id: g('cat').value || null, sell_unit: g('unit').value.trim() || 'ชิ้น', units_per_case: parseInt(g('upc').value, 10) || 1,
        reorder_point: parseInt(g('rp').value, 10) || 0, cost: parseFloat(g('cost').value) || 0, agent_price: parseFloat(g('ag').value) || 0, retail_price: parseFloat(g('rt').value) || 0 };
      if (!row.sku || !row.name) throw new Error('กรุณากรอกรหัสและชื่อสินค้า');
      let newPath = null; const file = g('image').files[0];
      if (file) { newPath = await uploadProductImage(file); row.image_path = newPath; } else if (p && g('rmimg')?.checked) row.image_path = null;
      try { if (p) { row.active = g('act').checked; await must0(db.from('products').update(row).eq('id', p.id)); } else await must0(db.from('products').insert(row)); }
      catch (err) { await removeProductImage(newPath); throw err; }
      if (p?.image_path && 'image_path' in row && p.image_path !== row.image_path) await removeProductImage(p.image_path);
      toast('บันทึกสินค้าแล้ว'); } });
  $('#mform [name=image]').onchange = e => { const x = e.target.files[0]; if (x) $('#imgprev').innerHTML = `<img class="thumb" src="${URL.createObjectURL(x)}" alt="ตัวอย่างรูป">`; };
}

async function pageMoves(el) {
  await loadRef();
  const tab = state.mt || 'receive', titles = { receive: 'รับเข้า', issue: 'เบิกออก', transfer: 'โอนระหว่างคลัง', count: 'ตรวจนับ' };
  const [prods, stwAll] = await Promise.all([must(db.from('products').select('id,sku,name,sell_unit,image_path').eq('active', true).order('sku')), must(db.from('v_stock_wh').select('*'))]);
  el.innerHTML = `<div class="head"><h1>รับ / เบิก / โอน</h1></div><div class="tabs">${Object.entries(titles).map(([k, t]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div><div class="card" style="max-width:760px" id="mv"></div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.mt = b.dataset.tab; route(); });
  const po = prods.map(p => `<option value="${p.id}">${esc(p.sku)} ${esc(p.name)}</option>`).join('');
  if (tab !== 'count') {
    $('#mv').innerHTML = `<form id="f" novalidate><div id="ferr"></div>${tab === 'transfer' ? `<label>จากคลัง<select name="w1">${whOpts()}</select></label><label>ไปยังคลัง<select name="w2">${whOpts(state.wh[1]?.id)}</select></label>` : `<label>${tab === 'receive' ? 'รับเข้าที่คลัง' : 'เบิกจากคลัง'}<select name="w1">${whOpts()}</select></label>`}
      <label>สินค้า<select name="p">${po}</select></label><div class="pinfo" id="pinfo"></div><label>จำนวน (ชิ้น)<input name="q" type="number" min="1" required></label><label>เลขที่เอกสาร / หมายเหตุ<input name="n"></label><button class="btn" type="submit">บันทึก${titles[tab]}</button></form>`;
    const info = () => { const f = $('#f'), p = prods.find(x => x.id === f.elements.p.value); if (!p) { $('#pinfo').innerHTML = ''; return; }
      const b = id => stwAll.find(r => r.warehouse_id === id && r.product_id === p.id)?.balance || 0, tr = tab === 'transfer';
      $('#pinfo').innerHTML = `<span class="pname">${thumbHTML(p)}<span><b>${esc(p.sku)}</b> ${esc(p.name)}<div class="muted small">คงเหลือ${tr ? 'ต้นทาง' : ''} ${nf(b(f.elements.w1.value))} ${esc(p.sell_unit)}${tr ? ` · ปลายทาง ${nf(b(f.elements.w2.value))}` : ''}</div></span></span>`; };
    $('#f').addEventListener('change', info); info();
    $('#f').onsubmit = async e => { e.preventDefault(); const f = e.target, q = +f.q.value;
      try { if (!(q > 0)) throw new Error('ใส่จำนวนที่มากกว่า 0');
        if (tab === 'transfer') await must0(db.rpc('transfer_stock', { p_product: f.p.value, p_from: f.w1.value, p_to: f.w2.value, p_qty: q, p_note: f.n.value || null }));
        else await must0(db.from('stock_movements').insert({ product_id: f.p.value, warehouse_id: f.w1.value, qty: tab === 'receive' ? q : -q, move_type: tab === 'receive' ? 'receive' : 'issue_manual', doc_no: f.n.value || null }));
        toast('บันทึกแล้ว'); route(); } catch (x) { $('#ferr').innerHTML = `<div class="err">${esc(x.message)}</div>`; } };
    return;
  }
  const wid = state.cw || state.wh[0].id, stw = await must(db.from('v_stock_wh').select('*').eq('warehouse_id', wid));
  $('#mv').innerHTML = `<label>คลังที่ตรวจนับ<select id="cw">${whOpts(wid)}</select></label><div class="tablewrap"><table><thead><tr><th>สินค้า</th><th class="num">ตามสต็อก</th><th>นับจริง</th><th class="num">ส่วนต่าง</th></tr></thead><tbody>
    ${prods.map(p => { const s = stw.find(r => r.product_id === p.id)?.balance || 0; return `<tr><td>${esc(p.sku)} ${esc(p.name)}</td><td class="num">${nf(s)}</td><td><input type="number" min="0" data-c="${p.id}" data-s="${s}"></td><td class="num" data-d="${p.id}"></td></tr>`; }).join('')}</tbody></table></div><div id="ferr"></div><button class="btn" id="cs">บันทึกผลตรวจนับ</button>`;
  $('#cw').onchange = e => { state.cw = e.target.value; route(); };
  el.querySelectorAll('[data-c]').forEach(i => i.oninput = () => { $(`[data-d="${i.dataset.c}"]`).textContent = i.value === '' ? '' : (+i.value - +i.dataset.s); });
  $('#cs').onclick = async () => { try {
    const rows = [...el.querySelectorAll('[data-c]')].filter(i => i.value !== '').map(i => ({ product_id: i.dataset.c, warehouse_id: wid, system_qty: +i.dataset.s, counted_qty: +i.value }));
    if (!rows.length) throw new Error('ยังไม่ได้กรอกจำนวนที่นับ');
    await must0(db.from('stock_counts').insert(rows));
    const adj = rows.filter(r => r.counted_qty !== r.system_qty).map(r => ({ product_id: r.product_id, warehouse_id: wid, qty: r.counted_qty - r.system_qty, move_type: 'count_adjust', doc_no: 'COUNT' + dkey(new Date()) }));
    if (adj.length) await must0(db.from('stock_movements').insert(adj)); toast('บันทึกผลตรวจนับแล้ว'); route(); } catch (x) { $('#ferr').innerHTML = `<div class="err">${esc(x.message)}</div>`; } };
}

async function pageRequests(el) {
  await loadRef();
  const [rows, prods, stw] = await Promise.all([must(db.from('stock_requests').select('id,doc_no,status,note,created_at,warehouse:warehouses(name),requester:profiles!requested_by(full_name),items:stock_request_items(qty,product:products(sku,name))').order('created_at', { ascending: false }).limit(100)),
    must(db.from('products').select('id,sku,name,sell_unit,image_path').eq('active', true).order('sku')), must(db.from('v_stock_wh').select('*'))]);
  const canDec = can('admin', 'warehouse'), RS = { pending: 'รออนุมัติ', issued: 'จ่ายของแล้ว', rejected: 'ไม่อนุมัติ' };
  el.innerHTML = `<div class="head"><h1>ใบคำขอเบิก</h1><div class="actions"><button class="btn" id="nr">+ สร้างใบคำขอเบิก</button></div></div><div class="tablewrap"><table><thead><tr><th>เลขที่</th><th>ผู้ขอ</th><th>คลัง</th><th>รายการ</th><th>สถานะ</th>${canDec ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.doc_no)}<div class="muted small">${new Date(r.created_at).toLocaleDateString('th-TH')}</div></td><td>${esc(r.requester?.full_name || '-')}</td><td>${esc(r.warehouse?.name || '-')}</td><td>${r.items.map(i => `${esc(i.product?.name)} × ${nf(i.qty)}`).join('<br>')}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</td><td><span class="tag ${r.status === 'issued' ? 'ok' : r.status === 'rejected' ? 'bad' : ''}">${RS[r.status]}</span></td>
    ${canDec ? `<td>${r.status === 'pending' ? `<button class="btn sm" data-ok="${r.id}">อนุมัติและจ่าย</button> <button class="btn sm danger" data-no="${r.id}">ไม่อนุมัติ</button>` : ''}</td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีใบคำขอ</td></tr>'}</tbody></table></div>`;
  el.onclick = async e => { const b = e.target.closest('[data-ok],[data-no]'); if (!b) return; const ok = !!b.dataset.ok;
    try { await must0(db.rpc('decide_request', { p_id: b.dataset.ok || b.dataset.no, p_approve: ok })); toast(ok ? 'อนุมัติและตัดสต็อกแล้ว' : 'ปฏิเสธใบคำขอแล้ว'); route(); } catch (x) { toast(x.message, true); } };
  $('#nr').onclick = () => { openModal('สร้างใบคำขอเบิก', `<label>เบิกจากคลัง<select name="w">${whOpts()}</select></label><p class="sect">รายการสินค้า</p><div id="lines">${lineHTML(prods, false)}</div><button type="button" class="btn ghost sm" id="al">+ เพิ่มสินค้า</button><label style="margin-top:.9rem">หมายเหตุ<input name="n"></label>`, { submitText: 'ส่งใบคำขอ', onSubmit: async f => {
    const items = [...document.querySelectorAll('#lines .oline')].map(l => ({ product_id: $('[name=pid]', l).value, qty: +$('[name=q]', l).value })).filter(i => i.product_id && i.qty > 0);
    if (!items.length) throw new Error('เลือกสินค้าอย่างน้อย 1 รายการ');
    const { data, error } = await db.rpc('create_request', { p_wh: f.elements.w.value, p_note: f.elements.n.value || null, p_items: items }); if (error) throw error; toast('ส่งใบคำขอ ' + data + ' แล้ว'); } });
    const w = $('#mform [name=w]'), rf = bindLines($('#lines'), prods, id => stw.find(r => r.warehouse_id === w.value && r.product_id === id)?.balance || 0, false);
    w.addEventListener('change', rf); $('#al').onclick = () => $('#lines').insertAdjacentHTML('beforeend', lineHTML(prods, false)); };
}

async function pageReports(el) {
  const [prods, st, ords] = await Promise.all([must(db.from('products').select('id,sku,name,cost').eq('active', true).order('sku')), must(db.from('v_stock').select('product_id,balance')),
    must(db.from('orders').select('order_no,order_date,net_total,order_status,ship_status,pay_status,customer:customers(name,phone)').order('created_at', { ascending: false }))]);
  const bm = new Map(st.map(x => [x.product_id, x.balance])), rows = prods.map(p => ({ ...p, bal: bm.get(p.id) || 0 }));
  const value = rows.reduce((s, r) => s + r.bal * Number(r.cost), 0), qty = rows.reduce((s, r) => s + r.bal, 0), noCost = rows.filter(r => !Number(r.cost)).length;
  el.innerHTML = `<div class="head"><h1>รายงาน</h1><div class="actions"><button class="btn ghost" id="c1">${IC.download} สต็อก (CSV)</button><button class="btn" id="c2">${IC.download} ออเดอร์ (CSV)</button></div></div>
    <div class="statrow"><div class="stat"><div class="v">${baht(value)}</div><div class="l">มูลค่าสต็อกรวม (ราคาต้นทุน)</div></div><div class="stat"><div class="v">${nf(qty)}</div><div class="l">จำนวนคงเหลือรวม (ชิ้น)</div></div><div class="stat ${noCost ? 'alert' : ''}"><div class="v">${nf(noCost)}</div><div class="l">สินค้าที่ยังไม่ตั้งต้นทุน</div></div></div>
    <div class="tablewrap"><table><thead><tr><th>สินค้า</th><th class="num">คงเหลือ</th><th class="num">ต้นทุน/ชิ้น</th><th class="num">มูลค่า</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.sku)} ${esc(r.name)}</td><td class="num">${nf(r.bal)}</td><td class="num">${baht(r.cost)}</td><td class="num">${baht(r.bal * r.cost)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#c1').onclick = () => csv('stock-' + dkey(new Date()) + '.csv', [['SKU', 'ชื่อ', 'คงเหลือ', 'ต้นทุน', 'มูลค่า'], ...rows.map(r => [r.sku, r.name, r.bal, r.cost, r.bal * r.cost])]);
  $('#c2').onclick = () => csv('orders-' + dkey(new Date()) + '.csv', [['เลขออเดอร์', 'วันที่', 'ลูกค้า', 'เบอร์', 'ยอดสุทธิ', 'สถานะ', 'ขนส่ง', 'ชำระ'], ...ords.map(o => [o.order_no, o.order_date, o.customer?.name, o.customer?.phone, o.net_total, STAT_TH[o.order_status], STAT_TH[o.ship_status], STAT_TH[o.pay_status]])]);
}

async function pageUsers(el) {
  const us = await must(db.from('profiles').select('*').order('email'));
  el.innerHTML = `<div class="head"><h1>ผู้ใช้และสิทธิ์</h1></div><p class="muted" style="margin:-.4rem 0 1.2rem">กำหนดข้อมูล บทบาท และการเปิดใช้งานของผู้ใช้ · เพิ่มผู้ใช้ใหม่ที่ Supabase > Authentication แล้วมากำหนดสิทธิ์ที่นี่</p>
    <div class="tablewrap"><table><thead><tr><th>ชื่อ</th><th>รหัสพนักงาน</th><th>แผนก</th><th>อีเมล</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr><td><b>${esc(u.full_name || '-')}</b></td><td>${esc(u.employee_code || '-')}</td><td>${esc(u.department || '-')}</td><td>${esc(u.email || '-')}</td><td>${esc(ROLE_TH[u.role])}</td><td><span class="tag ${u.active ? 'ok' : 'bad'}">${u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td><td><button class="btn ghost sm" data-eu="${u.id}">แก้ไข</button></td></tr>`).join('')}</tbody></table></div>`;
  el.onclick = e => { const b = e.target.closest('[data-eu]'); if (!b) return; const u = us.find(x => x.id === b.dataset.eu);
    openModal('แก้ไขผู้ใช้', `<p class="muted">${esc(u.email)}</p><label>ชื่อ-นามสกุล<input name="fn" required value="${esc(u.full_name)}"></label><label>รหัสพนักงาน<input name="ec" value="${esc(u.employee_code)}"></label><label>แผนก<input name="dp" value="${esc(u.department)}"></label>
      <label>บทบาท<select name="rl">${Object.entries(ROLE_TH).map(([k, t]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="switch"><input type="checkbox" name="ac" ${u.active ? 'checked' : ''}> เปิดใช้งานบัญชี</label>`,
      { onSubmit: async f => { const g = k => f.elements[k]; if (!g('fn').value.trim()) throw new Error('กรอกชื่อ-นามสกุล');
        if (u.id === state.me.id && (g('rl').value !== 'admin' || !g('ac').checked)) throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
        await must0(db.from('profiles').update({ full_name: g('fn').value.trim(), employee_code: g('ec').value.trim() || null, department: g('dp').value.trim() || null, role: g('rl').value, active: g('ac').checked }).eq('id', u.id)); toast('บันทึกผู้ใช้แล้ว'); } }); };
}

async function pageWarehouses(el) {
  const ws = await must(db.from('warehouses').select('*').order('is_main', { ascending: false }).order('name'));
  el.innerHTML = `<div class="head"><h1>คลังสินค้า</h1><div class="actions"><button class="btn" id="aw">+ เพิ่มคลัง</button></div></div><div class="tablewrap"><table><thead><tr><th>ชื่อคลัง</th><th>คลังหลัก</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${ws.map(w => `<tr><td><b>${esc(w.name)}</b></td><td>${w.is_main ? '<span class="tag ok">คลังหลัก</span>' : `<button class="btn sm ghost" data-main="${w.id}">ตั้งเป็นคลังหลัก</button>`}</td><td>${w.active ? '<span class="tag ok">ใช้งาน</span>' : '<span class="tag">ปิด</span>'}</td><td><button class="btn sm ghost" data-ed="${w.id}">แก้ไข</button></td></tr>`).join('')}</tbody></table></div>
    <p class="muted small">ออเดอร์ขายจะตัดสต็อกจากคลังหลักเสมอ</p>`;
  const wm = w => openModal(w ? 'แก้ไขคลัง' : 'เพิ่มคลัง', `<label>ชื่อคลัง<input name="n" value="${esc(w?.name)}" required></label>${w ? `<label><input type="checkbox" name="a" ${w.active ? 'checked' : ''}> เปิดใช้งาน</label>` : ''}`,
    { onSubmit: async f => { if (!f.n.value.trim()) throw new Error('ใส่ชื่อคลัง'); await must0(w ? db.from('warehouses').update({ name: f.n.value.trim(), active: f.a.checked }).eq('id', w.id) : db.from('warehouses').insert({ name: f.n.value.trim() })); toast('บันทึกแล้ว'); } });
  $('#aw').onclick = () => wm();
  el.onclick = async e => { const m = e.target.closest('[data-main]'), d = e.target.closest('[data-ed]');
    if (d) return wm(ws.find(w => w.id === d.dataset.ed));
    if (m) try { await must0(db.from('warehouses').update({ is_main: false }).neq('id', m.dataset.main)); await must0(db.from('warehouses').update({ is_main: true, active: true }).eq('id', m.dataset.main)); toast('เปลี่ยนคลังหลักแล้ว'); route(); } catch (x) { toast(x.message, true); } };
}
async function pageNotify(el) {
  const { data: n, error } = await db.from('notification_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message + ' (รัน supabase/upgrade_v3.sql ก่อน)');
  const s = n || { emails: '', on_low_stock: true, on_new_request: true, on_cod_mismatch: true };
  el.innerHTML = `<div class="head"><h1>การแจ้งเตือนอีเมล</h1></div><div class="card" style="max-width:640px"><div class="err" style="background:#fff7e0;color:#8a5a00">ตอนนี้ระบบบันทึกการตั้งค่าไว้แล้ว แต่ยังไม่ส่งอีเมลจริง ต้องติดตั้ง Supabase Edge Function และบริการส่งอีเมลเพิ่ม</div>
    <form id="nf"><div id="ferr"></div><label>อีเมลผู้รับ (คั่นด้วยจุลภาค)<input name="e" value="${esc(s.emails)}" placeholder="a@example.com, b@example.com"></label>
    <label><input type="checkbox" name="l" ${s.on_low_stock ? 'checked' : ''}> สินค้าถึงจุดเตือนใกล้หมด</label><label><input type="checkbox" name="r" ${s.on_new_request ? 'checked' : ''}> มีใบคำขอเบิกใหม่</label><label><input type="checkbox" name="c" ${s.on_cod_mismatch ? 'checked' : ''}> ยอด COD ไม่ตรง</label>
    <button class="btn" type="submit">บันทึกการตั้งค่า</button></form></div>`;
  $('#nf').onsubmit = async e => { e.preventDefault(); const f = e.target; const list = f.e.value.split(',').map(x => x.trim()).filter(Boolean);
    try { if (list.some(x => !/^\S+@\S+\.\S+$/.test(x))) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
      await must0(db.from('notification_settings').upsert({ id: 1, emails: list.join(', '), on_low_stock: f.l.checked, on_new_request: f.r.checked, on_cod_mismatch: f.c.checked, updated_at: new Date().toISOString() })); toast('บันทึกแล้ว'); } catch (x) { $('#ferr').innerHTML = `<div class="err">${esc(x.message)}</div>`; } };
}
function changePwModal() { openModal('เปลี่ยนรหัสผ่าน', `<label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)<input name="a" type="password" autocomplete="new-password" required></label><label>ยืนยันรหัสผ่านใหม่<input name="b" type="password" autocomplete="new-password" required></label>`,
  { submitText: 'เปลี่ยนรหัสผ่าน', onSubmit: async f => { if (f.a.value.length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'); if (f.a.value !== f.b.value) throw new Error('รหัสผ่านไม่ตรงกัน');
    const { error } = await db.auth.updateUser({ password: f.a.value }); if (error) throw error; toast('เปลี่ยนรหัสผ่านแล้ว'); } }); }
async function installApp() {
  if (state.ip) { state.ip.prompt(); await state.ip.userChoice; state.ip = null; return; }
  if (matchMedia('(display-mode: standalone)').matches) return toast('ติดตั้งแอปนี้แล้ว');
  openModal('ติดตั้งแอปบนมือถือ', `<p><b>iPhone / iPad (Safari)</b><br>กดปุ่มแชร์ แล้วเลือก "เพิ่มลงในหน้าจอโฮม"</p><p><b>Android (Chrome)</b><br>กดเมนู ⋮ แล้วเลือก "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"</p>`);
}
async function refreshBell() { const b = $('#bell i'); if (!b) return; const { count } = await db.from('stock_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'); b.hidden = !count; b.textContent = count || ''; }

async function pageOrders(el) {
  await loadRef(); const [pr, ords, stw] = await Promise.all([must(db.from('products').select('id,sku,name,sell_unit,image_path,agent_price,retail_price').eq('active', true).order('sku')),
    must(db.from('orders').select('id,order_no,order_date,net_total,order_status,ship_status,pay_status,customer:customers(name,phone,province)').order('created_at', { ascending: false }).limit(100)), must(db.from('v_stock_wh').select('*'))]);
  const mainId = state.wh.find(w => w.is_main)?.id, bal = new Map(stw.filter(r => r.warehouse_id === mainId).map(r => [r.product_id, r.balance]));
  const canEdit = can('admin', 'sales');
  el.innerHTML = `<div class="head"><h1>ออเดอร์</h1><div class="actions">${canEdit ? '<button class="btn" id="add">+ สร้างออเดอร์</button>' : ''}</div></div>
    <div class="toolbar"><div class="filters"><input type="search" id="fq" placeholder="ค้นหาเลขออเดอร์ / ชื่อลูกค้า"></div></div><div class="tablewrap"><table><thead><tr><th>เลขออเดอร์</th><th>ลูกค้า</th><th class="num">ยอดสุทธิ</th><th>ออเดอร์</th><th>ขนส่ง</th><th>ชำระ</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody id="ob"></tbody></table></div>`;
  const draw = () => { const q = $('#fq').value.trim().toLowerCase();
    $('#ob').innerHTML = ords.filter(o => !q || (o.order_no + (o.customer?.name || '')).toLowerCase().includes(q)).map(o => `<tr><td>${esc(o.order_no)}<div class="muted small">${esc(o.order_date)}</div></td><td>${esc(o.customer?.name)}<div class="muted small">${esc(o.customer?.phone || '')}</div></td><td class="num">${baht(o.net_total)}</td><td>${tag(o.order_status)}</td><td>${tag(o.ship_status)}</td><td>${tag(o.pay_status)}</td>${canEdit ? `<td>${o.order_status === 'confirmed' ? `<button class="btn sm danger" data-cx="${o.id}">ยกเลิก</button>` : ''}</td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="empty">ไม่พบออเดอร์</td></tr>'; };
  draw(); $('#fq').oninput = draw;
  el.onclick = async e => { const b = e.target.closest('[data-cx]'); if (!b || !confirm('ยกเลิกออเดอร์นี้? ระบบจะคืนสต็อกให้อัตโนมัติ')) return;
    try { await must0(db.from('orders').update({ order_status: 'cancelled' }).eq('id', b.dataset.cx)); toast('ยกเลิกออเดอร์แล้ว'); route(); } catch (x) { toast(x.message, true); } };
  if (canEdit) $('#add').onclick = () => orderModal(pr, bal);
}
function lineHTML(pr, withPrice) {
  return `<div class="oline"><div class="otop"><span class="oth">${thumbHTML(null, 'thumb sm')}</span><select name="pid" aria-label="สินค้า"><option value="">เลือกสินค้า</option>${pr.map(p => `<option value="${p.id}">${esc(p.sku)} ${esc(p.name)}</option>`).join('')}</select><button type="button" class="orm" data-rm aria-label="ลบรายการ">&times;</button></div>
    <div class="ofields"><label>${withPrice ? 'จำนวนขาย' : 'จำนวนที่ขอ'}<input name="q" type="number" min="${withPrice ? 0 : 1}" value="1" inputmode="numeric"></label>${withPrice ? `<label>จำนวนแถม<input name="f" type="number" min="0" value="0" inputmode="numeric"></label><label>ราคาต่อหน่วย<select name="pr"><option value="0">เลือกสินค้าก่อน</option></select></label>` : ''}</div>
    <div class="oinfo muted small">เลือกสินค้าเพื่อดูรายละเอียดและสต็อกคงเหลือ</div></div>`;
}
function bindLines(box, pr, bal, withPrice, onChange) {
  const upd = l => { const p = pr.find(x => x.id === $('[name=pid]', l).value), info = $('.oinfo', l); $('.oth', l).innerHTML = thumbHTML(p, 'thumb sm');
    if (!p) { info.className = 'oinfo muted small'; info.textContent = 'เลือกสินค้าเพื่อดูรายละเอียดและสต็อกคงเหลือ'; return; }
    const have = bal(p.id), q = +$('[name=q]', l).value || 0, need = q + (withPrice ? (+$('[name=f]', l).value || 0) : 0), price = withPrice ? +$('[name=pr]', l).value : 0;
    info.className = 'oinfo small' + (need > have ? ' bad' : ' muted');
    info.innerHTML = `<b>${esc(p.sku)}</b> ${esc(p.name)} · คงเหลือ ${nf(have)} ${esc(p.sell_unit || 'ชิ้น')}${withPrice ? ` · รวมบรรทัด <b>${baht(q * price)}</b>` : ''}${need > have ? ` · <b>สต็อกไม่พอ (ต้องใช้ ${nf(need)})</b>` : ''}`; };
  const all = () => { box.querySelectorAll('.oline').forEach(upd); onChange?.(); };
  box.addEventListener('change', e => { const l = e.target.closest('.oline'); if (!l) return;
    if (e.target.name === 'pid' && withPrice) { const p = pr.find(x => x.id === e.target.value); $('[name=pr]', l).innerHTML = p ? `<option value="${p.retail_price}">ทั่วไป ${nf(p.retail_price)}</option><option value="${p.agent_price}">ตัวแทน ${nf(p.agent_price)}</option>` : '<option value="0">เลือกสินค้าก่อน</option>'; }
    upd(l); onChange?.(); });
  box.addEventListener('input', e => { const l = e.target.closest('.oline'); if (l && e.target.type === 'number') { upd(l); onChange?.(); } });
  box.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b && box.querySelectorAll('.oline').length > 1) { b.closest('.oline').remove(); onChange?.(); } });
  return all;
}
function orderModal(pr, bal) {
  const fields = [['name', 'ชื่อ-นามสกุล'], ['phone', 'เบอร์โทร'], ['house_no', 'บ้านเลขที่'], ['village', 'หมู่บ้าน'], ['road', 'ถนน'], ['subdistrict', 'ตำบล'], ['district', 'อำเภอ'], ['province', 'จังหวัด'], ['postcode', 'รหัสไปรษณีย์']];
  const fld = ([k, l]) => `<label class="${k === 'road' ? 'full' : ''}">${l}<input name="c_${k}" ${k === 'name' ? 'required' : ''} ${k === 'phone' ? 'type="tel" inputmode="tel"' : ''} ${k === 'postcode' ? 'inputmode="numeric" maxlength="5"' : ''}></label>`;
  openModal('สร้างออเดอร์ (COD)', `<p class="sect">ข้อมูลลูกค้า</p>${fld(fields[0])}${fld(fields[1])}<div class="fgrid">${fields.slice(2).map(fld).join('')}</div>
    <p class="sect">รายการสินค้า</p><div id="lines">${lineHTML(pr, true)}</div><button type="button" class="btn ghost sm" id="al">+ เพิ่มสินค้า</button>
    <div class="fgrid" style="margin-top:.9rem"><label>ส่วนลด (บาท)<input name="d" type="number" min="0" value="0" inputmode="decimal"></label><label>ค่าจัดส่ง (บาท)<input name="s" type="number" min="0" value="0" inputmode="decimal"></label></div>
    <div class="osum" id="osum"></div>`, {
    submitText: 'บันทึกและตัดสต็อก', onSubmit: async f => {
      const items = [...document.querySelectorAll('#lines .oline')].map(l => ({ product_id: $('[name=pid]', l).value, qty: +$('[name=q]', l).value, free_qty: +$('[name=f]', l).value, unit_price: +$('[name=pr]', l).value })).filter(i => i.product_id);
      if (!f.elements.c_name.value.trim() || !items.length) throw new Error('กรอกชื่อลูกค้าและเลือกสินค้าอย่างน้อย 1 รายการ');
      const c = {}; fields.forEach(([k]) => c[k] = f.elements['c_' + k].value.trim());
      const { data, error } = await db.rpc('create_order', { p_customer: c, p_items: items, p_discount: +f.elements.d.value, p_ship: +f.elements.s.value, p_confirm: true });
      if (error) throw error; toast('บันทึกแล้ว เลขออเดอร์ ' + data); } });
  const sum = () => { const sub = [...document.querySelectorAll('#lines .oline')].reduce((s, l) => s + (+$('[name=q]', l).value || 0) * (+$('[name=pr]', l).value || 0), 0), d = +$('#mform [name=d]').value || 0, sh = +$('#mform [name=s]').value || 0;
    $('#osum').innerHTML = `ยอดสินค้า ${baht(sub)}<br>ยอดสุทธิ (เก็บ COD) <b>${baht(sub - d + sh)}</b>`; };
  bindLines($('#lines'), pr, id => bal.get(id) || 0, true, sum); sum();
  $('#mform').addEventListener('input', e => { if (e.target.name === 'd' || e.target.name === 's') sum(); });
  $('#al').onclick = () => $('#lines').insertAdjacentHTML('beforeend', lineHTML(pr, true));
}

async function pageCod(el) {
  const rows = await must(db.from('orders').select('id,order_no,net_total,pay_status,ship_status,customer:customers(name),payments(received,received_at)').eq('order_status', 'confirmed').order('created_at', { ascending: false }).limit(100));
  const canPay = can('admin', 'accounting');
  el.innerHTML = `<div class="head"><h1>COD / รับชำระ</h1></div><div class="tablewrap"><table><thead><tr><th>เลขออเดอร์</th><th>ลูกค้า</th><th class="num">ยอดที่ต้องรับ</th><th class="num">รับจริง</th><th>สถานะ</th>${canPay ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(o => { const got = (o.payments || []).reduce((s, p) => s + Number(p.received || 0), 0); return `<tr><td>${esc(o.order_no)}</td><td>${esc(o.customer?.name)}</td><td class="num">${baht(o.net_total)}</td><td class="num">${got ? baht(got) : '-'}</td><td>${tag(o.pay_status)}</td>${canPay ? `<td>${o.pay_status === 'paid' ? '' : `<button class="btn sm" data-pay="${o.id}" data-exp="${o.net_total}">บันทึกรับเงิน</button>`}</td>` : ''}</tr>`; }).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีออเดอร์</td></tr>'}</tbody></table></div>`;
  el.onclick = e => { const b = e.target.closest('[data-pay]'); if (!b) return; const exp = +b.dataset.exp;
    openModal('บันทึกรับเงิน COD', `<p>ยอดที่ต้องรับ <b>${baht(exp)}</b></p><label>ยอดรับจริง (บาท)<input name="r" type="number" step="0.01" value="${exp}" required></label><label>วันที่เงินเข้า<input name="d" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>`,
      { onSubmit: async f => { const r = +f.r.value; await must0(db.from('payments').insert({ order_id: b.dataset.pay, method: 'cod', expected: exp, received: r, received_at: f.d.value, reconciled: r === exp }));
        await must0(db.from('orders').update({ pay_status: r === exp ? 'paid' : 'mismatch' }).eq('id', b.dataset.pay)); toast(r === exp ? 'ยอดตรง' : 'ยอดไม่ตรง ต้องตรวจสอบ', r !== exp); } }); };
}

async function pageHistory(el) {
  const mv = await must(db.from('stock_movements').select('created_at,doc_no,qty,move_type,product:products(sku,name),warehouse:warehouses(name)').order('created_at', { ascending: false }).limit(150));
  el.innerHTML = `<div class="head"><h1>ประวัติเคลื่อนไหวสต็อก</h1></div><div class="tablewrap"><table><thead><tr><th>เวลา</th><th>เอกสาร</th><th>สินค้า</th><th>คลัง</th><th>ประเภท</th><th class="num">จำนวน</th></tr></thead><tbody>
    ${mv.map(m => `<tr><td>${new Date(m.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(m.doc_no || '-')}</td><td>${esc(m.product?.sku)} ${esc(m.product?.name)}</td><td>${esc(m.warehouse?.name || '-')}</td><td>${esc(MOVE_TH[m.move_type] || m.move_type)}</td><td class="num">${m.qty > 0 ? '+' : ''}${nf(m.qty)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีรายการ</td></tr>'}</tbody></table></div>`;
}

const PAGES = {
  dashboard: { label: 'ภาพรวม', render: pageDashboard },
  orders: { label: 'ออเดอร์', render: pageOrders },
  requests: { label: 'ใบคำขอเบิก', render: pageRequests },
  products: { label: 'สินค้า', render: pageProducts },
  moves: { label: 'รับ / เบิก / โอน', render: pageMoves, roles: ['admin', 'warehouse'] },
  cod: { label: 'COD', render: pageCod, roles: ['admin', 'accounting', 'executive'] },
  history: { label: 'ประวัติ', render: pageHistory },
  reports: { label: 'รายงาน', render: pageReports, roles: ['admin', 'warehouse', 'accounting', 'executive'] },
  warehouses: { label: 'คลังสินค้า', render: pageWarehouses, roles: ['admin'], group: 'settings' },
  users: { label: 'ผู้ใช้และสิทธิ์', render: pageUsers, roles: ['admin'], group: 'settings' },
  notify: { label: 'การแจ้งเตือนอีเมล', render: pageNotify, roles: ['admin'], group: 'settings' }
};
const allowed = () => Object.keys(PAGES).filter(k => !PAGES[k].roles || can(...PAGES[k].roles));
async function route() {
  const keys = allowed(), mainKeys = keys.filter(k => !PAGES[k].group), setKeys = keys.filter(k => PAGES[k].group);
  let key = location.hash.replace('#/', '') || mainKeys[0]; if (!keys.includes(key)) key = mainKeys[0];
  $('#nav').innerHTML = mainKeys.map(k => `<a href="#/${k}" class="${k === key ? 'on' : ''}">${PAGES[k].label}</a>`).join('');
  const act = $('#nav a.on'); if (act) $('#nav').scrollLeft = Math.max(0, act.offsetLeft - 24);
  const sm = $('#dd-set'); if (sm) { sm.innerHTML = setKeys.map(k => `<a href="#/${k}" class="${k === key ? 'on' : ''}">${PAGES[k].label}</a>`).join(''); $('[data-dd="dd-set"]').classList.toggle('on', setKeys.includes(key)); }
  document.querySelectorAll('.ddmenu.open').forEach(m => m.classList.remove('open'));
  const main = $('#main'); main.onclick = null; main.innerHTML = '<div class="empty">กำลังโหลด…</div>';
  try { await PAGES[key].render(main); } catch (err) { main.innerHTML = `<div class="err">เกิดข้อผิดพลาด: ${esc(err.message)}</div>`; }
  refreshBell();
}
window.addEventListener('hashchange', () => state.me && route());
document.addEventListener('click', e => { const btn = e.target.closest('[data-dd]');
  document.querySelectorAll('.ddmenu.open').forEach(m => { if (!btn || m.id !== btn.dataset.dd) m.classList.remove('open'); });
  if (btn) { const m = $('#' + btn.dataset.dd); m.classList.toggle('open'); btn.setAttribute('aria-expanded', m.classList.contains('open')); } });

function showShell() {
  const ini = (state.me.full_name || state.me.email || '?').trim().charAt(0).toUpperCase();
  $('#app').innerHTML = `<div class="frame"><header class="topbar"><a class="tb-logo" href="#/" aria-label="หน้าแรก"><img src="logo.png" alt="โลโก้"></a><nav class="nav" id="nav" aria-label="เมนูหลัก"></nav>
    <div class="tools"><a class="iconbtn" id="bell" href="#/requests" aria-label="ใบคำขอเบิกที่รอดำเนินการ">${IC.bell}<i class="badge" hidden></i></a>${can('admin') ? `<div class="dd"><button type="button" class="iconbtn" data-dd="dd-set" aria-haspopup="true" aria-expanded="false" aria-label="ตั้งค่า">${IC.gear}</button><div class="ddmenu" id="dd-set"></div></div>` : ''}<div class="dd"><button type="button" class="avatar" data-dd="dd-me" aria-haspopup="true" aria-expanded="false" aria-label="บัญชีผู้ใช้">${esc(ini)}</button>
    <div class="ddmenu" id="dd-me"><div class="who"><b>${esc(state.me.full_name || state.me.email)}</b><span>${esc(ROLE_TH[state.me.role])} · ${esc(state.me.email || '')}</span></div><button type="button" id="chpw">เปลี่ยนรหัสผ่าน</button><button type="button" id="inst">ติดตั้งแอปบนมือถือ</button><button type="button" class="danger" id="logout">ออกจากระบบ</button></div></div></div></header>
    <main class="main" id="main"></main></div>`;
  new MutationObserver(() => { cancelAnimationFrame(labelTables._r); labelTables._r = requestAnimationFrame(() => labelTables($('#main'))); }).observe($('#main'), { childList: true, subtree: true });
  $('#chpw').onclick = changePwModal; $('#inst').onclick = installApp;
  $('#logout').onclick = async () => { await db.auth.signOut(); location.reload(); };
  route();
}
function showLogin(msg = '') {
  $('#app').innerHTML = `<div class="frame"><div class="login"><form id="lf"><img class="logo-login" src="logo.png" alt="โลโก้"><h1>ระบบจัดการ<span class="hl">ออเดอร์</span>และสต็อก</h1><p class="muted" style="margin-bottom:1.2rem">เข้าสู่ระบบเพื่อใช้งาน</p>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}<label>อีเมล<input name="email" type="email" autocomplete="username" required></label><label>รหัสผ่าน<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn" style="width:100%" type="submit">เข้าสู่ระบบ</button></form></div></div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); const f = e.target; $('button', f).disabled = true;
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value }); if (error) return showLogin('อีเมลหรือรหัสผ่านไม่ถูกต้อง'); boot(); };
}
async function boot() {
  const { data: { session } } = await db.auth.getSession(); if (!session) return showLogin();
  const { data: me, error } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  if (error || !me) { await db.auth.signOut(); return showLogin('ไม่พบข้อมูลผู้ใช้ กรุณาติดต่อผู้ดูแลระบบ'); }
  if (!me.active) { await db.auth.signOut(); return showLogin('บัญชียังไม่ได้เปิดใช้งาน'); }
  state.me = me; showShell();
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.ip = e; });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
boot();
