(function() {
  const changePassForm = document.getElementById('changePassForm');
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');

  if (changePassForm) {
    changePassForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPass = document.getElementById('currentPass').value;
      const newPass = document.getElementById('newPass').value;
      if (!currentPass || !newPass) {
        showError(null, '모두 입력하세요.');
        return;
      }
      if (newPass.length < 4) {
        showError(null, '새 비밀번호는 4자 이상이어야 합니다.');
        return;
      }
      const data = await api('/api/user/change-password', {
        method: 'POST',
        body: { currentPass, newPass }
      });
      if (data.error) { showError(null, data.error); return; }
      showSuccess(null, '비밀번호가 변경되었습니다.');
      document.getElementById('currentPass').value = '';
      document.getElementById('newPass').value = '';
    });
  }

  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
      if (!confirm('정말 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
      const data = await api('/api/user/delete', { method: 'POST' });
      if (data.error) { showError(null, data.error); return; }
      alert('회원 탈퇴가 완료되었습니다.');
      window.location.href = '/';
    });
  }

  (async function loadHeader() {
    const me = await api('/api/me');
    if (!me.user) {
      window.location.href = '/';
      return;
    }
    const header = document.getElementById('header');
    if (header) {
      header.innerHTML = `
        <div class="header" style="margin-bottom:0">
          <h1>FAMILY PLAN</h1>
          <div class="header-nav">
            <span style="font-weight:700;font-size:var(--font-size-lg)">${me.user.name}님</span>
            <a href="/dashboard">대시보드</a>
            <a href="/mypage">마이페이지</a>
            <button id="mypageLogoutBtn">로그아웃</button>
          </div>
        </div>`;
      document.getElementById('mypageLogoutBtn').addEventListener('click', async () => {
        await api('/api/logout', { method: 'POST' });
        window.location.href = '/';
      });
    }
  })();
})();
