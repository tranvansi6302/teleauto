import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db, initDb } from './database.js';
import {
  startScheduler,
  runAutoCheckInOutAndSendTelegram,
  runCheckForUser,
  sendTelegramMessage,
  getFormattedDateInTimezone
} from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and parsing of JSON bodies
app.use(cors());
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(dirname(__filename) + '/public'));

// --- Settings APIs ---

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const current = await db.getSettings();
    const telegramToken = req.body.telegramToken !== undefined ? req.body.telegramToken : current.telegramToken;
    const telegramChatIds = req.body.telegramChatIds !== undefined ? req.body.telegramChatIds : current.telegramChatIds;
    const timezone = req.body.timezone !== undefined ? req.body.timezone : current.timezone;
    const checkTimes = req.body.checkTimes !== undefined ? req.body.checkTimes : current.checkTimes;
    
    // Validation
    if (!telegramToken) {
      return res.status(400).json({ error: 'Token Telegram không được để trống' });
    }
    if (!Array.isArray(telegramChatIds)) {
      return res.status(400).json({ error: 'Chat IDs phải là một mảng' });
    }
    if (!timezone) {
      return res.status(400).json({ error: 'Múi giờ không được để trống' });
    }
    if (!Array.isArray(checkTimes)) {
      return res.status(400).json({ error: 'Check Times phải là một mảng' });
    }
    
    // Check times formatting
    for (const time of checkTimes) {
      if (typeof time.hour !== 'number' || time.hour < 0 || time.hour > 23 ||
          typeof time.minute !== 'number' || time.minute < 0 || time.minute > 59) {
        return res.status(400).json({ error: 'Định dạng giờ chấm công không hợp lệ' });
      }
    }
    
    const updated = await db.updateSettings({
      telegramToken,
      telegramChatIds,
      timezone,
      checkTimes
    });
    
    // Reload scheduler with new configuration
    await startScheduler();
    
    db.addLog('info', 'Đã cập nhật cấu hình hệ thống và khởi động lại Scheduler.');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/test-telegram', async (req, res) => {
  try {
    const settings = await db.getSettings();
    const timezone = settings.timezone || 'Asia/Ho_Chi_Minh';
    const timeStr = getFormattedDateInTimezone(new Date(), 'yyyy-MM-dd HH:mm:ss', timezone);
    
    const text = `🔔 Tin nhắn thử nghiệm từ Bot Chấm Công Tự Động\n` +
                 `Thời gian: ${timeStr}\n` +
                 `Cấu hình Telegram hoạt động chính xác!`;
                 
    await sendTelegramMessage(text);
    res.json({ success: true, message: 'Đã gửi tin nhắn thử nghiệm' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Users APIs ---

app.get('/api/users', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { empCode, password, fullName, isActive } = req.body;
    if (!empCode || !password) {
      return res.status(400).json({ error: 'Mã nhân viên và mật khẩu không được trống' });
    }
    
    const user = await db.addUser({
      empCode: String(empCode).trim(),
      password: String(password).trim(),
      fullName: String(fullName || '').trim(),
      isActive: isActive !== undefined ? isActive : true
    });
    
    db.addLog('info', `Đã thêm tài khoản nhân viên: ${empCode} (${fullName || 'Chưa cập nhật'})`);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:empCode', async (req, res) => {
  try {
    const { empCode } = req.params;
    const { password, fullName, isActive } = req.body;
    
    const updated = await db.updateUser(empCode, {
      ...(password !== undefined && { password: String(password).trim() }),
      ...(fullName !== undefined && { fullName: String(fullName).trim() }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) })
    });
    
    db.addLog('info', `Đã cập nhật tài khoản: ${empCode}`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:empCode', async (req, res) => {
  try {
    const { empCode } = req.params;
    await db.deleteUser(empCode);
    db.addLog('info', `Đã xóa tài khoản nhân viên: ${empCode}`);
    res.json({ success: true, message: 'Đã xóa người dùng thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to check login to ERP immediately (pre-check credentials)
app.post('/api/users/test-login', async (req, res) => {
  const { empCode, password } = req.body;
  if (!empCode || !password) {
    return res.status(400).json({ success: false, message: 'Mã nhân viên và mật khẩu không được trống' });
  }
  
  try {
    const LOGIN_API = 'https://api.365erp.vn/v1/hrm/Employee/Login';
    const response = await fetch(LOGIN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        empCode: String(empCode).trim(),
        password: String(password).trim()
      })
    });
    
    const status = response.status;
    const text = await response.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.json({ success: false, message: 'Response ERP không hợp lệ (không phải JSON)' });
    }
    
    if (status === 200 && data.id && data.token) {
      res.json({
        success: true,
        fullName: data.fullName || '',
        employeeId: data.id
      });
    } else {
      res.json({
        success: false,
        message: data.message || 'Đăng nhập ERP thất bại'
      });
    }
  } catch (error) {
    res.json({ success: false, message: `Lỗi kết nối ERP: ${error.message}` });
  }
});

// --- Leaves APIs ---

app.get('/api/leaves', async (req, res) => {
  try {
    const leaves = await db.getLeaves();
    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/leaves', async (req, res) => {
  try {
    const { empCode, date, type } = req.body;
    
    if (!empCode || !date || !type) {
      return res.status(400).json({ error: 'Mã nhân viên, ngày nghỉ, và loại nghỉ là bắt buộc' });
    }
    
    const leaveTypes = ['Cả ngày', 'Buổi sáng', 'Buổi chiều'];
    if (!leaveTypes.includes(type)) {
      return res.status(400).json({ error: 'Loại nghỉ không hợp lệ' });
    }
    
    const leave = await db.addLeave({
      empCode: String(empCode).trim(),
      date: String(date).trim(), // YYYY-MM-DD
      type: type
    });
    
    db.addLog('info', `Đã thêm lịch nghỉ: ${empCode} nghỉ ${type} ngày ${date}`);
    res.json(leave);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/leaves/:empCode/:date', async (req, res) => {
  try {
    const { empCode, date } = req.params;
    await db.deleteLeave(empCode, date);
    db.addLog('info', `Đã xóa lịch nghỉ của ${empCode} ngày ${date}`);
    res.json({ success: true, message: 'Đã xóa lịch nghỉ thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// --- Trigger APIs ---

app.post('/api/trigger', async (req, res) => {
  try {
    const results = await runAutoCheckInOutAndSendTelegram(true);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/trigger/:empCode', async (req, res) => {
  try {
    const { empCode } = req.params;
    const users = await db.getUsers();
    const user = users.find(u => u.empCode === empCode);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này' });
    }
    
    const settings = await db.getSettings();
    const timezone = settings.timezone || 'Asia/Ho_Chi_Minh';
    
    db.addLog('info', `🤖 Kích hoạt chấm công thủ công cho nhân viên ${empCode} (${user.fullName})`);
    const result = await runCheckForUser(user, timezone);
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Express server and initial scheduler
app.listen(PORT, async () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  try {
    await initDb();
  } catch (err) {
    console.error('Failed to initialize database on startup:', err);
  }
  db.addLog('info', `Hệ thống bot bắt đầu hoạt động trên cổng ${PORT}.`);
  await startScheduler();
});
