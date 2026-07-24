require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const path = require('path');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pageRoutes = {
  '/': 'index.html',
  '/signup': 'signup.html',
  '/dashboard': 'dashboard.html',
  '/mypage': 'mypage.html'
};

Object.entries(pageRoutes).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
  app.get(route + '.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(session({
  secret: 'familyplan-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  store: new MemoryStore({ checkPeriod: 86400000 }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

function generateJoinKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 4; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function mapSchedule(s) {
  return {
    scheduleId: s.schedule_id,
    familyId: s.family_id,
    title: s.title,
    requester: s.requester,
    targetUserId: s.target_user_id,
    duration: s.duration,
    date: s.scheduled_date,
    time: s.scheduled_time,
    progress: s.progress,
    completed: s.completed,
    isRecurring: s.is_recurring,
    recurringType: s.recurring_type,
    recurringEndDate: s.recurring_end_date,
    createdBy: s.created_by,
    createdAt: s.created_at
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

// ─── AUTH ───────────────────────────────────────────

app.post('/api/signup', async (req, res) => {
  const { id, pass, name, mode, key } = req.body;
  if (!id || !pass || !name) {
    return res.status(400).json({ error: 'ID, 비밀번호, 이름을 모두 입력하세요.' });
  }
  if (!key || key.length !== 4) {
    return res.status(400).json({ error: '4자리 키를 입력하세요.' });
  }

  const { data: existingUser } = await supabase.from('users').select('id').eq('id', id).maybeSingle();
  if (existingUser) {
    return res.status(409).json({ error: '이미 사용 중인 ID입니다.' });
  }

  const hashedPass = bcrypt.hashSync(pass, 10);

  if (mode === 'create') {
    const { data: existingFamily } = await supabase.from('families').select('family_id').eq('family_id', key).maybeSingle();
    if (existingFamily) {
      return res.status(409).json({ error: '이미 사용 중인 그룹 키입니다.' });
    }
    const joinKey = generateJoinKey();

    const { error: uErr } = await supabase.from('users').insert({
      id, pass: hashedPass, name, family_id: key
    });
    if (uErr) return res.status(500).json({ error: '사용자 등록 실패: ' + uErr.message });

    const { error: fErr } = await supabase.from('families').insert({
      family_id: key, join_key: joinKey, created_by: id
    });
    if (fErr) return res.status(500).json({ error: '그룹 생성 실패: ' + fErr.message });

    const { error: mErr } = await supabase.from('family_members').insert({
      family_id: key, user_id: id
    });
    if (mErr) return res.status(500).json({ error: '멤버 등록 실패: ' + mErr.message });

    return res.json({ success: true, message: '회원가입 완료!', familyId: key, joinKey });
  }

  if (mode === 'join') {
    const { data: family } = await supabase.from('families').select('*').eq('join_key', key).maybeSingle();
    if (!family) {
      return res.status(404).json({ error: '존재하지 않는 참여 키입니다.' });
    }
    const { data: existingMember } = await supabase.from('family_members').select('user_id').eq('family_id', family.family_id).eq('user_id', id).maybeSingle();
    if (existingMember) {
      return res.status(409).json({ error: '이미 해당 그룹에 참여 중입니다.' });
    }
    const { error: uErr } = await supabase.from('users').insert({ id, pass: hashedPass, name, family_id: family.family_id });
    if (uErr) return res.status(500).json({ error: '사용자 등록 실패: ' + uErr.message });
    const { error: mErr } = await supabase.from('family_members').insert({ family_id: family.family_id, user_id: id });
    if (mErr) return res.status(500).json({ error: '멤버 등록 실패: ' + mErr.message });
    return res.json({ success: true, message: '회원가입 완료!', familyId: family.family_id });
  }

  res.status(400).json({ error: 'mode는 create 또는 join이어야 합니다.' });
});

app.post('/api/login', async (req, res) => {
  const { id, pass } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (!user || !bcrypt.compareSync(pass, user.pass)) {
    return res.status(401).json({ error: 'ID 또는 비밀번호가 일치하지 않습니다.' });
  }
  req.session.user = { id: user.id, name: user.name, familyId: user.family_id };
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

app.post('/api/user/change-password', requireAuth, async (req, res) => {
  const { currentPass, newPass } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('id', req.session.user.id).maybeSingle();
  if (!user || !bcrypt.compareSync(currentPass, user.pass)) {
    return res.status(400).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
  }
  await supabase.from('users').update({ pass: bcrypt.hashSync(newPass, 10) }).eq('id', req.session.user.id);
  res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
});

app.post('/api/user/delete', requireAuth, async (req, res) => {
  const userId = req.session.user.id;

  const { data: memberInfo } = await supabase.from('family_members').select('family_id').eq('user_id', userId).maybeSingle();
  if (memberInfo) {
    const { data: family } = await supabase.from('families').select('*').eq('family_id', memberInfo.family_id).maybeSingle();
    if (family) {
      const { count } = await supabase.from('family_members').select('*', { count: 'exact', head: true }).eq('family_id', family.family_id);
      if (count === 1) {
        await supabase.from('schedules').delete().eq('family_id', family.family_id);
        await supabase.from('family_members').delete().eq('family_id', family.family_id);
        await supabase.from('families').delete().eq('family_id', family.family_id);
      } else {
        if (family.created_by === userId) {
          return res.status(400).json({ error: '그룹 생성자는 탈퇴할 수 없습니다. 먼저 다른 멤버에게 생성자 권한을 양도하세요.' });
        }
        await supabase.from('family_members').delete().eq('family_id', family.family_id).eq('user_id', userId);
      }
    }
  }

  await supabase.from('users').delete().eq('id', userId);
  req.session.destroy();
  res.json({ success: true });
});

// ─── FAMILY ─────────────────────────────────────────

app.get('/api/family/members', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ members: [] });

  const { data: family } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  if (!family) return res.json({ members: [] });

  const { data: memberRows } = await supabase.from('family_members').select('user_id, can_kick').eq('family_id', fid);
  const userIds = (memberRows || []).map(m => m.user_id);
  const { data: users } = userIds.length > 0
    ? await supabase.from('users').select('id, name').in('id', userIds)
    : { data: [] };

  const members = (memberRows || []).map(m => {
    const u = (users || []).find(u => u.id === m.user_id);
    return {
      id: m.user_id,
      name: u ? u.name : m.user_id,
      isCreator: family.created_by === m.user_id,
      canKick: m.can_kick
    };
  });

  const kickDelegates = (memberRows || []).filter(m => m.can_kick).map(m => m.user_id);

  res.json({
    members,
    familyId: family.family_id,
    joinKey: family.join_key,
    createdBy: family.created_by,
    kickDelegates,
    groupName: family.group_name || '',
    theme: { accent: family.theme_accent || '#03c75a', bgColor: family.theme_bg_color || '#f6f6f7' }
  });
});

app.post('/api/family/leave', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const fid = req.session.user.familyId;
  if (!fid) return res.status(404).json({ error: '소속된 그룹이 없습니다.' });

  const { data: family } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.created_by === userId) {
    return res.status(400).json({ error: '그룹 생성자는 탈퇴할 수 없습니다.' });
  }

  await supabase.from('family_members').delete().eq('family_id', fid).eq('user_id', userId);
  await supabase.from('users').update({ family_id: null }).eq('id', userId);
  req.session.user.familyId = null;
  res.json({ success: true });
});

