import cron from 'node-cron';
import { db } from './database.js';

const LOGIN_API = 'https://api.365erp.vn/v1/hrm/Employee/Login';
const ATTENDANCE_HISTORY_API = 'https://api.365erp.vn/v1/hrm/Attendance/AttendanceHistory';
const ATTENDANCE_RECORD_API = 'https://api.365erp.vn/v1/hrm/AttendanceRecord';

// Keep track of active cron tasks
let cronTasks = [];

// Helper to format date in timezone
export function getFormattedDateInTimezone(date, formatStr, timezone = 'Asia/Ho_Chi_Minh') {
  const options = { timeZone: timezone };
  
  const year = new Intl.DateTimeFormat('en-US', { ...options, year: 'numeric' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { ...options, month: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { ...options, day: '2-digit' }).format(date);
  
  const hour24 = new Intl.DateTimeFormat('en-US', { ...options, hour: '2-digit', hour12: false }).format(date);
  const minute = new Intl.DateTimeFormat('en-US', { ...options, minute: '2-digit' }).format(date);
  const second = new Intl.DateTimeFormat('en-US', { ...options, second: '2-digit' }).format(date);
  
  let h = hour24;
  if (h === '24') h = '00';
  
  if (formatStr === 'yyyy-MM-dd') {
    return `${year}-${month}-${day}`;
  }
  if (formatStr === 'HH:mm:ss') {
    return `${h}:${minute}:${second}`;
  }
  if (formatStr === 'H') {
    return parseInt(h, 10).toString();
  }
  if (formatStr === 'm') {
    return parseInt(minute, 10).toString();
  }
  return `${year}-${month}-${day} ${h}:${minute}:${second}`;
}

// Convert sheet-like date into string
function formatSheetDate(value, timezone) {
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return getFormattedDateInTimezone(date, 'yyyy-MM-dd', timezone);
  }
  return String(value).trim();
}

function getTodayTimestampRange(timezone = 'Asia/Ho_Chi_Minh') {
  const dateStr = getFormattedDateInTimezone(new Date(), 'yyyy-MM-dd', timezone);
  
  // Since Vietnam is UTC+7 and doesn't use DST, offset is always +07:00
  const start = new Date(`${dateStr}T00:00:00+07:00`);
  const end = new Date(`${dateStr}T23:59:59.999+07:00`);
  
  return {
    startDate: Math.floor(start.getTime() / 1000),
    endDate: Math.floor(end.getTime() / 1000)
  };
}

function formatTimestamp(timestamp, timezone) {
  return getFormattedDateInTimezone(new Date(timestamp * 1000), 'HH:mm:ss', timezone);
}

async function getTodayRuleForEmployee(empCode, timezone) {
  const leaves = await db.getLeaves();
  const today = getFormattedDateInTimezone(new Date(), 'yyyy-MM-dd', timezone);
  const hour = parseInt(getFormattedDateInTimezone(new Date(), 'H', timezone), 10);
  
  const leave = leaves.find(l => l.empCode.trim() === String(empCode).trim() && formatSheetDate(l.date, timezone) === today);
  const leaveType = leave ? leave.type : null; // 'Cả ngày', 'Buổi sáng', 'Buổi chiều' hoặc null (Không xin nghỉ = Làm cả ngày)
  
  if (leaveType === 'Cả ngày') {
    return {
      allow: false,
      modeText: 'OFF - Nghỉ cả ngày',
      reason: `Ngày ${today} nghỉ cả ngày`
    };
  }

  // Phân loại giờ chạy thành 3 khung giờ: Sáng (8h), Trưa (12h), Chiều/Tối (18h)
  // Quy ước phân chia theo giờ:
  // - Ca Sáng: hour < 10
  // - Ca Trưa: 10 <= hour < 15
  // - Ca Chiều: hour >= 15
  
  if (hour < 10) {
    // CA SÁNG (Chạy lúc 8:00)
    if (leaveType === 'Buổi sáng') {
      return {
        allow: false,
        modeText: 'AM OFF - Nghỉ buổi sáng',
        reason: `Ca sáng lúc ${hour}h: Nhân viên nghỉ ca sáng`
      };
    }
    return {
      allow: true,
      modeText: leaveType ? `AM - ${leaveType}` : 'FULL - Chấm công mặc định'
    };
  } else if (hour >= 10 && hour < 15) {
    // CA TRƯA (Chạy lúc 12:00)
    if (!leaveType) {
      // Nhân viên bình thường làm cả ngày thì bỏ qua ca trưa
      return {
        allow: false,
        modeText: 'FULL - Chấm công mặc định',
        reason: `Ca trưa lúc ${hour}h: Bỏ qua (Nhân viên làm cả ngày chỉ chấm ca sáng và ca chiều)`
      };
    }
    // Nếu có lịch nghỉ buổi:
    // - Nghỉ buổi sáng: ca sáng nghỉ, ca trưa là giờ check-in của ca chiều -> Cho phép chấm.
    // - Nghỉ buổi chiều: ca sáng làm, ca trưa là giờ check-out của ca sáng -> Cho phép chấm.
    return {
      allow: true,
      modeText: `MIDDAY - ${leaveType}`
    };
  } else {
    // CA CHIỀU (Chạy lúc 18:00)
    if (leaveType === 'Buổi chiều') {
      return {
        allow: false,
        modeText: 'PM OFF - Nghỉ buổi chiều',
        reason: `Ca chiều lúc ${hour}h: Nhân viên nghỉ ca chiều`
      };
    }
    return {
      allow: true,
      modeText: leaveType ? `PM - ${leaveType}` : 'FULL - Chấm công mặc định'
    };
  }
}

// API: Login employee
async function loginEmployee(empCode, password) {
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
  } catch (error) {
    throw new Error('Response login không phải JSON');
  }
  
  if (status !== 200 || !data.id || !data.token) {
    throw new Error(data.message || 'Đăng nhập thất bại');
  }
  
  return data;
}

