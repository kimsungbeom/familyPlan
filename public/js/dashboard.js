(function() {
  let currentView = 'day';
  let currentDate = new Date();
  let members = [];
  let allSchedules = [];
  let chartInstances = {};

  const container = document.getElementById('calendarContainer');
  const navLabel = document.getElementById('currentLabel');
  const scheduleListEl = document.getElementById('scheduleList');
  const emptyState = document.getElementById('emptyState');
  const modal = document.getElementById('scheduleModal');
  const progressSection = document.getElementById('progressSection');
  const searchInput = document.getElementById('searchInput');
  const filterUser = document.getElementById('filterUser');
  const filterDateFrom = document.getElementById('filterDateFrom');
  const filterDateTo = document.getElementById('filterDateTo');
  const filterStatus = document.getElementById('filterStatus');
  const schedRecurring = document.getElementById('schedRecurring');
  const recurEndGroup = document.getElementById('recurEndGroup');

  let currentUserId = '';
  let backupTimer = null;
  let autoBackupEnabled = true;
  let currentFamilyId = '';

  async function init() {
    const me = await api('/api/me');
    if (!me.user) { window.location.href = '/'; return; }
    currentUserId = me.user.id;

    const hdr = document.getElementById('header');
    if (hdr) {
      hdr.innerHTML = `<div class="header" style="margin-bottom:0">
        <h1>FAMILY PLAN</h1>
        <div class="header-nav">
          <span style="font-weight:700;font-size:var(--font-size-lg)">${me.user.name}님</span>
          <a href="/dashboard">대시보드</a>
          <a href="/mypage">마이페이지</a>
          <button id="logoutBtn">로그아웃</button>
        </div></div>`;
      document.getElementById('logoutBtn').addEventListener('click', async () => {
        await api('/api/logout', { method: 'POST' });
        window.location.href = '/';
      });
    }

    const famData = await api('/api/family/members');
    members = famData.members || [];
    currentFamilyId = famData.familyId || '';
    document.getElementById('joinKeyDisplay').textContent = famData.joinKey || '----';
    renderFamilyPanel(famData, currentUserId);

    const settingsData = await api('/api/family/settings');
    applyTheme(settingsData.theme);
    updateGroupName(settingsData.groupName);
    if (settingsData.isCreator) {
      document.getElementById('settingsBtn').style.display = '';
    }

    setupSettingsModal();
    setupDataManagement();

    filterUser.innerHTML = '<option value="">전체 대상자</option>';
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      filterUser.appendChild(opt);
    });

    await loadAll();
    checkLocalBackup();
    startAutoBackup();

    document.getElementById('viewTabs').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      currentView = btn.dataset.view;
      document.querySelectorAll('#viewTabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAll();
    });

    document.getElementById('prevBtn').addEventListener('click', () => { navigate(-1); });
    document.getElementById('nextBtn').addEventListener('click', () => { navigate(1); });

    document.getElementById('addScheduleBtn').addEventListener('click', () => openModal());
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.getElementById('scheduleForm').addEventListener('submit', saveSchedule);

    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    schedRecurring.addEventListener('change', () => {
      recurEndGroup.style.display = schedRecurring.value ? 'block' : 'none';
    });

    document.getElementById('schedProgress').addEventListener('input', (e) => {
      document.getElementById('schedProgressVal').textContent = e.target.value + '%';
    });

    searchInput.addEventListener('input', debounce(loadSchedules, 300));
    filterUser.addEventListener('change', loadSchedules);
    filterDateFrom.addEventListener('change', loadSchedules);
    filterDateTo.addEventListener('change', loadSchedules);
    filterStatus.addEventListener('change', loadSchedules);

    document.getElementById('todayBadge').addEventListener('click', () => {
      currentView = 'day';
      currentDate = new Date();
      document.querySelectorAll('#viewTabs button').forEach(b => b.classList.remove('active'));
      document.querySelector('#viewTabs button[data-view="day"]').classList.add('active');
      loadAll();
    });

    document.getElementById('weekBadge').addEventListener('click', () => {
      currentView = 'week';
      currentDate = new Date();
      document.querySelectorAll('#viewTabs button').forEach(b => b.classList.remove('active'));
      document.querySelector('#viewTabs button[data-view="week"]').classList.add('active');
      loadAll();
    });

    document.getElementById('toggleFamilyBtn').addEventListener('click', () => {
      const list = document.getElementById('memberList');
      const toggleBtn = document.getElementById('toggleFamilyBtn');
      if (list.style.display === 'none') {
        list.style.display = 'flex';
        toggleBtn.textContent = '접기';
      } else {
        list.style.display = 'none';
        toggleBtn.textContent = '펼치기';
      }
    });
  }

  function renderFamilyPanel(data, currentUserId) {
    const panel = document.getElementById('familyPanel');
    if (!data.members || data.members.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    const kickDelegates = data.kickDelegates || [];
    const isCreator = data.createdBy === currentUserId;
    const canIKick = isCreator || kickDelegates.includes(currentUserId);

    const list = document.getElementById('memberList');
    list.innerHTML = data.members.map(m => {
      const isMe = m.id === currentUserId;
      const isMemberCreator = m.isCreator;
      const canKickThis = canIKick && !isMe && !isMemberCreator;
      const hasDelegate = kickDelegates.includes(m.id);

      return `<div class="member-item">
        <div class="member-info">
          <span class="member-name">${m.name}</span>
          <span class="member-role">${m.isCreator ? '(그룹장)' : ''}</span>
          ${hasDelegate ? '<span class="member-role" style="color:#03c75a">(추방권한)</span>' : ''}
        </div>
        <div class="member-actions">
          ${isCreator && !isMe && !isMemberCreator ? `<button class="btn btn-outline btn-sm delegate-btn" data-id="${m.id}">${hasDelegate ? '권한해제' : '추방권한'}</button>` : ''}
          ${canKickThis ? `<button class="btn btn-outline btn-sm kick-btn" data-id="${m.id}">추방</button>` : ''}
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.delegate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await api('/api/family/delegate-kick', { method: 'PUT', body: { targetId: btn.dataset.id } });
        if (res.error) { alert(res.error); return; }
        const famData = await api('/api/family/members');
        members = famData.members || [];
        renderFamilyPanel(famData, currentUserId);
      });
    });

    list.querySelectorAll('.kick-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('정말 추방하시겠습니까?')) return;
        const res = await api('/api/family/kick', { method: 'POST', body: { targetId: btn.dataset.id } });
        if (res.error) { alert(res.error); return; }
        window.location.reload();
      });
    });
  }

  async function loadAll() {
    await loadSchedules();
    loadProgressStats();
    loadAlerts();

    const dateStr = currentDate.toISOString().split('T')[0];
    if (currentView === 'year') {
      renderYearView();
    } else if (currentView === 'day') {
      renderDayView();
      navLabel.textContent = `${currentDate.getFullYear()}년 ${currentDate.getMonth()+1}월 ${currentDate.getDate()}일 (${DAY_KO[currentDate.getDay()]})`;
    } else if (currentView === 'week') {
      renderWeekView();
      const weekDates = getWeekDates(currentDate);
      const d1 = new Date(weekDates[0]); const d7 = new Date(weekDates[6]);
      navLabel.textContent = `${d1.getMonth()+1}월 ${d1.getDate()}일 - ${d7.getMonth()+1}월 ${d7.getDate()}일`;
    } else if (currentView === 'month') {
      renderMonthView();
      navLabel.textContent = `${currentDate.getFullYear()}년 ${currentDate.getMonth()+1}월`;
    }
  }

  function navigate(dir) {
    switch (currentView) {
      case 'day': currentDate.setDate(currentDate.getDate() + dir); break;
      case 'week': currentDate.setDate(currentDate.getDate() + (dir * 7)); break;
      case 'month': currentDate.setMonth(currentDate.getMonth() + dir); break;
      case 'year': currentDate.setFullYear(currentDate.getFullYear() + dir); break;
    }
    loadAll();
  }

  async function loadSchedules() {
    const dateStr = currentDate.toISOString().split('T')[0];
    const q = searchInput.value.trim();
    const userId = filterUser.value;
    const dFrom = filterDateFrom.value;
    const dTo = filterDateTo.value;
    const status = filterStatus.value;

    let data;
    if (q || userId || dFrom || dTo) {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (userId) params.set('userId', userId);
      if (dFrom) params.set('dateFrom', dFrom);
      if (dTo) params.set('dateTo', dTo);
      if (status) params.set('status', status);
      data = await api(`/api/schedules/search?${params}`);
    } else {
      data = await api(`/api/schedules?view=${currentView}&date=${dateStr}${userId ? '&userId=' + userId : ''}`);
    }
    allSchedules = data.schedules || [];
    if (status) {
      allSchedules = allSchedules.filter(s => status === 'completed' ? s.completed : !s.completed);
    }
    renderScheduleList();
  }

  function renderScheduleList() {
    scheduleListEl.innerHTML = '';
    emptyState.style.display = 'none';
    if (allSchedules.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    allSchedules.sort((a, b) => new Date(a.date) - new Date(b.date) || (a.time || '').localeCompare(b.time || ''));
    allSchedules.forEach(s => {
      const targetUser = members.find(m => m.id === s.targetUserId);
      const targetName = targetUser ? targetUser.name : s.targetUserId;
      const createdBy = s.createdBy === s.targetUserId ? '본인' : (members.find(m => m.id === s.createdBy) || {}).name || '-';
      const isMine = s.targetUserId === currentUserId;
      const canEdit = s.createdBy === currentUserId || s.targetUserId === currentUserId;

      const div = document.createElement('div');
      div.className = 'schedule-item' + (s.completed ? ' completed' : '');
      div.innerHTML = `
        <div class="check">
          <input type="checkbox" ${s.completed ? 'checked' : ''} data-id="${s.scheduleId}" ${!canEdit ? 'disabled' : ''}>
        </div>
        <div class="info">
          <div class="title">${s.title} ${s.isRecurring ? '<span class="recur-icon" title="반복 일정">&#x1F504;</span>' : ''}</div>
          <div class="meta">
            ${s.date} ${s.time || ''} | ${s.requester || '-'} → ${targetName}${!isMine ? ' [대리]' : ''} | ${s.duration || '-'} | 작성: ${createdBy}
          </div>
        </div>
        <div class="progress-bar">
          <input type="range" min="0" max="100" value="${s.progress}" data-id="${s.scheduleId}" ${!canEdit ? 'disabled' : ''}>
          <span class="pct">${s.progress}%</span>
        </div>
        <div class="actions">
          ${canEdit ? `<button class="edit" data-id="${s.scheduleId}">수정</button>` : ''}
          ${s.createdBy === currentUserId ? `<button class="delete" data-id="${s.scheduleId}">삭제</button>` : ''}
        </div>`;

      scheduleListEl.appendChild(div);
    });

    scheduleListEl.querySelectorAll('.check input').forEach(cb => {
      cb.addEventListener('change', async () => {
        const id = cb.dataset.id;
        const s = allSchedules.find(s => s.scheduleId === id);
        if (!s) return;
        await api(`/api/schedules/${id}`, {
          method: 'PUT',
          body: { completed: cb.checked, progress: cb.checked ? 100 : s.progress }
        });
        loadAll();
      });
    });

    scheduleListEl.querySelectorAll('.progress-bar input[type="range"]').forEach(r => {
      r.addEventListener('change', async () => {
        const id = r.dataset.id;
        await api(`/api/schedules/${id}`, { method: 'PUT', body: { progress: parseInt(r.value) } });
        const pct = r.parentElement.querySelector('.pct');
        if (pct) pct.textContent = r.value + '%';
        loadProgressStats();
      });
    });

    scheduleListEl.querySelectorAll('.edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = allSchedules.find(s => s.scheduleId === btn.dataset.id);
        if (s) openModal(s);
      });
    });

    scheduleListEl.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('일정을 삭제하시겠습니까?')) return;
        await api(`/api/schedules/${btn.dataset.id}`, { method: 'DELETE' });
        loadAll();
      });
    });
  }

  async function loadProgressStats() {
    const data = await api('/api/stats/progress');
    const stats = data.stats || [];
    progressSection.innerHTML = '';
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};

    if (stats.length === 0) {
      progressSection.innerHTML = '<div class="empty-state" style="padding:16px"><p>가족 그룹에 가입하면 진행률을 확인할 수 있습니다.</p></div>';
      return;
    }

    stats.forEach(s => {
      const card = document.createElement('div');
      card.className = 'progress-card';
      card.innerHTML = `
        <div class="name">${s.name}</div>
        <div class="progress-circle"><canvas id="chart-${s.userId}"></canvas></div>
        <div class="details">완료 ${s.completed}/${s.total}건</div>`;
      progressSection.appendChild(card);

      const ctx = document.getElementById(`chart-${s.userId}`);
      if (ctx) {
        const done = s.completed || 0;
        const remain = Math.max(0, s.total - done);
        chartInstances[s.userId] = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['완료', '진행중'],
            datasets: [{
              data: [done, remain],
              backgroundColor: ['#03c75a', '#e0e0e0'],
              borderWidth: 0,
              borderRadius: 2
            }]
          },
          options: {
            cutout: '65%',
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false }
            },
            events: []
      }
    });

    document.getElementById('restoreFromLocalBtn').addEventListener('click', async () => {
      const backup = loadLocalBackup();
      if (backup) {
        await restoreFromBackup(backup);
        document.getElementById('restoreBanner').style.display = 'none';
      }
    });

    document.getElementById('dismissRestoreBtn').addEventListener('click', () => {
      document.getElementById('restoreBanner').style.display = 'none';
    });
  }
    });
  }

  async function loadAlerts() {
    const todayData = await api('/api/schedules/today');
    document.getElementById('todayCount').textContent = todayData.count || 0;

    const todayDate = new Date();
    const weekAgo = new Date(todayDate);
    weekAgo.setDate(todayDate.getDate() - todayDate.getDay());
    const weekEnd = new Date(weekAgo);
    weekEnd.setDate(weekAgo.getDate() + 6);
    const all = await api(`/api/schedules?view=week&date=${todayDate.toISOString().split('T')[0]}`);
    document.getElementById('weekCount').textContent = (all.schedules || []).length;
  }

  function openModal(schedule = null) {
    const targetSelect = document.getElementById('schedTarget');
    targetSelect.innerHTML = members.map(m =>
      `<option value="${m.id}" ${m.id === currentUserId ? 'selected' : ''}>${m.name}</option>`
    ).join('');

    if (schedule) {
      document.getElementById('modalTitle').textContent = '일정 수정';
      document.getElementById('editScheduleId').value = schedule.scheduleId;
      document.getElementById('schedTitle').value = schedule.title;
      document.getElementById('schedTarget').value = schedule.targetUserId;
      document.getElementById('schedRequester').value = schedule.requester;
      document.getElementById('schedDuration').value = schedule.duration;
      document.getElementById('schedDate').value = schedule.date;
      document.getElementById('schedTime').value = schedule.time || '';
      document.getElementById('schedProgress').value = schedule.progress;
      document.getElementById('schedProgressVal').textContent = schedule.progress + '%';
      document.getElementById('schedCompleted').checked = schedule.completed;
      document.getElementById('schedRecurring').value = '';
      document.getElementById('schedRecurEnd').value = '';
      recurEndGroup.style.display = 'none';
    } else {
      document.getElementById('modalTitle').textContent = '일정 추가';
      document.getElementById('editScheduleId').value = '';
      document.getElementById('scheduleForm').reset();
      document.getElementById('schedDate').value = getToday();
      document.getElementById('schedProgress').value = 0;
      document.getElementById('schedProgressVal').textContent = '0%';
      document.getElementById('schedCompleted').checked = false;
      document.getElementById('schedRecurring').value = '';
      document.getElementById('schedRecurEnd').value = '';
      recurEndGroup.style.display = 'none';
    }
    modal.style.display = 'flex';
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  async function saveSchedule(e) {
    e.preventDefault();
    const editId = document.getElementById('editScheduleId').value;
    const recurring = document.getElementById('schedRecurring').value;
    const body = {
      title: document.getElementById('schedTitle').value.trim(),
      targetUserId: document.getElementById('schedTarget').value,
      requester: document.getElementById('schedRequester').value.trim(),
      duration: document.getElementById('schedDuration').value.trim(),
      date: document.getElementById('schedDate').value,
      time: document.getElementById('schedTime').value,
      progress: parseInt(document.getElementById('schedProgress').value),
      completed: document.getElementById('schedCompleted').checked,
      isRecurring: !!recurring,
      recurringType: recurring || null,
      recurringEndDate: recurring ? document.getElementById('schedRecurEnd').value : null
    };

    if (editId) {
      const data = await api(`/api/schedules/${editId}`, { method: 'PUT', body });
      if (data.error) { alert(data.error); return; }
    } else {
      const data = await api('/api/schedules', { method: 'POST', body });
      if (data.error) { alert(data.error); return; }
    }
    closeModal();
    loadAll();
  }

  // CALENDAR RENDERERS
  function renderDayView() {
    container.innerHTML = '';
  }

  function renderWeekView() {
    const dates = getWeekDates(currentDate);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    container.innerHTML = `<div class="calendar-grid" style="grid-template-columns:repeat(7,1fr)">
      ${dayNames.map(d => `<div class="day-header">${d}</div>`).join('')}
      ${dates.map(d => {
        const dd = new Date(d);
        const isToday = d === getToday();
        const hasSch = allSchedules.some(s => s.date === d);
        const isSel = d === currentDate.toISOString().split('T')[0];
        return `<div class="calendar-day${isToday ? ' today' : ''}${hasSch ? ' has-schedule' : ''}${isSel ? ' selected' : ''}" data-date="${d}">
          ${dd.getDate()}
        </div>`;
      }).join('')}
    </div>`;

    container.querySelectorAll('.calendar-day').forEach(el => {
      el.addEventListener('click', () => {
        currentView = 'day';
        currentDate = new Date(el.dataset.date + 'T00:00:00');
        document.querySelectorAll('#viewTabs button').forEach(b => b.classList.remove('active'));
        document.querySelector('#viewTabs button[data-view="day"]').classList.add('active');
        loadAll();
      });
    });
  }

  function renderMonthView() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const today = getToday();

    let html = '<div class="calendar-grid">';
    dayNames.forEach(d => { html += `<div class="day-header">${d}</div>`; });
    for (let i = 0; i < startPad; i++) {
      html += '<div class="calendar-day other-month"></div>';
    }
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === today;
      const hasSch = allSchedules.some(s => s.date === dateStr);
      const isSel = dateStr === currentDate.toISOString().split('T')[0];
      html += `<div class="calendar-day${isToday ? ' today' : ''}${hasSch ? ' has-schedule' : ''}${isSel ? ' selected' : ''}" data-date="${dateStr}">${d}</div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.calendar-day').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.date) {
          currentDate = new Date(el.dataset.date + 'T00:00:00');
          loadAll();
        }
      });
    });
  }

  function renderYearView() {
    const year = currentDate.getFullYear();
    let html = '<div class="year-grid">';
    for (let m = 0; m < 12; m++) {
      const monthStr = `${year}-${String(m+1).padStart(2,'0')}`;
      const count = allSchedules.filter(s => s.date.startsWith(monthStr)).length;
      html += `<div class="year-month-card" data-month="${m+1}">
        <div class="month-name">${m+1}월</div>
        <div class="month-count">${count}건</div>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
    navLabel.textContent = `${year}년`;

    container.querySelectorAll('.year-month-card').forEach(el => {
      el.addEventListener('click', () => {
        currentView = 'month';
        currentDate = new Date(year, parseInt(el.dataset.month) - 1, 1);
        document.querySelectorAll('#viewTabs button').forEach(b => b.classList.remove('active'));
        document.querySelector('#viewTabs button[data-view="month"]').classList.add('active');
        loadAll();
      });
    });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement.style;
    if (theme.accent) {
      root.setProperty('--color-accent', theme.accent);
      root.setProperty('--color-accent-hover', adjustBrightness(theme.accent, -10));
    }
    if (theme.bgColor) {
      root.setProperty('--color-surface-raised', theme.bgColor);
    }
    const accent = theme.accent || '#03c75a';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
  }

  function adjustBrightness(hex, amount) {
    const c = hex.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(c.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(c.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(c.substring(4, 6), 16) + amount));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function updateGroupName(groupName) {
    const title = document.getElementById('familyPanelTitle');
    const h1 = document.querySelector('.header h1');
    if (groupName) {
      if (title) title.textContent = groupName + ' 구성원 관리';
      if (h1) h1.textContent = groupName;
    }
  }

  function setupSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsCancelBtn = document.getElementById('settingsCancelBtn');
    const settingsForm = document.getElementById('settingsForm');

    settingsBtn?.addEventListener('click', async () => {
      const data = await api('/api/family/settings');
      document.getElementById('settingsGroupName').value = data.groupName || '';
      document.getElementById('settingsAccent').value = (data.theme && data.theme.accent) || '#03c75a';
      document.getElementById('settingsBgColor').value = (data.theme && data.theme.bgColor) || '#f6f6f7';
      settingsModal.style.display = 'flex';
    });

    settingsCancelBtn?.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });

    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.style.display = 'none';
    });

    settingsForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        groupName: document.getElementById('settingsGroupName').value.trim(),
        theme: {
          accent: document.getElementById('settingsAccent').value,
          bgColor: document.getElementById('settingsBgColor').value
        }
      };
      const res = await api('/api/family/settings', { method: 'PUT', body });
      if (res.error) { alert(res.error); return; }
      applyTheme(res.theme);
      updateGroupName(res.groupName);
      settingsModal.style.display = 'none';
    });
  }

  function setupDataManagement() {
    const exportBtn = document.getElementById('exportBtn');
    const importFile = document.getElementById('importFile');
    const resetBtn = document.getElementById('resetBtn');
    const restoreLocalSettingsBtn = document.getElementById('restoreLocalSettingsBtn');
    const autoBackupToggle = document.getElementById('autoBackupToggle');
    const backupInfo = document.getElementById('backupInfo');
    const dataMsg = document.getElementById('dataMsg');

    updateBackupInfo();

    exportBtn?.addEventListener('click', async () => {
      const res = await fetch('/api/schedules/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'familyplans_backup.json';
      a.click();
      URL.revokeObjectURL(url);
      dataMsg.style.display = 'block';
      dataMsg.style.color = 'var(--color-accent)';
      dataMsg.textContent = '데이터를 파일로 저장했습니다.';
      setTimeout(() => { dataMsg.style.display = 'none'; }, 3000);
    });

    importFile?.addEventListener('change', async () => {
      const file = importFile.files[0];
      if (!file) return;
      if (!confirm('기존 데이터에 추가됩니다. 계속하시겠습니까?')) { importFile.value = ''; return; }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const schedules = parsed.schedules || parsed;
        const res = await api('/api/schedules/import', { method: 'POST', body: { schedules } });
        if (res.error) { dataMsg.style.color = 'var(--color-danger)'; dataMsg.textContent = res.error; }
        else { dataMsg.style.color = 'var(--color-accent)'; dataMsg.textContent = res.message; }
      } catch (e) {
        dataMsg.style.color = 'var(--color-danger)';
        dataMsg.textContent = '파일 형식이 올바르지 않습니다.';
      }
      dataMsg.style.display = 'block';
      importFile.value = '';
      setTimeout(() => { dataMsg.style.display = 'none'; }, 4000);
      loadAll();
    });

    restoreLocalSettingsBtn?.addEventListener('click', async () => {
      const backup = loadLocalBackup();
      if (!backup) {
        dataMsg.style.display = 'block';
        dataMsg.style.color = 'var(--color-danger)';
        dataMsg.textContent = '로컬 백업이 없습니다.';
        setTimeout(() => { dataMsg.style.display = 'none'; }, 3000);
        return;
      }
      await restoreFromBackup(backup, dataMsg);
    });

    autoBackupToggle?.addEventListener('change', () => {
      autoBackupEnabled = autoBackupToggle.checked;
      if (autoBackupEnabled) {
        startAutoBackup();
      } else if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = null;
      }
      localStorage.setItem('fp_autobackup', autoBackupEnabled ? '1' : '0');
    });

    resetBtn?.addEventListener('click', async () => {
      if (!confirm('그룹의 모든 일정 데이터가 삭제됩니다. 정말 초기화하시겠습니까?')) return;
      const res = await api('/api/schedules/reset', { method: 'POST' });
      dataMsg.style.display = 'block';
      if (res.error) {
        dataMsg.style.color = 'var(--color-danger)';
        dataMsg.textContent = res.error;
      } else {
        dataMsg.style.color = 'var(--color-accent)';
        dataMsg.textContent = res.message;
        loadAll();
      }
      setTimeout(() => { dataMsg.style.display = 'none'; }, 3000);
    });
  }

  function getBackupKey() {
    return 'fp_backup_' + currentFamilyId;
  }

  function loadLocalBackup() {
    try {
      const raw = localStorage.getItem(getBackupKey());
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveLocalBackup(schedules) {
    try {
      const backup = {
        updatedAt: new Date().toISOString(),
        familyId: currentFamilyId,
        count: schedules.length,
        schedules
      };
      localStorage.setItem(getBackupKey(), JSON.stringify(backup));
      updateBackupInfo();
    } catch { /* localStorage full */ }
  }

  function updateBackupInfo() {
    const el = document.getElementById('backupInfo');
    if (!el) return;
    const backup = loadLocalBackup();
    if (backup && backup.updatedAt) {
      const d = new Date(backup.updatedAt);
      const ago = Math.floor((Date.now() - d.getTime()) / 60000);
      const timeStr = ago < 1 ? '방금 전' : ago < 60 ? `${ago}분 전` : `${Math.floor(ago/60)}시간 전`;
      el.textContent = `로컬 백업: ${timeStr} (${backup.count}건)`;
    } else {
      el.textContent = '로컬 백업 없음';
    }
  }

  function checkLocalBackup() {
    if (allSchedules.length > 0) {
      document.getElementById('restoreBanner').style.display = 'none';
      return;
    }
    const backup = loadLocalBackup();
    if (backup && backup.schedules && backup.schedules.length > 0) {
      document.getElementById('restoreBanner').style.display = 'block';
    }
  }

  async function startAutoBackup() {
    autoBackupEnabled = localStorage.getItem('fp_autobackup') !== '0';
    document.getElementById('autoBackupToggle').checked = autoBackupEnabled;
    if (backupTimer) clearInterval(backupTimer);
    if (!autoBackupEnabled) return;
    doBackup();
    backupTimer = setInterval(doBackup, 5 * 60 * 1000);
  }

  async function doBackup() {
    if (!autoBackupEnabled) return;
    try {
      const res = await fetch('/api/schedules/search');
      const data = await res.json();
      if (data.schedules) {
        saveLocalBackup(data.schedules);
      }
    } catch { /* network error, skip */ }
  }

  async function restoreFromBackup(backup, dataMsg) {
    if (!backup || !backup.schedules || backup.schedules.length === 0) return;
    try {
      const res = await api('/api/schedules/import', { method: 'POST', body: { schedules: backup.schedules } });
      if (dataMsg) {
        dataMsg.style.display = 'block';
        dataMsg.style.color = res.error ? 'var(--color-danger)' : 'var(--color-accent)';
        dataMsg.textContent = res.error || res.message;
        setTimeout(() => { dataMsg.style.display = 'none'; }, 3000);
      }
      if (!res.error) loadAll();
    } catch {
      if (dataMsg) {
        dataMsg.style.display = 'block';
        dataMsg.style.color = 'var(--color-danger)';
        dataMsg.textContent = '복원에 실패했습니다.';
        setTimeout(() => { dataMsg.style.display = 'none'; }, 3000);
      }
    }
  }

  init();
})();
