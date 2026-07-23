(function() {
  const path = window.location.pathname;

  if (path === '/' || path === '/index.html') {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('loginId').value.trim();
        const pass = document.getElementById('loginPass').value;
        if (!id || !pass) {
          showError(null, '아이디와 비밀번호를 입력하세요.');
          return;
        }
        const data = await api('/api/login', { method: 'POST', body: { id, pass } });
        if (data.error) { showError(null, data.error); return; }
        window.location.href = '/dashboard';
      });
    }
  }

  if (path === '/signup' || path === '/signup.html') {
    let mode = 'create';
    const modeTabs = document.getElementById('modeTabs');
    if (modeTabs) {
      modeTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-mode]');
        if (!btn) return;
        mode = btn.dataset.mode;
        modeTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const label = document.getElementById('keyLabel');
        const hint = document.getElementById('keyHint');
        if (mode === 'create') {
          label.textContent = '그룹 키 (4자리)';
          hint.textContent = '새로운 가족 그룹을 생성할 4자리 키입니다. 다른 가족원과 공유하지 마세요.';
        } else {
          label.textContent = '참여 키 (4자리)';
          hint.textContent = '가족 그룹 생성자에게 받은 4자리 참여 키를 입력하세요.';
        }
      });
    }

    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('signupId').value.trim();
        const pass = document.getElementById('signupPass').value;
        const name = document.getElementById('signupName').value.trim();
        const key = document.getElementById('keyInput').value.trim();
        if (!id || !pass || !name || !key) {
          showError(null, '모든 항목을 입력하세요.');
          return;
        }
        if (key.length !== 4) {
          showError(null, '4자리 키를 입력하세요.');
          return;
        }
        const data = await api('/api/signup', { method: 'POST', body: { id, pass, name, mode, key } });
        if (data.error) { showError(null, data.error); return; }
        if (mode === 'create' && data.joinKey) {
          const msg = `회원가입 완료! 참여 키: <strong>${data.joinKey}</strong> (가족원에게 공유하세요)`;
          document.getElementById('successMsg').innerHTML = msg;
          document.getElementById('successMsg').classList.add('show');
        } else {
          showSuccess(null, data.message || '회원가입 완료!');
        }
        setTimeout(() => { window.location.href = '/'; }, 2500);
      });
    }
  }
})();
