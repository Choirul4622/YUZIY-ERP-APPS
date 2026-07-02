const GAS_URL = 'https://script.google.com/macros/s/AKfycbxr0HvZ6wOPMt_IBawWG68_dBDAnzKvEY2qvnU1lTyAUHkOvoLptiXEwq_Q-ZodjfCH/exec';

// 1. Initialize Dexie Database
const db = new Dexie("KiziyAppsDB");
db.version(1).stores({
  records: 'id, module, data, syncStatus, timestamp', // Real-time cache
  syncQueue: 'uuid, action, payload, timestamp'       // Offline sync queue
});

// 2. Global Notification System (Toast)
window.showToast = function(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = message;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
};

// Global Error Handler
window.addEventListener('error', (event) => {
  showToast(`Terjadi kesalahan sistem. Silakan coba lagi.`, 'error');
  console.error("Caught global error:", event.error);
});

// 3. Network Status Listener
function updateNetworkStatus() {
  const badge = document.getElementById('connection-status');
  if (navigator.onLine) {
    badge.textContent = 'Online';
    badge.className = 'status-badge';
    triggerBackgroundSync();
  } else {
    badge.textContent = 'Offline';
    badge.className = 'status-badge offline';
    showToast('Koneksi terputus. Beralih ke Offline Mode.', 'warning');
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// 4. Generate UUID
window.generateUUID = function() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + new Date().getTime();
};

// 5. Trigger Background Sync via Service Worker
window.triggerBackgroundSync = function() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PROCESS_SYNC_QUEUE', gasUrl: GAS_URL });
  }
};

document.getElementById('btn-sync').addEventListener('click', () => {
  if (!navigator.onLine) {
    showToast('Tidak bisa sync saat offline.', 'warning');
    return;
  }
  showToast('Memulai sinkronisasi manual...', 'success');
  triggerBackgroundSync();
});

// 6. Base64 File Converter Helper
window.fileToBase64 = function(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]); // Hanya ambil konten base64, buang header mime
    reader.onerror = error => reject(error);
  });
};

// 6b. HTML Escaper (Anti-XSS) — WAJIB untuk semua nilai yang berasal dari user
// sebelum disuntikkan ke innerHTML. Mencegah stored XSS lintas modul.
window.escapeHtml = function(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// 7. Router & SPA Navigation Logic
const modules = {
  hrd: (container) => typeof renderHRD === 'function' ? renderHRD(container) : container.innerHTML = `<h2>Modul HRD Belum Siap</h2>`,
  crm: (container) => typeof renderCRM === 'function' ? renderCRM(container) : container.innerHTML = `<h2>Modul CRM Belum Siap</h2>`,
  pos: (container) => typeof renderPOS === 'function' ? renderPOS(container) : container.innerHTML = `<h2>Modul POS Belum Siap</h2>`,
  inventory: (container) => typeof renderInventory === 'function' ? renderInventory(container) : container.innerHTML = `<h2>Modul Inventory Belum Siap</h2>`,
  finance: (container) => typeof renderFinance === 'function' ? renderFinance(container) : container.innerHTML = `<h2>Modul Finance Belum Siap</h2>`
};

const moduleTitles = {
  hrd: 'HRD & Payroll',
  crm: 'Customer Relationship Management',
  pos: 'POS / Kasir',
  inventory: 'Inventory & Warehouse',
  finance: 'Finance & Accounting'
};

function navigateTo(moduleName) {
  // Update UI Navigation Active State
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.module === moduleName) {
      item.classList.add('active');
    }
  });

  // Update Title
  document.getElementById('module-title').textContent = moduleTitles[moduleName] || 'Modul';

  // Render Content
  const appContent = document.getElementById('app-content');
  if (modules[moduleName]) {
    modules[moduleName](appContent);
  } else {
    appContent.innerHTML = `<div class="card"><h2>Modul tidak ditemukan.</h2></div>`;
  }
}

// Handle Sidebar Clicks
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const moduleName = item.dataset.module;
    navigateTo(moduleName);
    window.location.hash = moduleName; // Safe for file:// protocol
  });
});

