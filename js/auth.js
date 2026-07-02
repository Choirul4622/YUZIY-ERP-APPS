// js/auth.js

// Konstanta Konfigurasi
// Idealnya GAS_URL dipanggil dari environment atau diekspor secara global
const AUTH_URL = 'https://script.google.com/macros/s/AKfycbxr0HvZ6wOPMt_IBawWG68_dBDAnzKvEY2qvnU1lTyAUHkOvoLptiXEwq_Q-ZodjfCH/exec';

document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('login-screen');
  const appLayout = document.getElementById('app-layout');
  const loginForm = document.getElementById('login-form');
  const btnLogin = document.getElementById('btn-login');

  // Cek apakah sudah login
  const token = localStorage.getItem('kiziy_token');
  const user = JSON.parse(localStorage.getItem('kiziy_user'));

  if (token && user) {
    showApp(user.role, user.username);
  } else {
    loginScreen.style.display = 'flex';
    appLayout.style.display = 'none';
  }

  // Handle Login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      
      if (!navigator.onLine) {
        window.showToast('Anda harus Online untuk melakukan Login awal.', 'warning');
        return;
      }
      
      btnLogin.disabled = true;
      btnLogin.textContent = 'Memverifikasi...';
      
      try {
        const response = await fetch(AUTH_URL, {
          method: 'POST',
          // Karena NO-CORS mode sulit membaca json response, 
          // dalam skenario real, Backend GAS harus handle CORS Header (diatur di doPost)
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'LOGIN',
            payload: { username, password }
          })
        });
        
        const result = await response.json();
        
        if (result.status === 'success' && result.token) {
          localStorage.setItem('kiziy_token', result.token);
          localStorage.setItem('kiziy_user', JSON.stringify({
            username: result.user.username,
            role: result.user.role
          }));
          
          window.showToast(`Selamat datang, ${result.user.username}!`, 'success');
          showApp(result.user.role, result.user.username);
        } else {
          window.showToast(result.message || 'Login gagal, kredensial salah.', 'error');
        }
      } catch (err) {
        window.showToast('Gagal menghubungi server.', 'error');
        console.error('Login error:', err);
      } finally {
        btnLogin.disabled = false;
        btnLogin.textContent = 'Masuk';
      }
    });
  }

  function showApp(role, username) {
    loginScreen.style.display = 'none';
    appLayout.style.display = 'flex';
    
    // Set Profile Name
    const avatar = document.querySelector('.user-profile .avatar');
    if (avatar) avatar.textContent = username;

    applyRBAC(role);
  }

  function applyRBAC(role) {
    // Definisi Akses Modul
    const rbacRules = {
      'Superadmin': ['hrd', 'crm', 'pos', 'inventory', 'finance'],
      'Manager': ['hrd', 'crm', 'inventory'],
      'Staff': ['crm', 'pos']
    };

    const allowedModules = rbacRules[role] || [];
    
    // Hide/Show Navigasi
    document.querySelectorAll('.nav-item').forEach(item => {
      const mod = item.dataset.module;
      if (!allowedModules.includes(mod)) {
        item.style.display = 'none'; // Sembunyikan aman dari UI
      } else {
        item.style.display = 'flex';
      }
    });

    // Validasi Rute Awal (Redirect jika modul default tidak diizinkan)
    const currentHash = window.location.hash.replace('#', '') || 'hrd';
    if (!allowedModules.includes(currentHash)) {
      if (allowedModules.length > 0) {
        window.location.hash = allowedModules[0]; // Redirect ke modul pertama yang diizinkan
      }
    }
  }

  // Handle Logout (Tambahkan ke UI jika perlu)
  window.logoutApp = async function() {
    const oldToken = localStorage.getItem('kiziy_token');
    // Hapus sesi di server (best-effort; jangan blokir reload walau gagal/offline)
    if (oldToken && navigator.onLine) {
      try {
        await fetch(AUTH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'LOGOUT', token: oldToken })
        });
      } catch (e) { /* abaikan: tetap logout lokal */ }
    }
    localStorage.removeItem('kiziy_token');
    localStorage.removeItem('kiziy_user');
    window.location.reload();
  };

  // Wire tombol logout di sidebar (jika ada di DOM)
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => window.logoutApp());
  }
});
