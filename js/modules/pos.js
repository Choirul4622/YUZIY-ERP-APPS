// Modul POS / Kasir
window.renderPOS = function(container) {
  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>Keranjang Kasir</h2>
        <div class="form-group">
          <label>Cari atau Scan Barcode (Simulasi)</label>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="pos-item-code" placeholder="Kode Barang" style="flex: 1;">
            <button id="btn-add-item" class="btn btn-secondary">Tambah</button>
          </div>
        </div>
        
        <div style="min-height: 150px; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); padding: 10px; margin-bottom: 15px;" id="pos-cart-items">
          <p style="text-align: center; color: var(--text-secondary); margin-top: 50px;">Keranjang kosong</p>
        </div>
        
        <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: 600; margin-bottom: 15px;">
          <span>Total:</span>
          <span id="pos-total">Rp 0</span>
        </div>
        
        <button id="btn-checkout" class="btn" style="width: 100%; background-color: var(--success);">Checkout (Bayar)</button>
      </div>

      <div class="card">
        <h2>Riwayat Transaksi Lokal</h2>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="pos-table-body">
              <tr><td colspan="3" style="text-align: center;">Memuat data...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  let cart = [];
  
  function updateCartUI() {
    const cartContainer = document.getElementById('pos-cart-items');
    const totalEl = document.getElementById('pos-total');
    
    if (cart.length === 0) {
      cartContainer.innerHTML = `<p style="text-align: center; color: var(--text-secondary); margin-top: 50px;">Keranjang kosong</p>`;
      totalEl.textContent = 'Rp 0';
      return;
    }
    
    let total = 0;
    cartContainer.innerHTML = cart.map((item, index) => {
      total += item.price;
      return `
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
          <span>${item.name}</span>
          <span>Rp ${item.price.toLocaleString()}</span>
        </div>
      `;
    }).join('');
    
    totalEl.textContent = `Rp ${total.toLocaleString()}`;
  }

  document.getElementById('btn-add-item').addEventListener('click', () => {
    const code = document.getElementById('pos-item-code').value;
    if (!code) {
      window.showToast('Masukkan kode barang', 'warning');
      return;
    }
    
    // Simulasi database produk
    const mockProduct = {
      name: `Produk ${code.toUpperCase()}`,
      price: Math.floor(Math.random() * 500000) + 50000,
      code: code
    };
    
    cart.push(mockProduct);
    document.getElementById('pos-item-code').value = '';
    updateCartUI();
  });

  document.getElementById('btn-checkout').addEventListener('click', async () => {
    if (cart.length === 0) {
      window.showToast('Keranjang masih kosong', 'error');
      return;
    }
    
    const payload = {
      items: cart,
      total: cart.reduce((sum, item) => sum + item.price, 0)
    };
    
    await window.saveRecord('POS', payload);
    
    cart = [];
    updateCartUI();
    loadPOSData();
  });

  loadPOSData();
};

async function loadPOSData() {
  const tbody = document.getElementById('pos-table-body');
  if(!tbody) return;
  
  const records = await db.records.where('module').equals('POS').reverse().toArray();
  
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">Belum ada transaksi</td></tr>`;
    return;
  }
  
  tbody.innerHTML = records.map(rec => {
    const data = JSON.parse(rec.data);
    const isSynced = rec.syncStatus === 'synced';
    return `
      <tr data-sync-uuid="${escapeHtml(rec.id)}">
        <td>${escapeHtml(new Date(rec.timestamp).toLocaleTimeString())}</td>
        <td>Rp ${escapeHtml(data.total.toLocaleString())}</td>
        <td class="sync-badge" style="color: ${isSynced ? 'var(--success)' : 'var(--warning)'}">
          ${isSynced ? '✔' : '⏳'}
        </td>
      </tr>
    `;
  }).join('');
}