app.post('/api/family/kick', requireAuth, async (req, res) => {
  const { targetId } = req.body;
  const userId = req.session.user.id;
  const fid = req.session.user.familyId;
  if (!fid) return res.status(404).json({ error: '그룹이 없습니다.' });

  const { data: family } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });

  const { data: me } = await supabase.from('family_members').select('can_kick').eq('family_id', fid).eq('user_id', userId).maybeSingle();
  const canKick = family.created_by === userId || (me && me.can_kick);
  if (!canKick) return res.status(403).json({ error: '추방 권한이 없습니다.' });

  if (targetId === userId) return res.status(400).json({ error: '자기 자신을 추방할 수 없습니다.' });
  if (family.created_by === targetId) return res.status(400).json({ error: '그룹장은 추방할 수 없습니다.' });

  const { data: targetMember } = await supabase.from('family_members').select('can_kick').eq('family_id', fid).eq('user_id', targetId).maybeSingle();
  if (!targetMember) return res.status(404).json({ error: '대상 멤버를 찾을 수 없습니다.' });

  if (userId !== family.created_by && me && me.can_kick && targetMember.can_kick) {
    return res.status(400).json({ error: '추방 권한이 있는 멤버를 추방할 수 없습니다. 그룹장에게 요청하세요.' });
  }

  await supabase.from('family_members').delete().eq('family_id', fid).eq('user_id', targetId);
  await supabase.from('users').update({ family_id: null }).eq('id', targetId);
  res.json({ success: true, message: '추방 완료' });
});

