importScripts('https://unpkg.com/dexie/dist/dexie.js');

const CACHE_NAME = 'kiziy-apps-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/auth.js',
  './js/app.js',
  './js/modules/hrd.js',
  './js/modules/crm.js',
  './js/modules/pos.js',
  './js/modules/inventory.js',
  './js/modules/finance.js',
  'https://unpkg.com/dexie/dist/dexie.js'
];

// Mutex / Service Lock
let isSyncing = false;

// 1. Install SW & Cache Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 2. Activate SW
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 3. Intercept Fetch (Offline-First for static assets)
self.addEventListener('fetch', (event) => {
  // Hanya intercept GET request dan bukan request ke GAS API
  if (event.request.method === 'GET' && !event.request.url.includes('script.google.com')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
  }
});

// 4. Message Listener (Triggered by app.js)
self.addEventListener('message', async (event) => {
  if (event.data.type === 'PROCESS_SYNC_QUEUE') {
    const gasUrl = event.data.gasUrl;
    await processSyncQueue(gasUrl);
  }
});

// 5. Background Sync Queue Processing (FIFO) with Mutex Lock
async function processSyncQueue(gasUrl) {
  // Service Lock (Mutex)
  if (isSyncing) {
    console.log('[SW] Sync sudah berjalan, mencegah race condition.');
    return;
  }

  isSyncing = true;

  try {
    const db = new Dexie("KiziyAppsDB");
    db.version(1).stores({
      records: 'id, module, data, syncStatus, timestamp',
      syncQueue: 'uuid, action, payload, timestamp'
    });

    // Ambil semua antrean, urutkan berdasarkan waktu (FIFO)
    const queue = await db.syncQueue.orderBy('timestamp').toArray();

    if (queue.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`[SW] Memulai background sync untuk ${queue.length} antrean.`);

    for (const item of queue) {
      // item.payload berisi record lengkap (id, module, data, timestamp).
      // Klien mengirim seluruh record sebagai body CREATE agar backend bisa
      // menyimpannya utuh. Token diambil dari item.token.
      const bodyObj = {
        action: item.action,            // 'CREATE'
        payload: item.payload,          // record {id, module, data, timestamp}
        uuid: item.uuid,
        token: item.token
      };

      try {
        const response = await fetch(gasUrl, {
          method: 'POST',
          // text/plain menghindari CORS preflight ke Apps Script sekaligus
          // TETAP memungkinkan response JSON dibaca klien (bukan opaque).
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(bodyObj)
        });

        // Karena sekarang respons bisa dibaca, kita WAJIB memeriksa status JSON.
        // Hapus dari antrean HANYA jika backend menegaskan sukses.
        let result = null;
        try {
          result = await response.json();
        } catch (parseErr) {
          // Response bukan JSON (mis. halaman error Google). Anggap gagal,
          // jangan hapus — biarkan di antrean untuk dicoba lagi nanti.
          console.error(`[SW] Antrean ${item.uuid}: response non-JSON, ditahan.`);
          await notifyClients_({ type: 'SYNC_ERROR', uuid: item.uuid, message: 'Respons server tidak valid' });
          break;
        }

        if (result && result.status === 'success') {
          // Sukses: hapus dari antrean + update status record lokal → 'synced'
          const recordId = (item.payload && item.payload.id) ? item.payload.id : null;
          if (recordId) {
            try { await db.records.update(recordId, { syncStatus: 'synced' }); } catch (updErr) {
              console.warn(`[SW] Tidak bisa update record ${recordId}: mungkin sudah dihapus auto-refresh.`, updErr);
            }
          }
          await db.syncQueue.delete(item.uuid);
          await notifyClients_({ type: 'SYNC_SUCCESS', uuid: item.uuid, recordId: recordId, module: item.payload ? item.payload.module : null });
        } else {
          // Server merespons tapi MENOLAK (mis. 401 token kedaluwarsa / 403 RBAC / error lain).
          // JANGAN hapus — agar data tidak hilang. Beri tahu UI & hentikan loop
          // (biasanya seluruh antrean akan gagal dengan sebab yang sama).
          const msg = (result && result.message) ? result.message : 'Sinkronisasi ditolak server';
          console.error(`[SW] Antrean ${item.uuid} ditolak: ${msg}`);
          await notifyClients_({ type: 'SYNC_ERROR', uuid: item.uuid, message: msg });
          break;
        }
      } catch (err) {
        // Network error (offline / timeout). Antrean tetap dipertahankan.
        console.error(`[SW] Gagal sync antrean ${item.uuid}:`, err);
        await notifyClients_({ type: 'SYNC_ERROR', uuid: item.uuid, message: 'Koneksi gagal, akan dicoba lagi' });
        break;
      }
    }
  } catch (error) {
    console.error("[SW] Terjadi error pada proses sync queue:", error);
  } finally {
    isSyncing = false; // Release Lock
  }
}

// Helper: broadcast pesan ke semua klien (tab yang terbuka).
async function notifyClients_(message) {
  const clientsList = await self.clients.matchAll();
  for (const client of clientsList) {
    client.postMessage(message);
  }
}
