const express = require('express');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FAMILIES_FILE = path.join(DATA_DIR, 'families.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/mypage', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mypage.html')));

app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'familyplan-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch { return []; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function generateJoinKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 4; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

// ─── AUTH ───────────────────────────────────────────

app.post('/api/signup', (req, res) => {
  const { id, pass, name, mode, key } = req.body;
  if (!id || !pass || !name) {
    return res.status(400).json({ error: 'ID, 비밀번호, 이름을 모두 입력하세요.' });
  }
  if (!key || key.length !== 4) {
    return res.status(400).json({ error: '4자리 키를 입력하세요.' });
  }

  const users = readJSON(USERS_FILE);
  const families = readJSON(FAMILIES_FILE);

  if (users.find(u => u.id === id)) {
    return res.status(409).json({ error: '이미 사용 중인 ID입니다.' });
  }

  const hashedPass = bcrypt.hashSync(pass, 10);

  if (mode === 'create') {
    if (families.find(f => f.familyId === key)) {
      return res.status(409).json({ error: '이미 사용 중인 그룹 키입니다.' });
    }
    const joinKey = generateJoinKey();
    families.push({
      familyId: key,
      joinKey: joinKey,
      createdBy: id,
      members: [id],
      kickDelegates: [],
      groupName: '',
      theme: { accent: '#03c75a', bgColor: '#f6f6f7' }
    });
    users.push({ id, pass: hashedPass, name, familyId: key });
    writeJSON(USERS_FILE, users);
    writeJSON(FAMILIES_FILE, families);
    return res.json({ success: true, message: '회원가입 완료!', familyId: key, joinKey });
  }

  if (mode === 'join') {
    const family = families.find(f => f.joinKey === key);
    if (!family) {
      return res.status(404).json({ error: '존재하지 않는 참여 키입니다.' });
    }
    if (family.members.includes(id)) {
      return res.status(409).json({ error: '이미 해당 그룹에 참여 중입니다.' });
    }
    family.members.push(id);
    users.push({ id, pass: hashedPass, name, familyId: family.familyId });
    writeJSON(USERS_FILE, users);
    writeJSON(FAMILIES_FILE, families);
    return res.json({ success: true, message: '회원가입 완료!', familyId: family.familyId });
  }

  res.status(400).json({ error: 'mode는 create 또는 join이어야 합니다.' });
});

app.post('/api/login', (req, res) => {
  const { id, pass } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === id);
  if (!user || !bcrypt.compareSync(pass, user.pass)) {
    return res.status(401).json({ error: 'ID 또는 비밀번호가 일치하지 않습니다.' });
  }
  req.session.user = { id: user.id, name: user.name, familyId: user.familyId };
  res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

app.post('/api/user/change-password', requireAuth, (req, res) => {
  const { currentPass, newPass } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.session.user.id);
  if (!user || !bcrypt.compareSync(currentPass, user.pass)) {
    return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
  }
  user.pass = bcrypt.hashSync(newPass, 10);
  writeJSON(USERS_FILE, users);
  res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
});

app.post('/api/user/delete', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  let users = readJSON(USERS_FILE);
  let families = readJSON(FAMILIES_FILE);
  let schedules = readJSON(SCHEDULES_FILE);
  const myFamily = families.find(f => f.members.includes(userId));

  if (myFamily && myFamily.members.length === 1) {
    schedules = schedules.filter(s => s.familyId !== myFamily.familyId);
    families = families.filter(f => f.familyId !== myFamily.familyId);
  } else if (myFamily) {
    if (myFamily.createdBy === userId) {
      return res.status(400).json({ error: '그룹 생성자는 탈퇴할 수 없습니다. 먼저 다른 멤버에게 생성자 권한을 양도하세요.' });
    }
    myFamily.members = myFamily.members.filter(m => m !== userId);
    if (myFamily.kickDelegates) {
      myFamily.kickDelegates = myFamily.kickDelegates.filter(d => d !== userId);
    }
    schedules = schedules.filter(s => !(s.familyId === myFamily.familyId && s.targetUserId === userId && s.createdBy !== userId));
  }

  users = users.filter(u => u.id !== userId);
  writeJSON(USERS_FILE, users);
  writeJSON(FAMILIES_FILE, families);
  writeJSON(SCHEDULES_FILE, schedules);
  req.session.destroy();
  res.json({ success: true });
});

// ─── FAMILY ─────────────────────────────────────────