app.put('/api/family/delegate-kick', requireAuth, async (req, res) => {
  const { targetId } = req.body;
  const fid = req.session.user.familyId;
  if (!fid) return res.status(404).json({ error: '그룹이 없습니다.' });

  const { data: family } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.created_by !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 권한을 위임할 수 있습니다.' });
  }

  const { data: member } = await supabase.from('family_members').select('*').eq('family_id', fid).eq('user_id', targetId).maybeSingle();
  if (!member) return res.status(404).json({ error: '대상 멤버를 찾을 수 없습니다.' });

  const newCanKick = !member.can_kick;
  await supabase.from('family_members').update({ can_kick: newCanKick }).eq('family_id', fid).eq('user_id', targetId);

  const { data: delegates } = await supabase.from('family_members').select('user_id').eq('family_id', fid).eq('can_kick', true);
  res.json({ success: true, kickDelegates: (delegates || []).map(d => d.user_id), active: newCanKick });
});

// ─── SETTINGS ─────────────────────────────────────

app.get('/api/family/settings', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ groupName: '', theme: { accent: '#03c75a', bgColor: '#f6f6f7' } });
  const { data: family } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  if (!family) return res.json({ groupName: '', theme: { accent: '#03c75a', bgColor: '#f6f6f7' } });
  res.json({
    groupName: family.group_name || '',
    theme: { accent: family.theme_accent || '#03c75a', bgColor: family.theme_bg_color || '#f6f6f7' },
    isCreator: family.created_by === req.session.user.id
  });
});

app.put('/api/family/settings', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.status(404).json({ error: '그룹이 없습니다.' });

  const { data: family } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  if (!family) return res.status(404).json({ error: '그룹이 없습니다.' });
  if (family.created_by !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 설정을 변경할 수 있습니다.' });
  }

  const updates = {};
  const { groupName, theme } = req.body;
  if (groupName !== undefined) updates.group_name = String(groupName).slice(0, 30);
  if (theme) {
    if (theme.accent && /^#[0-9a-fA-F]{6}$/.test(theme.accent)) updates.theme_accent = theme.accent;
    if (theme.bgColor && /^#[0-9a-fA-F]{6}$/.test(theme.bgColor)) updates.theme_bg_color = theme.bgColor;
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('families').update(updates).eq('family_id', fid);
  }

  const { data: updated } = await supabase.from('families').select('*').eq('family_id', fid).maybeSingle();
  res.json({
    success: true,
    groupName: updated.group_name || '',
    theme: { accent: updated.theme_accent || '#03c75a', bgColor: updated.theme_bg_color || '#f6f6f7' }
  });
});

// ─── SCHEDULES ──────────────────────────────────────

app.get('/api/schedules', requireAuth, async (req, res) => {
  const { view, date, userId } = req.query;
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ schedules: [] });

  let query = supabase.from('schedules').select('*').eq('family_id', fid);
  if (userId) query = query.eq('target_user_id', userId);

  const { data: schedules } = await query;
  let filtered = schedules || [];

  if (view && date) {
    const targetDate = new Date(date);
    filtered = filtered.filter(s => {
      const sDate = new Date(s.scheduled_date + 'T00:00:00');
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

  res.json({ schedules: filtered.map(mapSchedule) });
});

app.get('/api/schedules/today', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ today: [], count: 0 });
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('schedules').select('*').eq('family_id', fid).eq('scheduled_date', today);
  res.json({ today: (data || []).map(mapSchedule), count: (data || []).length });
});

