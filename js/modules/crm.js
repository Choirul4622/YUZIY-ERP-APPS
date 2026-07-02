// Modul CRM
window.renderCRM = function(container) {
  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>Input Lead Baru</h2>
        <form id="crm-form">
          <div class="form-group">
            <label>Nama Prospek</label>
            <input type="text" id="crm-name" required placeholder="Contoh: Budi Santoso">
          </div>
          <div class="form-group">
            <label>No. HP / WA</label>
            <input type="tel" id="crm-phone" required placeholder="Contoh: 08123456789">
          </div>
          <div class="form-group">
            <label>Sumber</label>
            <select id="crm-source">
              <option value="Instagram">Instagram</option>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Website">Website</option>
              <option value="Walk-in">Walk-in</option>
            </select>
          </div>
          <button type="submit" class="btn" style="width: 100%;">Simpan Lead</button>
        </form>
      </div>

      <div class="card">
        <h2>Daftar Leads Terbaru</h2>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Sumber</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody id="crm-table-body">
              <tr><td colspan="3" style="text-align: center;">Memuat data...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('crm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('crm-name').value,
      phone: document.getElementById('crm-phone').value,
      source: document.getElementById('crm-source').value
    };
    
    await window.saveRecord('CRM', payload);
    document.getElementById('crm-form').reset();
    loadCRMData();
  });

  loadCRMData();
};

async function loadCRMData() {
  const tbody = document.getElementById('crm-table-body');
  if(!tbody) return;
  
  const records = await db.records.where('module').equals('CRM').reverse().toArray();
  
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">Belum ada lead</td></tr>`;
    return;
  }
  
  tbody.innerHTML = records.map(rec => {
    const data = JSON.parse(rec.data);
    const isSynced = rec.syncStatus === 'synced';
    return `
      <tr data-sync-uuid="${escapeHtml(rec.id)}">
        <td>${escapeHtml(data.name)}</td>
        <td><span class="status-badge" style="background: var(--accent-color);">${escapeHtml(data.source)}</span></td>
        <td class="sync-badge" style="color: ${isSynced ? 'var(--success)' : 'var(--warning)'}">
          ${isSynced ? '✔' : '⏳'}
        </td>
      </tr>
    `;
  }).join('');
}
