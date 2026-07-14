(() => {
  'use strict';

  // ---- Configuration -------------------------------------------------
  const SHEET_ID = '18w9d7Cf89f3go3tKwArV30ErSCQDtJGQ1BqfG8p9edE';
  const GID = '1943759344'; // "الجهات المانحة2026" tab

  // Column labels as they appear in the sheet's header row. "رابط التغريدة"
  // is intentionally excluded from COLUMNS below per request — its data is
  // never read or displayed.
  const COLUMNS = {
    entity: 'الجهة المانحة',
    project: 'اسم المشروع',
    status: 'حالة طلب المنح',
    approvedAmount: 'المبلغ المعتمد',
    method: 'طريقة الرفع للجهة',
    submittedAmount: 'المبلغ المرفوع للجهة',
    employee: 'الموظف',
    date: 'تاريخ الرفع',
    contact: 'رقم التواصل (إن وجد)',
    notes: 'ملاحظات',
  };

  function normText(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function toNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/[,،٬\s]/g, '');
    if (s === '') return null;
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  function escapeXML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const fmtInt = n => Math.round(n).toLocaleString('en-US');

  // "تم الدعم" / "تم قبول المشروع" -> good, "تم الرفض" -> critical,
  // "قيد الدراسة" (or anything else pending) -> warning.
  function statusClass(status) {
    const s = normText(status);
    if (s.includes('الدعم') || s.includes('قبول')) return 'status-good';
    if (s.includes('رفض')) return 'status-critical';
    if (s) return 'status-warning';
    return '';
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // skip, \n handles the line break
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(r => r.map(v => (v === '' ? null : v)));
  }

  async function fetchGrid() {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`تعذر جلب البيانات (${res.status})`);
    const text = await res.text();
    return parseCSV(text);
  }

  // The sheet merges each field across two columns and each record across two
  // rows, so every data row is followed by a fully blank spacer row. Rather
  // than assume fixed offsets, find the header row by label text and read
  // every other row by the same label -> column mapping.
  function parseDonors(grid) {
    const headerIdx = grid.findIndex(row => row.some(v => normText(v) === COLUMNS.entity));
    if (headerIdx === -1) return [];

    const header = grid[headerIdx];
    const colIndex = {};
    Object.entries(COLUMNS).forEach(([key, label]) => {
      const idx = header.findIndex(v => normText(v) === label);
      if (idx !== -1) colIndex[key] = idx;
    });

    const records = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      const entity = colIndex.entity !== undefined ? normText(row[colIndex.entity]) : '';
      if (!entity) continue; // skip blank spacer rows

      records.push({
        entity,
        project: normText(colIndex.project !== undefined ? row[colIndex.project] : ''),
        status: normText(colIndex.status !== undefined ? row[colIndex.status] : ''),
        approvedAmount: colIndex.approvedAmount !== undefined ? toNumber(row[colIndex.approvedAmount]) : null,
        method: normText(colIndex.method !== undefined ? row[colIndex.method] : ''),
        submittedAmount: colIndex.submittedAmount !== undefined ? toNumber(row[colIndex.submittedAmount]) : null,
        employee: normText(colIndex.employee !== undefined ? row[colIndex.employee] : ''),
        date: normText(colIndex.date !== undefined ? row[colIndex.date] : ''),
        contact: normText(colIndex.contact !== undefined ? row[colIndex.contact] : ''),
        notes: normText(colIndex.notes !== undefined ? row[colIndex.notes] : ''),
      });
    }
    return records;
  }

  // ---- Rendering ----------------------------------------------------

  function renderKPIs(records) {
    const entities = new Set(records.map(r => r.entity));
    const supported = records.filter(r => statusClass(r.status) === 'status-good').length;
    const raised = records.reduce((s, r) => s + (r.submittedAmount || 0), 0);
    const approved = records.reduce((s, r) => s + (r.approvedAmount || 0), 0);
    const rate = records.length ? (supported / records.length) * 100 : 0;

    document.getElementById('kpiEntities').textContent = fmtInt(entities.size);
    document.getElementById('kpiRequests').textContent = fmtInt(records.length);
    document.getElementById('kpiSupported').textContent = fmtInt(supported);
    document.getElementById('kpiAcceptRate').textContent = records.length ? `${rate.toFixed(0)}%` : '—';
    document.getElementById('kpiRaisedAmount').textContent = fmtInt(raised);
    document.getElementById('kpiApprovedAmount').textContent = fmtInt(approved);
  }

  function renderStatusChart(records) {
    const counts = new Map();
    records.forEach(r => {
      const key = r.status || 'غير محدد';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const container = document.getElementById('statusChart');

    if (!rows.length) {
      container.innerHTML = '<div class="chart-empty">لا توجد بيانات بعد</div>';
      return;
    }

    const max = Math.max(...rows.map(r => r[1]), 1);
    const rowH = 34;
    const gap = 10;
    const topPad = 8;
    const height = rows.length * (rowH + gap) + topPad;
    const width = 900;
    const labelW = 220;
    const valueW = 50;
    const trackX = labelW;
    const trackW = width - labelW - valueW;

    let bars = '';
    rows.forEach(([status, count], idx) => {
      const y = topPad + idx * (rowH + gap);
      const barW = Math.max((count / max) * trackW, 3);
      const cls = statusClass(status);
      bars += `
        <g>
          <text class="bar-label" x="${width - 16}" y="${y + rowH / 2 + 4}" text-anchor="start">${escapeXML(status)}</text>
          <rect class="bar-track" x="${trackX}" y="${y}" width="${trackW}" height="${rowH * 0.55}" rx="6" transform="translate(0, ${rowH * 0.225})" />
          <rect class="bar-fill ${cls}" x="${trackX + trackW - barW}" y="${y}" width="${barW}" height="${rowH * 0.55}" rx="6" transform="translate(0, ${rowH * 0.225})">
            <title>${escapeXML(status)}: ${count}</title>
          </rect>
          <text class="bar-value" x="${trackX + trackW - barW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${count}</text>
        </g>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="حالة طلبات المنح">${bars}</svg>`;
  }

  function populateStatusFilter(records) {
    const select = document.getElementById('statusFilter');
    const existing = new Set(Array.from(select.options).map(o => o.value));
    Array.from(new Set(records.map(r => r.status).filter(Boolean))).forEach(s => {
      if (!existing.has(s)) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
      }
    });
  }

  let sortState = { key: 'entity', dir: 'asc' };

  const SORT_ACCESSORS = {
    entity: r => r.entity,
    project: r => r.project,
    status: r => r.status,
    approvedAmount: r => r.approvedAmount,
    submittedAmount: r => r.submittedAmount,
    employee: r => r.employee,
    date: r => r.date,
  };

  function sortRecords(list) {
    const accessor = SORT_ACCESSORS[sortState.key];
    if (!accessor) return list;
    const dirMul = sortState.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      const aNull = va === null || va === undefined || va === '';
      const bNull = vb === null || vb === undefined || vb === '';
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof va === 'string') return va.localeCompare(vb, 'ar') * dirMul;
      return (va - vb) * dirMul;
    });
  }

  function updateSortArrows() {
    document.querySelectorAll('#donorsTable thead th[data-sort]').forEach(th => {
      const arrow = th.querySelector('.sort-arrow');
      if (!arrow) return;
      arrow.textContent = th.dataset.sort === sortState.key ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
    });
  }

  let allRecords = [];

  function renderTable() {
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const body = document.getElementById('donorsBody');

    let filtered = allRecords.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!search) return true;
      const hay = `${r.entity} ${r.project} ${r.employee} ${r.notes}`.toLowerCase();
      return hay.includes(search);
    });

    filtered = sortRecords(filtered);
    updateSortArrows();

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty-row">لا توجد نتائج مطابقة</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(r => `
      <tr>
        <td><strong>${escapeXML(r.entity)}</strong></td>
        <td>${escapeXML(r.project || '—')}</td>
        <td>${r.status ? `<span class="status-badge ${statusClass(r.status)}">${escapeXML(r.status)}</span>` : '—'}</td>
        <td class="num">${r.approvedAmount !== null ? fmtInt(r.approvedAmount) : '—'}</td>
        <td>${escapeXML(r.method || '—')}</td>
        <td class="num">${r.submittedAmount !== null ? fmtInt(r.submittedAmount) : '—'}</td>
        <td>${escapeXML(r.employee || '—')}</td>
        <td>${escapeXML(r.date || '—')}</td>
        <td>${escapeXML(r.contact || '—')}</td>
        <td><div class="desc-cell">${escapeXML(r.notes || '—')}</div></td>
      </tr>`).join('');
  }

  function renderStatus(errors) {
    const banner = document.getElementById('statusBanner');
    if (!errors.length) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `تعذر تحميل البيانات: ${errors.map(escapeXML).join(' — ')}`;
  }

  // ---- Main -----------------------------------------------------------

  async function refresh() {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.classList.add('spinning');
    try {
      const grid = await fetchGrid();
      allRecords = parseDonors(grid);
      renderStatus([]);
      renderKPIs(allRecords);
      renderStatusChart(allRecords);
      populateStatusFilter(allRecords);
      renderTable();
      document.getElementById('lastUpdated').textContent =
        `آخر تحديث: ${new Date().toLocaleString('ar-SA')}`;
    } catch (err) {
      renderStatus([err.message || String(err)]);
      document.getElementById('donorsBody').innerHTML =
        '<tr><td colspan="10" class="empty-row">تعذر تحميل البيانات</td></tr>';
    } finally {
      btn.disabled = false;
      btn.classList.remove('spinning');
    }
  }

  document.getElementById('refreshBtn').addEventListener('click', refresh);
  document.getElementById('searchInput').addEventListener('input', renderTable);
  document.getElementById('statusFilter').addEventListener('change', renderTable);
  document.querySelectorAll('#donorsTable thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState = { key, dir: 'asc' };
      }
      renderTable();
    });
  });

  refresh();
})();