app.get('/api/schedules/search', requireAuth, async (req, res) => {
  const { q, userId: filterUserId, dateFrom, dateTo, status } = req.query;
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ schedules: [] });

  let query = supabase.from('schedules').select('*').eq('family_id', fid);
  if (filterUserId) query = query.eq('target_user_id', filterUserId);
  if (dateFrom) query = query.gte('scheduled_date', dateFrom);
  if (dateTo) query = query.lte('scheduled_date', dateTo);
  if (q) query = query.or(`title.ilike.%${q}%,requester.ilike.%${q}%,duration.ilike.%${q}%`);

  const { data: schedules } = await query;
  let filtered = schedules || [];

  if (status) {
    filtered = filtered.filter(s => status === 'completed' ? s.completed : !s.completed);
  }

  res.json({ schedules: filtered.map(mapSchedule) });
});

app.post('/api/schedules', requireAuth, async (req, res) => {
  const { title, targetUserId, requester, duration, date, time, progress, completed, isRecurring, recurringType, recurringEndDate } = req.body;
  if (!title || !date) {
    return res.status(400).json({ error: '일정명과 날짜는 필수입니다.' });
  }

  const fid = req.session.user.familyId;
  const target = targetUserId || req.session.user.id;
  const { data: member } = await supabase.from('family_members').select('user_id').eq('family_id', fid).eq('user_id', target).maybeSingle();
  if (!member) {
    return res.status(400).json({ error: '유효하지 않은 대상자입니다.' });
  }

  function buildSchedule(baseDate) {
    return {
      schedule_id: uuidv4(),
      family_id: fid,
      title,
      requester: requester || req.session.user.name,
      target_user_id: target,
      duration: duration || '',
      scheduled_date: baseDate,
      scheduled_time: time || '',
      progress: progress || 0,
      completed: completed || false,
      is_recurring: isRecurring || false,
      recurring_type: recurringType || null,
      recurring_end_date: recurringEndDate || null,
      created_by: req.session.user.id
    };
  }

  const rows = [];
  if (isRecurring && recurringType && recurringEndDate) {
    const startDate = new Date(date);
    const endDate = new Date(recurringEndDate);
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      rows.push(buildSchedule(currentDate.toISOString().split('T')[0]));
      switch (recurringType) {
        case 'daily': currentDate.setDate(currentDate.getDate() + 1); break;
        case 'weekly': currentDate.setDate(currentDate.getDate() + 7); break;
        case 'monthly': currentDate.setMonth(currentDate.getMonth() + 1); break;
        case 'yearly': currentDate.setFullYear(currentDate.getFullYear() + 1); break;
        default: currentDate = new Date(endDate.getTime() + 86400000); break;
      }
    }
  } else {
    rows.push(buildSchedule(date));
  }

  const { error } = await supabase.from('schedules').insert(rows);
  if (error) return res.status(500).json({ error: '일정 저장 실패' });
  res.json({ success: true, schedules: rows.map(mapSchedule) });
});

app.put('/api/schedules/:id', requireAuth, async (req, res) => {
  const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_id', req.params.id).maybeSingle();
  if (!schedule) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });

  if (schedule.created_by !== req.session.user.id && schedule.target_user_id !== req.session.user.id) {
    return res.status(403).json({ error: '수정 권한이 없습니다.' });
  }

  const updates = {};
  const { title, targetUserId, requester, duration, date, time, progress, completed } = req.body;
  if (title !== undefined) updates.title = title;
  if (targetUserId !== undefined) updates.target_user_id = targetUserId;
  if (requester !== undefined) updates.requester = requester;
  if (duration !== undefined) updates.duration = duration;
  if (date !== undefined) updates.scheduled_date = date;
  if (time !== undefined) updates.scheduled_time = time;
  if (progress !== undefined) updates.progress = progress;
  if (completed !== undefined) updates.completed = completed;

  const { data: updated } = await supabase.from('schedules').update(updates).eq('schedule_id', req.params.id).select('*').single();
  res.json({ success: true, schedule: updated ? mapSchedule(updated) : null });
});

app.delete('/api/schedules/:id', requireAuth, async (req, res) => {
  const { data: schedule } = await supabase.from('schedules').select('*').eq('schedule_id', req.params.id).maybeSingle();
  if (!schedule) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  if (schedule.created_by !== req.session.user.id) {
    return res.status(403).json({ error: '삭제는 작성자만 가능합니다.' });
  }
  await supabase.from('schedules').delete().eq('schedule_id', req.params.id);
  res.json({ success: true });
});