app.get('/api/family/members', requireAuth, (req, res) => {
  const families = readJSON(FAMILIES_FILE);
  const users = readJSON(USERS_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.json({ members: [] });

  const members = family.members.map(mid => {
    const u = users.find(u => u.id === mid);
    const canKick = (family.kickDelegates || []).includes(mid);
    return { id: mid, name: u ? u.name : mid, isCreator: family.createdBy === mid, canKick };
  });
  res.json({
    members,
    familyId: family.familyId,
    joinKey: family.joinKey,
    createdBy: family.createdBy,
    kickDelegates: family.kickDelegates || [],
    groupName: family.groupName || '',
    theme: family.theme || { accent: '#03c75a', bgColor: '#f6f6f7' }
  });
});

app.post('/api/family/leave', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  let families = readJSON(FAMILIES_FILE);
  let schedules = readJSON(SCHEDULES_FILE);
  const family = families.find(f => f.members.includes(userId));
  if (!family) return res.status(404).json({ error: '소속된 그룹이 없습니다.' });

  if (family.createdBy === userId) {
    return res.status(400).json({ error: '그룹 생성자는 탈퇴할 수 없습니다.' });
  }

  family.members = family.members.filter(m => m !== userId);
  if (family.kickDelegates) {
    family.kickDelegates = family.kickDelegates.filter(d => d !== userId);
  }
  writeJSON(FAMILIES_FILE, families);
  writeJSON(SCHEDULES_FILE, schedules);

  let users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (user) {
    user.familyId = null;
    writeJSON(USERS_FILE, users);
  }
  req.session.user.familyId = null;
  res.json({ success: true });
});

app.post('/api/family/kick', requireAuth, (req, res) => {
  const { targetId } = req.body;
  let families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  const userId = req.session.user.id;
  const kickDelegates = family.kickDelegates || [];
  if (family.createdBy !== userId && !kickDelegates.includes(userId)) {
    return res.status(403).json({ error: '추방 권한이 없습니다.' });
  }
  if (!family.members.includes(targetId)) {
    return res.status(404).json({ error: '대상 멤버를 찾을 수 없습니다.' });
  }
  if (targetId === userId) {
    return res.status(400).json({ error: '자기 자신을 추방할 수 없습니다.' });
  }
  if (family.createdBy === targetId) {
    return res.status(400).json({ error: '그룹장은 추방할 수 없습니다.' });
  }
  if (userId !== family.createdBy && kickDelegates.includes(userId) && kickDelegates.includes(targetId)) {
    return res.status(400).json({ error: '추방 권한이 있는 멤버를 추방할 수 없습니다. 그룹장에게 요청하세요.' });
  }

  family.members = family.members.filter(m => m !== targetId);
  if (kickDelegates.includes(targetId)) {
    family.kickDelegates = kickDelegates.filter(d => d !== targetId);
  }
  writeJSON(FAMILIES_FILE, families);

  let users = readJSON(USERS_FILE);
  const targetUser = users.find(u => u.id === targetId);
  if (targetUser) {
    targetUser.familyId = null;
    writeJSON(USERS_FILE, users);
  }
  res.json({ success: true, message: '추방 완료' });
});

app.put('/api/family/delegate-kick', requireAuth, (req, res) => {
  const { targetId } = req.body;
  let families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.createdBy !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 권한을 위임할 수 있습니다.' });
  }
  if (!family.members.includes(targetId)) {
    return res.status(404).json({ error: '대상 멤버를 찾을 수 없습니다.' });
  }
  if (!family.kickDelegates) family.kickDelegates = [];
  const idx = family.kickDelegates.indexOf(targetId);
  if (idx >= 0) {
    family.kickDelegates.splice(idx, 1);
  } else {
    family.kickDelegates.push(targetId);
  }
  writeJSON(FAMILIES_FILE, families);
  res.json({ success: true, kickDelegates: family.kickDelegates, active: idx < 0 });
});

// ─── SETTINGS ─────────────────────────────────────

app.get('/api/family/settings', requireAuth, (req, res) => {
  const families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.json({ groupName: '', theme: { accent: '#03c75a', bgColor: '#f6f6f7' } });
  res.json({
    groupName: family.groupName || '',
    theme: family.theme || { accent: '#03c75a', bgColor: '#f6f6f7' },
    isCreator: family.createdBy === req.session.user.id
  });
});