// API: Get attendance history (fetching yesterday and today to handle shifts crossing midnight and late-night check-ins)
async function getAttendanceHistory(employeeId, token, timezone) {
  const dateStr = getFormattedDateInTimezone(new Date(), 'yyyy-MM-dd', timezone);
  const todayStart = new Date(`${dateStr}T00:00:00+07:00`);
  // Subtract 24 hours to get yesterday's start
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(`${dateStr}T23:59:59.999+07:00`);
  
  const startDate = Math.floor(yesterdayStart.getTime() / 1000);
  const endDate = Math.floor(end.getTime() / 1000);
  
  const url = `${ATTENDANCE_HISTORY_API}?EmployeeId=${employeeId}&StartDate=${startDate}&EndDate=${endDate}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (response.status !== 200) {
    throw new Error('Lấy lịch sử chấm công thất bại');
  }
  
  const data = await response.json();
  return data;
}

function buildAttendanceSummary(history, timezone) {
  const data = history.data || [];
  
  // 1. Gather all attendance records across all days in the fetched range
  let allRecords = [];
  data.forEach(dayItem => {
    const records = dayItem.attendanceRecord || [];
    allRecords.push(...records);
  });
  
  // Sort all records chronologically by checkInTime ascending
  allRecords.sort((a, b) => a.checkInTime - b.checkInTime);
  
  // 2. Find the latest record to determine the active check-in state
  const latestRecord = allRecords.length > 0 ? allRecords[allRecords.length - 1] : null;
  const hasActiveCheckIn = latestRecord ? (latestRecord.checkInTime && !latestRecord.checkOutTime) : false;
  
  // 3. Count check-ins and check-outs for TODAY (calendar date) for logging/reporting
  const todayStr = getFormattedDateInTimezone(new Date(), 'yyyy-MM-dd', timezone);
  let checkInTimes = [];
  let checkOutTimes = [];
  
  allRecords.forEach(record => {
    if (record.checkInTime) {
      const recordDate = getFormattedDateInTimezone(new Date(record.checkInTime * 1000), 'yyyy-MM-dd', timezone);
      if (recordDate === todayStr) {
        checkInTimes.push(formatTimestamp(record.checkInTime, timezone));
      }
    }
    if (record.checkOutTime) {
      const recordDate = getFormattedDateInTimezone(new Date(record.checkOutTime * 1000), 'yyyy-MM-dd', timezone);
      if (recordDate === todayStr) {
        checkOutTimes.push(formatTimestamp(record.checkOutTime, timezone));
      }
    }
  });
  
  return {
    hasActiveCheckIn,
    checkInCount: checkInTimes.length,
    checkOutCount: checkOutTimes.length,
    checkInTimes,
    checkOutTimes
  };
}

// API: Check-in / Check-out
async function doCheckInOut(employeeId, token, type) {
  const response = await fetch(ATTENDANCE_RECORD_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    },
    body: JSON.stringify({
      employeeId: employeeId,
      isActived: 1,
      type: type
    })
  });
  
  const status = response.status;
  const text = await response.text();
  
  try {
    const data = JSON.parse(text);
    data._httpStatus = status;
    return data;
  } catch (error) {
    return {
      _httpStatus: status,
      isSuccess: status === 200,
      statusCode: status
    };
  }
}

function isApiSuccess(response) {
  return (
    response &&
    (
      response.isSuccess === true ||
      response.statusCode === 200 ||
      response._httpStatus === 200
    )
  );
}

// Send Telegram Message
export async function sendTelegramMessage(text) {
  const settings = await db.getSettings();
  const botToken = settings.telegramToken;
  const chatIds = settings.telegramChatIds || [];
  
  if (!botToken || chatIds.length === 0) {
    console.log('Skipping Telegram notification (Token or Chat IDs are not configured)');
    return;
  }
  
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  for (const chatId of chatIds) {
    if (!chatId.trim()) continue;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: text
        })
      });
      if (!res.ok) {
        console.error(`Telegram API failed for chatId ${chatId}: ${res.statusText}`);
      }
    } catch (error) {
      console.error(`Error sending Telegram notification to ${chatId}:`, error);
    }
  }
}

// Check in/out for single user
export async function runCheckForUser(user, timezone) {
  const empCode = user.empCode;
  const password = user.password;
  
  const ruleCheck = await getTodayRuleForEmployee(empCode, timezone);
  
  if (!ruleCheck.allow) {
    const logMsg = `⏭️ [${empCode}] ${user.fullName || ''} - Chế độ: ${ruleCheck.modeText} - Kết quả: Bỏ qua chấm công - Lý do: ${ruleCheck.reason}`;
    db.addLog('bypass', logMsg);
    return {
      empCode,
      fullName: user.fullName || empCode,
      status: 'bypass',
      modeText: ruleCheck.modeText,
      message: ruleCheck.reason
    };
  }
  
  try {
    const loginData = await loginEmployee(empCode, password);
    const employeeId = loginData.id;
    const token = loginData.token;
    const fullName = loginData.fullName || user.fullName || '';
    
    // Update fullName in db if empty or changed
    if (fullName && fullName !== user.fullName) {
      await db.updateUser(empCode, { fullName });
    }
    
    const history = await getAttendanceHistory(employeeId, token, timezone);
    const summary = buildAttendanceSummary(history, timezone);
    
    const nextType = summary.hasActiveCheckIn ? false : true;
    const actionText = nextType ? 'CHECK IN' : 'CHECK OUT';
    
    const checkResponse = await doCheckInOut(employeeId, token, nextType);
    
    if (!isApiSuccess(checkResponse)) {
      console.error('[Scheduler Error Details] checkResponse:', JSON.stringify(checkResponse, null, 2));
      let errorDetail = '';
      if (checkResponse && typeof checkResponse === 'object') {
        const msg = checkResponse.message;
        const err = checkResponse.error;
        const detailMsg = typeof msg === 'object' ? JSON.stringify(msg) : msg;
        const detailErr = typeof err === 'object' ? JSON.stringify(err) : err;
        errorDetail = detailMsg || detailErr || JSON.stringify(checkResponse);
      } else {
        errorDetail = String(checkResponse);
      }
      const failMsg = `❌ [${empCode}] ${fullName} - Chế độ: ${ruleCheck.modeText} - ${actionText} thất bại: ${errorDetail}`;
      db.addLog('error', failMsg);
      return {
        empCode,
        fullName,
        status: 'error',
        modeText: ruleCheck.modeText,
        message: `${actionText} thất bại: ${errorDetail}`
      };
    }
    
    const successTime = getFormattedDateInTimezone(new Date(), 'HH:mm:ss', timezone);
    const successMsg = `✅ [${empCode}] ${fullName} - Chế độ: ${ruleCheck.modeText}\n` +
      `Check-in trước đó: ${summary.checkInCount} lần (${summary.checkInTimes.join(', ') || 'Chưa có'})\n` +
      `Check-out trước đó: ${summary.checkOutCount} lần (${summary.checkOutTimes.join(', ') || 'Chưa có'})\n` +
      `🎯 ${actionText} thành công lúc ${successTime}`;
      
    db.addLog('success', successMsg.replace(/\n/g, ' | '));
    return {
      empCode,
      fullName,
      status: 'success',
      modeText: ruleCheck.modeText,
      message: `${actionText} thành công lúc ${successTime}`,
      summary
    };
    
  } catch (error) {
    const errMsg = `❌ [${empCode}] - Lỗi: ${error.message}`;
    db.addLog('error', errMsg);
    return {
      empCode,
      fullName: user.fullName || empCode,
      status: 'error',
      modeText: ruleCheck.modeText,
      message: error.message
    };
  }
}

// Main trigger execution for all users
export async function runAutoCheckInOutAndSendTelegram(isManual = false) {
  const users = (await db.getUsers()).filter(u => u.isActive);
  const settings = await db.getSettings();
  const timezone = settings.timezone || 'Asia/Ho_Chi_Minh';
  const nowStr = getFormattedDateInTimezone(new Date(), 'HH:mm:ss', timezone);
  
  if (users.length === 0) {
    const emptyMsg = '⚠️ Không có tài khoản nào hoạt động để xử lý';
    db.addLog('warning', emptyMsg);
    await sendTelegramMessage(emptyMsg);
    return [];
  }
  
  db.addLog('info', `🤖 Bắt đầu trigger chấm công tự động (${isManual ? 'Thủ công' : 'Theo lịch'}) lúc ${nowStr}`);
  
  let resultList = [];
  let detailedResults = [];
  
  for (const user of users) {
    const res = await runCheckForUser(user, timezone);
    detailedResults.push(res);
    
    if (res.status === 'bypass') {
      resultList.push(
        `⏭️ Đăng nhập thành công\n` +
        `Tên: ${res.fullName}\n` +
        `Mã: ${res.empCode}\n` +
        `Chế độ hôm nay: ${res.modeText}\n` +
        `Kết quả: Bỏ qua chấm công\n` +
        `Lý do: ${res.message}`
      );
    } else if (res.status === 'error') {
      resultList.push(
        `❌ Đăng nhập ${res.message.includes('Đăng nhập') ? 'thất bại' : 'thành công'}\n` +
        `Tên: ${res.fullName}\n` +
        `Mã: ${res.empCode}\n` +
        `Chế độ hôm nay: ${res.modeText}\n` +
        `Kết quả: Lỗi - ${res.message}`
      );
    } else {
      const actionText = res.message.includes('CHECK IN') ? 'CHECK IN' : 'CHECK OUT';
      resultList.push(
        `✅ Đăng nhập thành công\n` +
        `Tên: ${res.fullName}\n` +
        `Mã: ${res.empCode}\n` +
        `Chế độ hôm nay: ${res.modeText}\n` +
        `Check-in trước đó: ${res.summary.checkInCount} lần (${res.summary.checkInTimes.join(', ') || 'Chưa có'})\n` +
        `Check-out trước đó: ${res.summary.checkOutCount} lần (${res.summary.checkOutTimes.join(', ') || 'Chưa có'})\n` +
        `🎯 ${res.message.split('thành công lúc ')[1] ? `${actionText} thành công lúc ${res.message.split('thành công lúc ')[1]}` : res.message}`
      );
    }
  }
  
  const telegramReport = `📌 Kết quả chấm công tự động (${isManual ? 'Thủ công' : 'Tự động'})\n\n${resultList.join('\n\n')}`;
  await sendTelegramMessage(telegramReport);
  
  db.addLog('info', `🤖 Kết thúc trigger chấm công. Đã gửi thông báo Telegram.`);
  return detailedResults;
}

// Setup or re-setup Cron triggers
export async function startScheduler() {
  // Stop existing schedules
  cronTasks.forEach(task => task.stop());
  cronTasks = [];
  
  const settings = await db.getSettings();
  const checkTimes = settings.checkTimes || [];
  const timezone = settings.timezone || 'Asia/Ho_Chi_Minh';
  
  db.addLog('info', `⏰ Khởi động Scheduler với Timezone: ${timezone}. Số lịch trình: ${checkTimes.length}`);
  
  checkTimes.forEach(time => {
    let cronHour = time.hour;
    let cronMinute = time.minute;
    let targetRangeText = '';
    
    // Điều chỉnh đặc biệt cho ca chiều (18:00):
    // Lên lịch trigger lúc 17:45 và chạy với độ trễ ngẫu nhiên 0-15 phút để đảm bảo thực thi trong khoảng 17:45 - 18:00.
    if (time.hour === 18 && time.minute === 0) {
      cronHour = 17;
      cronMinute = 45;
      targetRangeText = '17h45 - 18h00';
    } else {
      // Các ca khác (ví dụ: 8h, 12h) sẽ chạy trễ ngẫu nhiên từ thời gian cài đặt đến +15 phút sau đó
      const endHour = time.hour;
      const endMinute = time.minute + 15;
      const displayEndHour = endMinute >= 60 ? endHour + 1 : endHour;
      const displayEndMinute = endMinute % 60;
      targetRangeText = `${time.hour}h${time.minute.toString().padStart(2, '0')} - ${displayEndHour}h${displayEndMinute.toString().padStart(2, '0')}`;
    }
    
    const cronExpression = `${cronMinute} ${cronHour} * * *`;
    
    const task = cron.schedule(cronExpression, async () => {
      // ĐÃ TẠM THỜI TẮT ĐỘ TRỄ NGẪU NHIÊN THEO YÊU CẦU CỦA USER (DELAY = 0)
      const delayMs = 0;
      
      const scheduledTimeStr = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
      const logMsg = `⏰ Lịch chạy tự động ca ${scheduledTimeStr} được kích hoạt và chạy ngay lập tức (đã tạm tắt delay ngẫu nhiên)...`;
      
      console.log(`[Scheduler] Cron triggered for ca ${scheduledTimeStr}. Running immediately.`);
      db.addLog('info', logMsg);
      
      try {
        await runAutoCheckInOutAndSendTelegram(false);
      } catch (error) {
        console.error('Scheduler failed during execution:', error);
        db.addLog('error', `Lỗi Scheduler khi chạy tự động: ${error.message}`);
      }
    }, {
      timezone: timezone
    });
    
    cronTasks.push(task);
    console.log(`[Scheduler] Scheduled task for ca ${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')} (Cron: ${cronHour}:${cronMinute}, Target range: ${targetRangeText}, timezone: ${timezone})`);
  });
}