// ─── DATA MANAGEMENT ──────────────────────────────

app.post('/api/schedules/reset', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.status(404).json({ error: '그룹이 없습니다.' });
  const { data: family } = await supabase.from('families').select('created_by').eq('family_id', fid).maybeSingle();
  if (!family || family.created_by !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 초기화할 수 있습니다.' });
  }
  await supabase.from('schedules').delete().eq('family_id', fid);
  res.json({ success: true, message: '모든 일정이 초기화되었습니다.' });
});

app.get('/api/schedules/export', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ schedules: [] });
  const { data: schedules } = await supabase.from('schedules').select('*').eq('family_id', fid);
  const exportData = {
    exportedAt: new Date().toISOString(),
    familyId: fid,
    schedules: (schedules || []).map(s => ({
      scheduleId: s.schedule_id,
      familyId: s.family_id,
      title: s.title,
      requester: s.requester,
      targetUserId: s.target_user_id,
      duration: s.duration,
      date: s.scheduled_date,
      time: s.scheduled_time,
      progress: s.progress,
      completed: s.completed,
      isRecurring: s.is_recurring,
      recurringType: s.recurring_type,
      recurringEndDate: s.recurring_end_date,
      createdBy: s.created_by
    }))
  };
  res.setHeader('Content-Disposition', 'attachment; filename=familyplans_backup.json');
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

app.post('/api/schedules/import', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.status(404).json({ error: '그룹이 없습니다.' });
  const { data: family } = await supabase.from('families').select('created_by').eq('family_id', fid).maybeSingle();
  if (!family || family.created_by !== req.session.user.id) {
    return res.status(403).json({ error: '그룹장만 가져오기할 수 있습니다.' });
  }
  const { schedules: importSchedules } = req.body;
  if (!Array.isArray(importSchedules)) {
    return res.status(400).json({ error: '올바른 일정 데이터가 아닙니다.' });
  }
  const rows = importSchedules.map(s => ({
    schedule_id: uuidv4(),
    family_id: fid,
    title: s.title || '',
    requester: s.requester || '',
    target_user_id: s.targetUserId || req.session.user.id,
    duration: s.duration || '',
    scheduled_date: s.date || '',
    scheduled_time: s.time || '',
    progress: s.progress || 0,
    completed: s.completed || false,
    is_recurring: s.isRecurring || false,
    recurring_type: s.recurringType || null,
    recurring_end_date: s.recurringEndDate || null,
    created_by: req.session.user.id
  }));
  const { error } = await supabase.from('schedules').insert(rows);
  if (error) return res.status(500).json({ error: '가져오기 실패' });
  res.json({ success: true, count: rows.length, message: `${rows.length}건의 일정을 가져왔습니다.` });
});

app.get('/api/stats/progress', requireAuth, async (req, res) => {
  const fid = req.session.user.familyId;
  if (!fid) return res.json({ stats: [] });

  const { data: memberRows } = await supabase.from('family_members').select('user_id').eq('family_id', fid);
  if (!memberRows || memberRows.length === 0) return res.json({ stats: [] });

  const userIds = memberRows.map(m => m.user_id);
  const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
  const { data: schedules } = await supabase.from('schedules').select('*').eq('family_id', fid);

  const stats = memberRows.map(m => {
    const user = (users || []).find(u => u.id === m.user_id);
    const userSchedules = (schedules || []).filter(s => s.target_user_id === m.user_id);
    const completedCount = userSchedules.filter(s => s.completed).length;
    const totalCount = userSchedules.length;
    const avgProgress = totalCount > 0
      ? Math.round(userSchedules.reduce((sum, s) => sum + s.progress, 0) / totalCount)
      : 0;
    return {
      userId: m.user_id,
      name: user ? user.name : m.user_id,
      total: totalCount,
      completed: completedCount,
      averageProgress: avgProgress
    };
  });

  res.json({ stats });
});

// ─── FALLBACK ──────────────────────────────────────

app.use((req, res) => {
  const pageRoute = pageRoutes[req.path];
  if (pageRoute) {
    return res.sendFile(path.join(__dirname, 'public', pageRoute));
  }
  if (req.path === '/') return;
  res.redirect('/');
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`FAMILY PLAN server running at http://localhost:${PORT}`);
});
