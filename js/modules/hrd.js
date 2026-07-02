// Modul HRD & Payroll
window.renderHRD = function(container) {
  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>Absensi Karyawan</h2>
        <p style="color: var(--text-secondary); margin-bottom: 15px; font-size: 13px;">Auto-capture geolocation dan timestamp saat menekan tombol.</p>
        <button id="btn-absen" class="btn">Clock In Sekarang</button>
      </div>

      <div class="card">
        <h2>History Absensi Lokal</h2>
        <table class="data-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Lokasi (Lat, Lng)</th>
              <th>Status Sync</th>
            </tr>
          </thead>
          <tbody id="hrd-table-body">
            <tr><td colspan="3" style="text-align: center;">Memuat data...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Handle Absen
  document.getElementById('btn-absen').addEventListener('click', () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const payload = {
          type: 'CLOCK_IN',
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        await window.saveRecord('HRD', payload);
        loadHRDData();
      }, (error) => {
        window.showToast('Gagal mendapatkan lokasi. Izinkan akses GPS.', 'error');
      });
    } else {
      window.showToast('Geolocation tidak didukung di perangkat ini.', 'warning');
    }
  });

  loadHRDData();
};

async function loadHRDData() {
  const tbody = document.getElementById('hrd-table-body');
  if(!tbody) return;
  
  const records = await db.records.where('module').equals('HRD').reverse().toArray();
  
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">Belum ada data absensi</td></tr>`;
    return;
  }
  
  tbody.innerHTML = records.map(rec => {
    const data = JSON.parse(rec.data);
    const isSynced = rec.syncStatus === 'synced';
    return `
      <tr data-sync-uuid="${escapeHtml(rec.id)}">
        <td>${escapeHtml(new Date(rec.timestamp).toLocaleTimeString())}</td>
        <td>${data.lat ? escapeHtml(data.lat.toFixed(4) + ', ' + data.lng.toFixed(4)) : '-'}</td>
        <td class="sync-badge" style="color: ${isSynced ? 'var(--success)' : 'var(--warning)'}">${isSynced ? '✔' : '⏳'}</td>
      </tr>
    `;
  }).join('');
}