// 8. Generic Save Record (Used by modules)
window.saveRecord = async function(moduleName, dataPayload) {
  const timestamp = new Date().toISOString();
  const uuid = generateUUID();
  const token = localStorage.getItem('kiziy_token') || 'NO_TOKEN';

  const newRecord = {
    id: uuid,
    module: moduleName,
    data: JSON.stringify(dataPayload),
    syncStatus: navigator.onLine ? 'pending' : 'offline',
    timestamp: timestamp
  };

  try {
    // Save to Cache
    await db.records.put(newRecord);

    // Save to Sync Queue
    await db.syncQueue.put({
      uuid: uuid,
      action: 'CREATE',
      payload: newRecord,
      timestamp: timestamp,
      token: token // Attach Token for Zero-Trust Validation
    });

    showToast('Data berhasil disimpan!', 'success');

    if (navigator.onLine) {
      triggerBackgroundSync();
    }
  } catch (err) {
    // IndexedDB gagal → JANGAN klaim sukses. Beri tahu user agar bisa coba lagi.
    console.error('Gagal menyimpan record ke IndexedDB:', err);
    showToast('Gagal menyimpan data. Silakan coba lagi.', 'error');
  }
};

// 8b. Update badge status sync di tabel modul aktif secara live (dipanggil oleh SW listener).
// Cari baris dengan data-sync-uuid cocok, lalu ubah isi sel .sync-badge.
window.updateRowSyncBadge = function(recordId, newStatus) {
  const row = document.querySelector(`tr[data-sync-uuid="${recordId}"]`);
  if (!row) return;
  const cell = row.querySelector('.sync-badge');
  if (!cell) return;
  if (newStatus === 'synced') {
    cell.style.color = 'var(--success)';
    cell.textContent = '✔';
  } else {
    cell.style.color = 'var(--warning)';
    cell.textContent = '⏳';
  }
};

// 8c. Refresh data modul aktif TANPA me-render ulang DOM (menjaga input form & cart POS).
// Dipetakan ke fungsi load*() global yang sudah ada di setiap modul.
window.refreshActiveModuleData = function() {
  const activeItem = document.querySelector('.nav-item.active');
  if (!activeItem) return;
  const mod = activeItem.dataset.module;
  const loaders = {
    hrd: typeof loadHRDData === 'function' ? loadHRDData : null,
    crm: typeof loadCRMData === 'function' ? loadCRMData : null,
    pos: typeof loadPOSData === 'function' ? loadPOSData : null,
    inventory: typeof loadInventoryData === 'function' ? loadInventoryData : null,
    finance: typeof loadFinanceData === 'function' ? loadFinanceData : null
  };
  if (loaders[mod]) {
    try { loaders[mod](); } catch (e) { console.error('Refresh modul gagal:', e); }
  }
};

// 8d. Listener pesan dari Service Worker (status sync real-time).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'SYNC_SUCCESS') {
      window.updateRowSyncBadge(msg.recordId, 'synced');
    } else if (msg.type === 'SYNC_ERROR') {
      window.showToast(msg.message || 'Sinkronisasi tertunda', 'warning');
    }
  });
}

// 9. Auto-Refresh Cache (Silent pull every 5 mins)
setInterval(async () => {
  if (!navigator.onLine) return;
  const token = localStorage.getItem('kiziy_token') || '';
  try {
    const response = await fetch(`${GAS_URL}?action=fetchAll&token=${encodeURIComponent(token)}`);
    const result = await response.json();

    // Sesi kedaluwarsa / token invalid → logout otomatis.
    if (result.status === 'error' && /unauthorized|token/i.test(result.message || '')) {
      if (typeof window.logoutApp === 'function') {
        showToast('Sesi berakhir, silakan login kembali.', 'warning');
        window.logoutApp();
      }
      return;
    }

    if (result.status === 'success' && result.data) {
      // Pertahankan record lokal yang belum tersinkronisasi agar tidak hilang.
      const pendingRecords = await db.records.where('syncStatus').notEqual('synced').toArray();
      const merged = result.data.slice();
      // Timpa versi server hanya untuk yang sudah synced; sisanya biarkan versi lokal.
      const mergedMap = new Map(merged.map(r => [r.id, r]));
      for (const p of pendingRecords) mergedMap.set(p.id, p);

      await db.records.clear();
      await db.records.bulkPut(Array.from(mergedMap.values()));

      // Hanya muat ulang DATA modul aktif — JANGAN re-render agar input
      // form / isi keranjang POS yang belum disubmit tidak hilang.
      window.refreshActiveModuleData();
    }
  } catch (err) {
    console.error("Auto-refresh gagal:", err);
  }
}, 5 * 60 * 1000);

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  updateNetworkStatus();
  
  // Simple Hash Router
  const hash = window.location.hash.replace('#', '');
  if (hash && moduleTitles[hash]) {
    navigateTo(hash);
  } else {
    navigateTo('hrd'); // Default module
  }
});