app.put('/api/family/settings', requireAuth, (req, res) => {
  let families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.createdBy !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 설정을 변경할 수 있습니다.' });
  }
  const { groupName, theme } = req.body;
  if (groupName !== undefined) family.groupName = String(groupName).slice(0, 30);
  if (theme) {
    if (!family.theme) family.theme = { accent: '#03c75a', bgColor: '#f6f6f7' };
    if (theme.accent && /^#[0-9a-fA-F]{6}$/.test(theme.accent)) family.theme.accent = theme.accent;
    if (theme.bgColor && /^#[0-9a-fA-F]{6}$/.test(theme.bgColor)) family.theme.bgColor = theme.bgColor;
  }
  writeJSON(FAMILIES_FILE, families);
  res.json({ success: true, groupName: family.groupName, theme: family.theme });
});

// ─── SCHEDULES ──────────────────────────────────────

app.get('/api/schedules', requireAuth, (req, res) => {
  const { view, date, userId } = req.query;
  const schedules = readJSON(SCHEDULES_FILE).filter(s => s.familyId === req.session.user.familyId);

  let filtered = schedules;
  if (userId) {
    filtered = filtered.filter(s => s.targetUserId === userId);
  }

  if (view && date) {
    const targetDate = new Date(date);
    filtered = filtered.filter(s => {
      const sDate = new Date(s.date);
      switch (view) {
        case 'day': return sDate.toDateString() === targetDate.toDateString();
        case 'week': {
          const startOfWeek = new Date(targetDate);
          startOfWeek.setDate(targetDate.getDate() - targetDate.getDay());
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);
          startOfWeek.setHours(0, 0, 0, 0);
          return sDate >= startOfWeek && sDate <= endOfWeek;
        }
        case 'month': return sDate.getFullYear() === targetDate.getFullYear() && sDate.getMonth() === targetDate.getMonth();
        case 'year': return sDate.getFullYear() === targetDate.getFullYear();
        default: return true;
      }
    });
  }

  res.json({ schedules: filtered });
});

app.get('/api/schedules/today', requireAuth, (req, res) => {
  const today = new Date().toDateString();
  const schedules = readJSON(SCHEDULES_FILE).filter(s =>
    s.familyId === req.session.user.familyId &&
    new Date(s.date).toDateString() === today
  );
  res.json({ today: schedules, count: schedules.length });
});

app.get('/api/schedules/search', requireAuth, (req, res) => {
  const { q, userId: filterUserId, dateFrom, dateTo, status } = req.query;
  let schedules = readJSON(SCHEDULES_FILE).filter(s => s.familyId === req.session.user.familyId);

  if (q) {
    const keyword = q.toLowerCase();
    schedules = schedules.filter(s =>
      s.title.toLowerCase().includes(keyword) ||
      s.requester.toLowerCase().includes(keyword) ||
      s.duration.toLowerCase().includes(keyword)
    );
  }
  if (filterUserId) {
    schedules = schedules.filter(s => s.targetUserId === filterUserId);
  }
  if (dateFrom) {
    schedules = schedules.filter(s => s.date >= dateFrom);
  }
  if (dateTo) {
    schedules = schedules.filter(s => s.date <= dateTo);
  }
  if (status) {
    schedules = schedules.filter(s => status === 'completed' ? s.completed : !s.completed);
  }

  res.json({ schedules });
});

app.post('/api/schedules', requireAuth, (req, res) => {
  const { title, targetUserId, requester, duration, date, time, progress, completed, isRecurring, recurringType, recurringEndDate } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: '일정명과 날짜는 필수입니다.' });
  }

  const families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  const target = targetUserId || req.session.user.id;
  if (!family || !family.members.includes(target)) {
    return res.status(400).json({ error: '유효하지 않은 대상자입니다.' });
  }

  function createSchedule(baseDate) {
    return {
      scheduleId: uuidv4(),
      familyId: req.session.user.familyId,
      title,
      requester: requester || req.session.user.name,
      targetUserId: target,
      duration: duration || '',
      date: baseDate,
      time: time || '',
      progress: progress || 0,
      completed: completed || false,
      isRecurring: isRecurring || false,
      recurringType: recurringType || null,
      recurringEndDate: recurringEndDate || null,
      createdBy: req.session.user.id,
      createdAt: new Date().toISOString()
    };
  }

  const schedules = readJSON(SCHEDULES_FILE);
  const newSchedules = [];

  if (isRecurring && recurringType && recurringEndDate) {
    const startDate = new Date(date);
    const endDate = new Date(recurringEndDate);
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      newSchedules.push(createSchedule(currentDate.toISOString().split('T')[0]));
      switch (recurringType) {
        case 'daily': currentDate.setDate(currentDate.getDate() + 1); break;
        case 'weekly': currentDate.setDate(currentDate.getDate() + 7); break;
        case 'monthly': currentDate.setMonth(currentDate.getMonth() + 1); break;
        case 'yearly': currentDate.setFullYear(currentDate.getFullYear() + 1); break;
        default: currentDate = new Date(endDate.getTime() + 86400000); break;
      }
    }
  } else {
    newSchedules.push(createSchedule(date));
  }

  schedules.push(...newSchedules);
  writeJSON(SCHEDULES_FILE, schedules);
  res.json({ success: true, schedules: newSchedules });
});

