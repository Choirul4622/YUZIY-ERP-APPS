// Modul Finance & Accounting
window.renderFinance = function(container) {
  container.innerHTML = `
    <div class="grid-2">
      <!-- Pemasukan -->
      <div class="card" style="border-top: 4px solid var(--success);">
        <h2>Catat Pemasukan</h2>
        <form id="finance-in-form">
          <div class="form-group">
            <label>Keterangan</label>
            <input type="text" id="fin-in-desc" required placeholder="Contoh: Pendapatan Layanan">
          </div>
          <div class="form-group">
            <label>Nominal (Rp)</label>
            <input type="number" id="fin-in-amount" required min="1">
          </div>
          <button type="submit" class="btn" style="width: 100%; background: var(--success);">Simpan Pemasukan</button>
        </form>
      </div>

      <!-- Pengeluaran -->
      <div class="card" style="border-top: 4px solid var(--error);">
        <h2>Catat Pengeluaran</h2>
        <form id="finance-out-form">
          <div class="form-group">
            <label>Keterangan</label>
            <input type="text" id="fin-out-desc" required placeholder="Contoh: Beli Kertas HVS">
          </div>
          <div class="form-group">
            <label>Nominal (Rp)</label>
            <input type="number" id="fin-out-amount" required min="1">
          </div>
          <button type="submit" class="btn" style="width: 100%; background: var(--error);">Simpan Pengeluaran</button>
        </form>
      </div>
    </div>

    <!-- Ledger Sederhana -->
    <div class="card">
      <h2>Buku Besar (Lokal)</h2>
      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Tipe</th>
              <th>Keterangan</th>
              <th>Nominal</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="finance-table-body">
            <tr><td colspan="5" style="text-align: center;">Memuat data...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Handler Pemasukan
  document.getElementById('finance-in-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      type: 'IN',
      desc: document.getElementById('fin-in-desc').value,
      amount: parseInt(document.getElementById('fin-in-amount').value, 10)
    };
    await window.saveRecord('Finance', payload);
    document.getElementById('finance-in-form').reset();
    loadFinanceData();
  });

  // Handler Pengeluaran
  document.getElementById('finance-out-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      type: 'OUT',
      desc: document.getElementById('fin-out-desc').value,
      amount: parseInt(document.getElementById('fin-out-amount').value, 10)
    };
    await window.saveRecord('Finance', payload);
    document.getElementById('finance-out-form').reset();
    loadFinanceData();
  });

  loadFinanceData();
};

async function loadFinanceData() {
  const tbody = document.getElementById('finance-table-body');
  if(!tbody) return;
  
  const records = await db.records.where('module').equals('Finance').reverse().toArray();
  
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Belum ada catatan keuangan</td></tr>`;
    return;
  }
  
  tbody.innerHTML = records.map(rec => {
    const isSynced = rec.syncStatus === 'synced';
    let data;
    try { data = JSON.parse(rec.data); } catch (e) { data = {}; }
    const type = (data && data.type) ? String(data.type) : '-';
    const desc = (data && data.desc) ? String(data.desc) : '-';
    const amount = (data && typeof data.amount === 'number') ? data.amount : 0;
    const isIn = type === 'IN';
    return `
      <tr data-sync-uuid="${escapeHtml(rec.id)}">
        <td>${escapeHtml(new Date(rec.timestamp).toLocaleTimeString())}</td>
        <td>
          <span class="status-badge" style="background: ${isIn ? 'var(--success)' : 'var(--error)'}">
            ${isIn ? 'Pemasukan' : 'Pengeluaran'}
          </span>
        </td>
        <td>${escapeHtml(desc)}</td>
        <td style="font-weight: 500;">Rp ${escapeHtml(amount.toLocaleString())}</td>
        <td class="sync-badge" style="color: ${isSynced ? 'var(--success)' : 'var(--warning)'}">
          ${isSynced ? '✔' : '⏳'}
        </td>
      </tr>
    `;
  }).join('');
}
