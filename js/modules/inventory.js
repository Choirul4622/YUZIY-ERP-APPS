// Modul Inventory & Warehouse
window.renderInventory = function(container) {
  container.innerHTML = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2>Manajemen Stok Barang</h2>
        <button id="btn-add-stock" class="btn">Update Stok</button>
      </div>
      
      <!-- Form Input Stok (Sembunyi by default) -->
      <div id="inventory-form-container" style="display: none; background: rgba(0,0,0,0.02); padding: 15px; border-radius: var(--radius-sm); margin-bottom: 20px; border: 1px solid var(--border-color);">
        <form id="inventory-form">
          <div class="grid-2">
            <div class="form-group">
              <label>Kode / Nama Barang</label>
              <input type="text" id="inv-item" required placeholder="Contoh: Emas 10g">
            </div>
            <div class="form-group">
              <label>Tipe Update</label>
              <select id="inv-type">
                <option value="IN">Stok Masuk</option>
                <option value="OUT">Stok Keluar</option>
              </select>
            </div>
            <div class="form-group">
              <label>Jumlah</label>
              <input type="number" id="inv-qty" required min="1" value="1">
            </div>
            <div class="form-group">
              <label>Foto Barang (Opsional)</label>
              <input type="file" id="inv-photo" accept="image/*" capture="environment" style="border: 1px dashed var(--border-color); padding: 8px;">
            </div>
          </div>
          <button type="submit" class="btn">Simpan</button>
          <button type="button" id="btn-cancel-stock" class="btn btn-secondary">Batal</button>
        </form>
      </div>

      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Barang</th>
              <th>Aktivitas</th>
              <th>Jumlah</th>
              <th>Status Sync</th>
            </tr>
          </thead>
          <tbody id="inventory-table-body">
            <tr><td colspan="5" style="text-align: center;">Memuat data...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-add-stock').addEventListener('click', () => {
    document.getElementById('inventory-form-container').style.display = 'block';
  });

  document.getElementById('btn-cancel-stock').addEventListener('click', () => {
    document.getElementById('inventory-form-container').style.display = 'none';
    document.getElementById('inventory-form').reset();
  });

  document.getElementById('inventory-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const photoInput = document.getElementById('inv-photo');
    let mediaBase64 = null;
    let mimeType = null;
    let fileName = null;
    
    if (photoInput.files.length > 0) {
      const file = photoInput.files[0];
      try {
        mediaBase64 = await window.fileToBase64(file);
        mimeType = file.type;
        fileName = file.name;
      } catch(err) {
        window.showToast('Gagal memproses foto', 'error');
        return;
      }
    }
    
    const payload = {
      item: document.getElementById('inv-item').value,
      type: document.getElementById('inv-type').value,
      qty: parseInt(document.getElementById('inv-qty').value, 10)
    };
    
    if (mediaBase64) {
      payload.mediaBase64 = mediaBase64;
      payload.mimeType = mimeType;
      payload.fileName = fileName;
    }
    
    await window.saveRecord('Inventory', payload);
    document.getElementById('inventory-form').reset();
    document.getElementById('inventory-form-container').style.display = 'none';
    loadInventoryData();
  });

  loadInventoryData();
};

async function loadInventoryData() {
  const tbody = document.getElementById('inventory-table-body');
  if(!tbody) return;
  
  const records = await db.records.where('module').equals('Inventory').reverse().toArray();
  
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Belum ada pergerakan stok</td></tr>`;
    return;
  }
  
  tbody.innerHTML = records.map(rec => {
    const data = JSON.parse(rec.data);
    const isOut = data.type === 'OUT';
    
    // Render foto jika ada, baik dari URL public Drive (jika tersinkronisasi) atau Base64 lokal.
    // Atribut src di-escape untuk mencegah injeksi atribut via URL berbahaya.
    let photoHtml = '';
    if (data.mediaUrl) {
      photoHtml = `<img src="${escapeHtml(data.mediaUrl)}" alt="foto barang" style="height: 40px; border-radius: 4px; display: block; margin-top: 5px;">`;
    } else if (data.mediaBase64) {
      const safeMime = /^(image|application)\/[a-zA-Z0-9.+-]+$/.test(data.mimeType) ? data.mimeType : 'image/jpeg';
      photoHtml = `<img src="data:${escapeHtml(safeMime)};base64,${escapeHtml(data.mediaBase64)}" alt="foto barang" style="height: 40px; border-radius: 4px; display: block; margin-top: 5px;">`;
    }
    
    return `
      <tr data-sync-uuid="${escapeHtml(rec.id)}">
        <td>${escapeHtml(new Date(rec.timestamp).toLocaleTimeString())}</td>
        <td>
          ${escapeHtml(data.item)}
          ${photoHtml}
        </td>
        <td><span class="status-badge" style="background: ${isOut ? 'var(--error)' : 'var(--success)'}">${escapeHtml(data.type)}</span></td>
        <td>${isOut ? '-' : '+'}${escapeHtml(data.qty)}</td>
        <td class="sync-badge" style="color: ${rec.syncStatus === 'synced' ? 'var(--success)' : 'var(--warning)'}">
          ${rec.syncStatus === 'synced' ? '✔' : '⏳'}
        </td>
      </tr>
    `;
  }).join('');
}