app.put('/api/schedules/:id', requireAuth, (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE);
  const idx = schedules.findIndex(s => s.scheduleId === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });

  const schedule = schedules[idx];
  if (schedule.createdBy !== req.session.user.id && schedule.targetUserId !== req.session.user.id) {
    return res.status(403).json({ error: '수정 권한이 없습니다.' });
  }

  const { title, targetUserId, requester, duration, date, time, progress, completed } = req.body;
  if (title !== undefined) schedule.title = title;
  if (targetUserId !== undefined) schedule.targetUserId = targetUserId;
  if (requester !== undefined) schedule.requester = requester;
  if (duration !== undefined) schedule.duration = duration;
  if (date !== undefined) schedule.date = date;
  if (time !== undefined) schedule.time = time;
  if (progress !== undefined) schedule.progress = progress;
  if (completed !== undefined) schedule.completed = completed;

  schedules[idx] = schedule;
  writeJSON(SCHEDULES_FILE, schedules);
  res.json({ success: true, schedule });
});

app.delete('/api/schedules/:id', requireAuth, (req, res) => {
  let schedules = readJSON(SCHEDULES_FILE);
  const schedule = schedules.find(s => s.scheduleId === req.params.id);
  if (!schedule) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  if (schedule.createdBy !== req.session.user.id) {
    return res.status(403).json({ error: '삭제는 작성자만 가능합니다.' });
  }
  schedules = schedules.filter(s => s.scheduleId !== req.params.id);
  writeJSON(SCHEDULES_FILE, schedules);
  res.json({ success: true });
});

// ─── DATA MANAGEMENT ──────────────────────────────

app.post('/api/schedules/reset', requireAuth, (req, res) => {
  const families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.createdBy !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 초기화할 수 있습니다.' });
  }
  let schedules = readJSON(SCHEDULES_FILE);
  schedules = schedules.filter(s => s.familyId !== req.session.user.familyId);
  writeJSON(SCHEDULES_FILE, schedules);
  res.json({ success: true, message: '모든 일정이 초기화되었습니다.' });
});

app.get('/api/schedules/export', requireAuth, (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE).filter(s => s.familyId === req.session.user.familyId);
  const exportData = {
    exportedAt: new Date().toISOString(),
    familyId: req.session.user.familyId,
    schedules
  };
  res.setHeader('Content-Disposition', 'attachment; filename=familyplans_backup.json');
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

app.post('/api/schedules/import', requireAuth, (req, res) => {
  const families = readJSON(FAMILIES_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.createdBy !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 가져오기할 수 있습니다.' });
  }
  const { schedules: importSchedules } = req.body;
  if (!Array.isArray(importSchedules)) {
    return res.status(400).json({ error: '올바른 일정 데이터가 아닙니다.' });
  }
  const existingSchedules = readJSON(SCHEDULES_FILE).filter(s => s.familyId !== req.session.user.familyId);
  const newSchedules = importSchedules.map(s => ({
    scheduleId: uuidv4(),
    familyId: req.session.user.familyId,
    title: s.title || '',
    requester: s.requester || '',
    targetUserId: s.targetUserId || req.session.user.id,
    duration: s.duration || '',
    date: s.date || '',
    time: s.time || '',
    progress: s.progress || 0,
    completed: s.completed || false,
    isRecurring: s.isRecurring || false,
    recurringType: s.recurringType || null,
    recurringEndDate: s.recurringEndDate || null,
    createdBy: req.session.user.id,
    createdAt: new Date().toISOString()
  }));
  existingSchedules.push(...newSchedules);
  writeJSON(SCHEDULES_FILE, existingSchedules);
  res.json({ success: true, count: newSchedules.length, message: `${newSchedules.length}건의 일정을 가져왔습니다.` });
});

app.get('/api/stats/progress', requireAuth, (req, res) => {
  const schedules = readJSON(SCHEDULES_FILE).filter(s => s.familyId === req.session.user.familyId);
  const families = readJSON(FAMILIES_FILE);
  const users = readJSON(USERS_FILE);
  const family = families.find(f => f.familyId === req.session.user.familyId);
  if (!family) return res.json({ stats: [] });

  const stats = family.members.map(mid => {
    const user = users.find(u => u.id === mid);
    const userSchedules = schedules.filter(s => s.targetUserId === mid);
    const completedCount = userSchedules.filter(s => s.completed).length;
    const totalCount = userSchedules.length;
    const avgProgress = totalCount > 0
      ? Math.round(userSchedules.reduce((sum, s) => sum + s.progress, 0) / totalCount)
      : 0;
    return {
      userId: mid,
      name: user ? user.name : mid,
      total: totalCount,
      completed: completedCount,
      averageProgress: avgProgress
    };
  });

  res.json({ stats });
});

app.use((req, res) => {
  if (req.path === '/') return;
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`FAMILY PLAN server running at http://localhost:${PORT}`);
});
