import React, { useState, useEffect, useRef } from 'react';
import {
  Layout,
  Menu,
  Card,
  Button,
  Table,
  Form,
  Input,
  InputNumber,
  Switch,
  Modal,
  Select,
  DatePicker,
  Badge,
  Space,
  Tooltip,
  theme,
  ConfigProvider,
  message,
  Popconfirm
} from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  SendOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const { Header, Content, Sider } = Layout;
const { Option } = Select;

const API_BASE = import.meta.env.PROD ? 'https://teleauto-0tdl.onrender.com' : '';

export default function AppWrapper() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#0ea5e9',
          borderRadius: 5,
          colorBgBase: '#09090b',
          colorBgContainer: '#18181b'
        }
      }}
    >
      <App />
    </ConfigProvider>
  );
}

function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('dashboard');

  // Core Data States
  const [settings, setSettings] = useState({
    telegramToken: '',
    telegramChatIds: [],
    timezone: 'Asia/Ho_Chi_Minh',
    checkTimes: []
  });
  const [users, setUsers] = useState([]);
  const [leaves, setLeaves] = useState([]);

  // Loading States
  const [loading, setLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [testLoginLoading, setTestLoginLoading] = useState(false);

  // Modal States
  const [isUserModalVisible, setIsUserModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null); // null means adding new user
  const [isLeaveModalVisible, setIsLeaveModalVisible] = useState(false);

  // Forms Refs & States
  const [userForm] = Form.useForm();
  const [leaveForm] = Form.useForm();
  const [telegramForm] = Form.useForm();
  const [scheduleForm] = Form.useForm();

  // Test ERP Login Output State
  const [testLoginResult, setTestLoginResult] = useState(null);

  // Manual Trigger Terminal Console State
  const [consoleVisible, setConsoleVisible] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState([]);

  // Time States
  const [currentTimeStr, setCurrentTimeStr] = useState('');
  const [countdownStr, setCountdownStr] = useState('--:--:--');
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [timelineItems, setTimelineItems] = useState([]);

  // Temporary Edit States
  const [newChatId, setNewChatId] = useState('');
  const [newHour, setNewHour] = useState(null);
  const [newMin, setNewMin] = useState(null);
  const [editingTimeIndex, setEditingTimeIndex] = useState(null);
  const [editingTimeHour, setEditingTimeHour] = useState(null);
  const [editingTimeMin, setEditingTimeMin] = useState(null);

  const consoleEndRef = useRef(null);

  // --- Data Fetching ---
  const fetchData = async () => {
    setLoading(true);
    try {
      const [settingsRes, usersRes, leavesRes] = await Promise.all([
        fetch(`${API_BASE}/api/settings`).then(r => r.json()),
        fetch(`${API_BASE}/api/users`).then(r => r.json()),
        fetch(`${API_BASE}/api/leaves`).then(r => r.json())
      ]);

      setSettings(settingsRes);
      setUsers(usersRes);
      setLeaves(leavesRes);

      // Update form values
      telegramForm.setFieldsValue({
        telegramToken: settingsRes.telegramToken
      });
      scheduleForm.setFieldsValue({
        timezone: settingsRes.timezone
      });
    } catch (error) {
      message.error('Lỗi tải dữ liệu: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- Clock & Countdown Tickers ---
  useEffect(() => {
    const interval = setInterval(() => {
      // Local time
      setCurrentTimeStr(dayjs().format('HH:mm:ss'));

      // Countdown logic
      if (!settings.checkTimes || settings.checkTimes.length === 0) {
        setCountdownStr('--:--:--');
        return;
      }

      const tz = settings.timezone || 'Asia/Ho_Chi_Minh';
      const nowInTz = dayjs().tz(tz);

      let nextRun = null;
      let minDiff = Infinity;

      // Check for times today and tomorrow
      const daysToCheck = [0, 1]; // today, tomorrow

      daysToCheck.forEach(dayOffset => {
        settings.checkTimes.forEach(time => {
          const h = time.hour;
          const m = time.minute;

          const runTime = nowInTz
            .add(dayOffset, 'day')
            .hour(h)
            .minute(m)
            .second(0)
            .millisecond(0);

          const diff = runTime.diff(nowInTz);
          if (diff > 0 && diff < minDiff) {
            minDiff = diff;
            nextRun = runTime;
          }
        });
      });

      if (nextRun) {
        const diffMs = nextRun.diff(nowInTz);
        const hours = Math.floor(diffMs / (60 * 60 * 1000));
        const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((diffMs % (60 * 1000)) / 1000);

        setCountdownStr(
          `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );
      }

      // Check if any checkTime is currently in its active execution minute
      let activeShift = false;
      settings.checkTimes.forEach(time => {
        const h = time.hour;
        const m = time.minute;

        const todayRun = nowInTz.hour(h).minute(m).second(0).millisecond(0);
        const diffMinutes = nowInTz.diff(todayRun, 'minute');
        if (diffMinutes === 0) {
          activeShift = true;
        }
      });
      setIsShiftActive(activeShift);
    }, 1000);

    return () => clearInterval(interval);
  }, [settings]);

  // --- Timeline Builder ---
  useEffect(() => {
    if (!settings.checkTimes || settings.checkTimes.length === 0) {
      setTimelineItems([]);
      return;
    }

    const sorted = [...settings.checkTimes].sort((a, b) => {
      if (a.hour !== b.hour) return a.hour - b.hour;
      return a.minute - b.minute;
    });

    const tz = settings.timezone || 'Asia/Ho_Chi_Minh';
    const nowInTz = dayjs().tz(tz);
    const currH = nowInTz.hour();
    const currM = nowInTz.minute();

    let nextIndex = sorted.findIndex(t => {
      const h = t.hour;
      const m = t.minute;
      if (h > currH) return true;
      if (h === currH && m > currM) return true;
      return false;
    });

    if (nextIndex === -1) nextIndex = 0;

    const items = sorted.map((time, idx) => {
      const isNext = idx === nextIndex;
      const displayTime = 'Chạy chính xác';

      return {
        key: idx,
        time: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
        range: displayTime,
        isNext
      };
    });

    setTimelineItems(items);
  }, [settings]);

  // Scroll terminal to bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleOutput]);

  // --- Settings Post Helper ---
  const saveSettings = async (updatedFields) => {
    try {
      const payload = {
        telegramToken: settings.telegramToken,
        telegramChatIds: settings.telegramChatIds,
        timezone: settings.timezone,
        checkTimes: settings.checkTimes,
        ...updatedFields
      };

      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        message.success('Cấu hình đã được lưu và cập nhật trên Server!');
        return true;
      } else {
        const err = await res.json();
        message.error('Lỗi: ' + err.error);
        return false;
      }
    } catch (error) {
      message.error('Lỗi kết nối server');
      return false;
    }
  };

  // --- Manual Execution (Zap Run) ---
  const runManualTrigger = async () => {
    setTriggerLoading(true);
    setConsoleVisible(true);
    setConsoleOutput([{ type: 'info', text: '🚀 Bắt đầu trigger chấm công thủ công cho tất cả tài khoản...' }]);

    try {
      const res = await fetch(`${API_BASE}/api/trigger`, { method: 'POST' });
      const data = await res.json();

      if (data.success && Array.isArray(data.results)) {
        const lines = data.results.map(r => {
          if (r.status === 'bypass') {
            return { type: 'bypass', text: `⏭️ [${r.empCode}] ${r.fullName} - Chế độ: ${r.modeText} - Lý do: ${r.message}` };
          } else if (r.status === 'error') {
            return { type: 'error', text: `❌ [${r.empCode}] ${r.fullName} - Chế độ: ${r.modeText} - Lỗi: ${r.message}` };
          } else {
            return { type: 'success', text: `✅ [${r.empCode}] ${r.fullName} - Kết quả: ${r.message}` };
          }
        });
        setConsoleOutput(prev => [...prev, ...lines, { type: 'info', text: '🤖 Đã kết thúc và gửi thông báo Telegram!' }]);
      } else {
        setConsoleOutput(prev => [...prev, { type: 'error', text: '❌ Kích hoạt thất bại: ' + (data.error || 'Lỗi không xác định') }]);
      }
    } catch (error) {
      setConsoleOutput(prev => [...prev, { type: 'error', text: '❌ Lỗi kết nối máy chủ: ' + error.message }]);
    } finally {
      setTriggerLoading(false);
    }
  };

  const runUserManualTrigger = async (empCode, fullName) => {
    message.loading(`Đang chạy kiểm tra cho nhân viên ${empCode}...`, 1.5);
    try {
      const res = await fetch(`${API_BASE}/api/trigger/${empCode}`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.result) {
        const r = data.result;
        if (r.status === 'bypass') {
          Modal.info({
            title: `Bỏ qua chấm công - ${fullName}`,
            content: `Chế độ: ${r.modeText}\nLý do: ${r.message}`
          });
        } else if (r.status === 'error') {
          Modal.error({
            title: `Lỗi chấm công - ${fullName}`,
            content: `Chế độ: ${r.modeText}\nLỗi: ${r.message}`
          });
        } else {
          Modal.success({
            title: `Thành công - ${fullName}`,
            content: r.message
          });
        }
      } else {
        message.error('Kích hoạt thất bại: ' + (data.error || 'Lỗi không rõ'));
      }
    } catch (e) {
      message.error('Lỗi kết nối máy chủ');
    }
  };

  // --- Users Actions ---
  const handleOpenUserModal = (user = null) => {
    setEditingUser(user);
    setTestLoginResult(null);
    if (user) {
      userForm.setFieldsValue({
        empCode: user.empCode,
        password: user.password,
        fullName: user.fullName,
        isActive: user.isActive
      });
    } else {
      userForm.resetFields();
      userForm.setFieldsValue({ isActive: true });
    }
    setIsUserModalVisible(true);
  };

  const testErpLogin = async () => {
    try {
      const vals = await userForm.validateFields(['empCode', 'password']);
      setTestLoginLoading(true);
      setTestLoginResult(null);

      const res = await fetch(`${API_BASE}/api/users/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vals)
      });
      const data = await res.json();

      if (data.success) {
        setTestLoginResult({ success: true, message: `Hợp lệ! Tên nhân viên: ${data.fullName}` });
        userForm.setFieldsValue({ fullName: data.fullName });
      } else {
        setTestLoginResult({ success: false, message: data.message || 'Sai thông tin đăng nhập' });
      }
    } catch (e) {
      message.error('Vui lòng điền đủ Mã nhân viên và Mật khẩu');
    } finally {
      setTestLoginLoading(false);
    }
  };

  const handleUserSubmit = async (values) => {
    const url = editingUser ? `${API_BASE}/api/users/${editingUser.empCode}` : `${API_BASE}/api/users`;
    const method = editingUser ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empCode: values.empCode,
          password: values.password,
          fullName: values.fullName || '',
          isActive: values.isActive
        })
      });

      if (res.ok) {
        message.success(editingUser ? 'Đã cập nhật thông tin nhân viên!' : 'Đã thêm nhân viên thành công!');
        setIsUserModalVisible(false);
        fetchData();
      } else {
        const err = await res.json();
        message.error('Lỗi: ' + err.error);
      }
    } catch (e) {
      message.error('Lỗi lưu tài khoản');
    }
  };

  const handleDeleteUser = async (empCode) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/${empCode}`, { method: 'DELETE' });
      if (res.ok) {
        message.success('Đã xóa nhân viên.');
        fetchData();
      } else {
        message.error('Xóa thất bại');
      }
    } catch (e) {
      message.error('Lỗi kết nối');
    }
  };

  const handleToggleUserActive = async (empCode, checked) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/${empCode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: checked })
      });
      if (res.ok) {
        message.success('Đã chuyển đổi trạng thái.');
        fetchData();
      }
    } catch (e) {
      message.error('Lỗi cập nhật');
    }
  };

  // --- Leaves Actions ---
  const handleAddLeave = async (values) => {
    try {
      const res = await fetch(`${API_BASE}/api/leaves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empCode: values.empCode,
          date: values.date.format('YYYY-MM-DD'),
          type: values.type
        })
      });

      if (res.ok) {
        message.success('Đã thêm lịch nghỉ phép.');
        setIsLeaveModalVisible(false);
        fetchData();
      } else {
        const err = await res.json();
        message.error('Lỗi: ' + err.error);
      }
    } catch (e) {
      message.error('Lỗi kết nối');
    }
  };

  const handleDeleteLeave = async (empCode, date) => {
    try {
      const res = await fetch(`${API_BASE}/api/leaves/${empCode}/${date}`, { method: 'DELETE' });
      if (res.ok) {
        message.success('Đã xóa lịch nghỉ.');
        fetchData();
      }
    } catch (e) {
      message.error('Lỗi kết nối');
    }
  };

  // --- Schedule Tab Actions ---
  const handleAddTimeRow = async () => {
    if (newHour === null || newMin === null) {
      message.error('Vui lòng điền đủ Giờ và Phút.');
      return;
    }
    if (newHour < 0 || newHour > 23 || newMin < 0 || newMin > 59) {
      message.error('Giờ hoặc phút không hợp lệ.');
      return;
    }

    const exists = settings.checkTimes.some(t => t.hour === newHour && t.minute === newMin);
    if (exists) {
      message.error('Mốc giờ chạy này đã tồn tại!');
      return;
    }

    const updated = [...settings.checkTimes, { hour: newHour, minute: newMin }];
    const success = await saveSettings({ checkTimes: updated });
    if (success) {
      setNewHour(null);
      setNewMin(null);
    }
  };

  const handleStartEditTime = (index, time) => {
    setEditingTimeIndex(index);
    setEditingTimeHour(time.hour);
    setEditingTimeMin(time.minute);
  };

  const handleSaveEditTime = async (index) => {
    if (editingTimeHour === null || editingTimeMin === null) {
      message.error('Vui lòng điền đủ Giờ và Phút.');
      return;
    }
    if (editingTimeHour < 0 || editingTimeHour > 23 || editingTimeMin < 0 || editingTimeMin > 59) {
      message.error('Giờ hoặc phút không hợp lệ.');
      return;
    }

    const exists = settings.checkTimes.some((t, idx) => idx !== index && t.hour === editingTimeHour && t.minute === editingTimeMin);
    if (exists) {
      message.error('Mốc giờ chạy này đã tồn tại!');
      return;
    }

    const updated = [...settings.checkTimes];
    updated[index] = { hour: editingTimeHour, minute: editingTimeMin };
    const success = await saveSettings({ checkTimes: updated });
    if (success) {
      setEditingTimeIndex(null);
    }
  };

  const handleDeleteTime = async (index) => {
    const updated = [...settings.checkTimes];
    updated.splice(index, 1);
    await saveSettings({ checkTimes: updated });
  };

  // --- Telegram Tab Actions ---
  const handleAddChatId = async () => {
    const val = newChatId.trim();
    if (!val) return;

    if (settings.telegramChatIds.includes(val)) {
      message.error('ID Chat này đã tồn tại!');
      return;
    }

    const updated = [...settings.telegramChatIds, val];
    const success = await saveSettings({ telegramChatIds: updated });
    if (success) {
      setNewChatId('');
    }
  };

  const handleDeleteChatId = async (idx) => {
    const updated = [...settings.telegramChatIds];
    updated.splice(idx, 1);
    await saveSettings({ telegramChatIds: updated });
  };

  const sendTestTelegramMsg = async () => {
    message.loading('Đang gửi tin nhắn thử nghiệm...', 1.5);
    try {
      const res = await fetch(`${API_BASE}/api/settings/test-telegram`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        message.success('Đã gửi tin nhắn thử nghiệm! Hãy check Telegram của bạn.');
      } else {
        message.error('Lỗi: ' + data.message);
      }
    } catch (e) {
      message.error('Không thể kết nối đến API Telegram');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={230}>
        <div className="logo-section">
          TELEAUTO PANEL
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeTab]}
          onClick={({ key }) => setActiveTab(key)}
          style={{ borderRight: 0, marginTop: 12 }}
          items={[
            { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
            { key: 'users', icon: <UserOutlined />, label: 'Tài khoản ERP' },
            { key: 'leaves', icon: <CalendarOutlined />, label: 'Lịch nghỉ phép' },
            { key: 'schedule', icon: <ClockCircleOutlined />, label: 'Giờ chạy tự động' },
            { key: 'telegram', icon: <SendOutlined />, label: 'Cấu hình Telegram' }
          ]}
        />
      </Sider>

      <Layout>
        <Header style={{ background: 'rgba(17, 24, 39, 0.45)', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <Space>
            <Badge status="processing" />
            <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Giờ hệ thống:</span>
            <strong style={{ fontFamily: 'monospace', fontSize: '1rem', color: '#0ea5e9' }}>{currentTimeStr}</strong>
          </Space>
        </Header>

        <Content style={{ margin: 24, overflow: 'initial' }}>
          {/* TAB: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div>
              <div className="stats-grid">
                <Card className="premium-card" bodyStyle={{ padding: 0 }}>
                  <div className="stat-card-inner">
                    <div className="stat-info">
                      <span className="stat-title">Trạng thái Bot</span>
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                        <span className="pulse-dot"></span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>Hoạt động</span>
                      </div>
                    </div>
                    <div className="stat-icon-wrapper stat-icon-green">
                      <PlayCircleOutlined />
                    </div>
                  </div>
                </Card>

                <Card className="premium-card" bodyStyle={{ padding: 0 }}>
                  <div className="stat-card-inner">
                    <div className="stat-info">
                      <span className="stat-title">Tổng nhân viên</span>
                      <span className="stat-value-large">{users.length}</span>
                    </div>
                    <div className="stat-icon-wrapper stat-icon-blue">
                      <UserOutlined />
                    </div>
                  </div>
                </Card>

                <Card className="premium-card" bodyStyle={{ padding: 0 }}>
                  <div className="stat-card-inner">
                    <div className="stat-info">
                      <span className="stat-title">Nghỉ hôm nay</span>
                      <span className="stat-value-large">
                        {leaves.filter(l => l.date === dayjs().tz(settings.timezone || 'Asia/Ho_Chi_Minh').format('YYYY-MM-DD')).length}
                      </span>
                    </div>
                    <div className="stat-icon-wrapper stat-icon-amber">
                      <CalendarOutlined />
                    </div>
                  </div>
                </Card>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 24 }}>
                <Card title="Kích hoạt thủ công" className="premium-card">
                  <p style={{ color: '#9ca3af', fontSize: '0.88rem' }}>
                    Chạy tức thì quy trình đăng nhập và chấm công cho toàn bộ tài khoản nhân viên đang hoạt động.
                  </p>
                  <Space style={{ marginTop: 12 }}>
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={runManualTrigger} loading={triggerLoading}>
                      Kích hoạt ngay bây giờ
                    </Button>
                    <Button icon={<SendOutlined />} onClick={sendTestTelegramMsg}>
                      Gửi thử tin Telegram
                    </Button>
                  </Space>

                  {consoleVisible && (
                    <div className="premium-console">
                      <div className="console-header">
                        <span>BÁO CÁO THỰC THI HỆ THỐNG</span>
                        <Button type="text" size="small" style={{ padding: 0, height: 'auto', color: '#64748b' }} onClick={() => setConsoleVisible(false)}>Đóng</Button>
                      </div>
                      <div className="console-body">
                        {consoleOutput.map((c, i) => (
                          <div key={i} className={`console-line ${c.type}`}>{c.text}</div>
                        ))}
                        <div ref={consoleEndRef} />
                      </div>
                    </div>
                  )}
                </Card>

                <Card title="Khung giờ tự động tiếp theo" className="premium-card">
                  <div className="futuristic-clock-container" style={{ marginBottom: 20 }}>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Lần chạy kế tiếp</span>
                    <div className="countdown-timer-text" style={{ color: isShiftActive ? '#f59e0b' : '#0ea5e9' }}>
                      {isShiftActive ? 'ĐANG CHẠY' : countdownStr}
                    </div>
                    {isShiftActive && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 8, color: '#f59e0b', fontSize: '0.8rem', lineHeight: '1.45', textAlign: 'center', width: '90%' }}>
                        Hệ thống đang thực hiện chấm công tự động ngay bây giờ. Báo cáo chi tiết sẽ được gửi qua Telegram ngay sau khi hoàn tất.
                      </div>
                    )}
                  </div>
                  <h4 style={{ color: '#9ca3af', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14, fontWeight: 600 }}>Danh sách khung giờ tự động:</h4>
                  {timelineItems.length === 0 ? (
                    <p style={{ color: '#6b7280' }}>Chưa thiết lập giờ chạy nào.</p>
                  ) : (
                    timelineItems.map(item => (
                      <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: item.isNext ? 'rgba(14, 165, 233, 0.08)' : 'transparent', border: item.isNext ? '1px solid rgba(14, 165, 233, 0.3)' : '1px solid rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 8, transition: 'all 0.2s ease' }}>
                        <span>Lúc: <strong style={{ color: item.isNext ? '#0ea5e9' : '#f3f4f6' }}>{item.time}</strong></span>
                        <span style={{ color: '#9ca3af' }}>{item.range} {item.isNext && <Badge status="processing" text="Tiếp theo" style={{ marginLeft: 8 }} />}</span>
                      </div>
                    ))
                  )}
                </Card>
              </div>

              <div style={{ marginTop: 20 }}>
                <Card title="Tình trạng chấm công hôm nay của nhân viên" className="premium-card">
                  <Table
                    dataSource={users}
                    rowKey="empCode"
                    pagination={false}
                    size="small"
                    columns={[
                      {
                        title: 'Nhân viên',
                        key: 'employee',
                        render: (_, record) => (
                          <div>
                            <span style={{ fontWeight: 600, color: '#ffffff' }}>{record.fullName || 'Chưa cập nhật'}</span>
                            <span style={{ color: '#71717a', fontSize: '0.75rem', marginLeft: 8 }}>({record.empCode})</span>
                          </div>
                        )
                      },
                      {
                        title: 'Lịch chấm công hôm nay',
                        key: 'todaySchedule',
                        render: (_, record) => {
                          const todayStr = dayjs().tz(settings.timezone || 'Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
                          const leave = leaves.find(l => l.empCode === record.empCode && l.date === todayStr);

                          if (!record.isActive) {
                            return <Badge status="default" text="Tài khoản ngưng hoạt động" style={{ color: '#71717a' }} />;
                          }

                          if (!leave) {
                            return <Badge status="success" text="Làm cả ngày (Chấm sáng & chiều)" style={{ color: '#34d399' }} />;
                          }

                          if (leave.type === 'Cả ngày') {
                            return <Badge status="error" text="Nghỉ cả ngày (Vắng / Không chấm)" style={{ color: '#f87171' }} />;
                          } else if (leave.type === 'Buổi sáng') {
                            return <Badge status="warning" text="Nghỉ buổi sáng (Chỉ chấm ca chiều)" style={{ color: '#fbbf24' }} />;
                          } else {
                            return <Badge status="warning" text="Nghỉ buổi chiều (Chỉ chấm ca sáng)" style={{ color: '#fbbf24' }} />;
                          }
                        }
                      }
                    ]}
                  />
                </Card>
              </div>
            </div>
          )}

          {/* TAB: USERS */}
          {activeTab === 'users' && (
            <Card
              title="Danh sách tài khoản nhân viên 365ERP"
              className="premium-card"
              extra={
                <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenUserModal(null)}>
                  Thêm nhân viên mới
                </Button>
              }
            >
              <Table
                dataSource={users}
                rowKey="empCode"
                loading={loading}
                columns={[
                  { title: 'Mã nhân viên (ERP)', dataIndex: 'empCode', key: 'empCode', render: text => <strong>{text}</strong> },
                  { title: 'Tên nhân viên', dataIndex: 'fullName', key: 'fullName', render: text => text || <span style={{ color: '#6b7280' }}>Chưa cập nhật</span> },
                  {
                    title: 'Mật khẩu',
                    dataIndex: 'password',
                    key: 'password',
                    render: text => <Input.Password value={text} readOnly style={{ width: 150, background: 'transparent', border: 'none' }} />
                  },
                  {
                    title: 'Trạng thái hoạt động',
                    dataIndex: 'isActive',
                    key: 'isActive',
                    render: (val, record) => (
                      <Switch checked={val} onChange={(checked) => handleToggleUserActive(record.empCode, checked)} />
                    )
                  },
                  {
                    title: 'Thao tác',
                    key: 'actions',
                    render: (_, record) => (
                      <Space>
                        <Tooltip title="Chạy test chấm công tài khoản này">
                          <Button shape="circle" icon={<PlayCircleOutlined />} onClick={() => runUserManualTrigger(record.empCode, record.fullName)} />
                        </Tooltip>
                        <Tooltip title="Chỉnh sửa">
                          <Button shape="circle" icon={<EditOutlined />} onClick={() => handleOpenUserModal(record)} />
                        </Tooltip>
                        <Popconfirm title="Bạn có chắc chắn muốn xóa nhân viên này không?" onConfirm={() => handleDeleteUser(record.empCode)}>
                          <Button shape="circle" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          )}

          {/* TAB: LEAVES */}
          {activeTab === 'leaves' && (
            <Card
              title="Danh sách nhân viên nghỉ phép hôm nay & sắp tới"
              className="premium-card"
              extra={
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsLeaveModalVisible(true)}>
                  Thêm lịch nghỉ phép
                </Button>
              }
            >
              <Table
                dataSource={leaves}
                rowKey={record => `${record.empCode}_${record.date}`}
                loading={loading}
                columns={[
                  { title: 'Mã nhân viên', dataIndex: 'empCode', key: 'empCode', render: text => <strong>{text}</strong> },
                  { title: 'Tên nhân viên', key: 'name', render: (_, record) => users.find(u => u.empCode === record.empCode)?.fullName || '-' },
                  { title: 'Ngày xin nghỉ', dataIndex: 'date', key: 'date', render: text => dayjs(text).format('DD/MM/YYYY') },
                  {
                    title: 'Loại nghỉ',
                    dataIndex: 'type',
                    key: 'type',
                    render: text => {
                      let color = 'gold';
                      if (text === 'Cả ngày') color = 'red';
                      else if (text === 'Buổi sáng') color = 'cyan';
                      return <Badge count={text} style={{ backgroundColor: color }} />;
                    }
                  },
                  {
                    title: 'Thao tác',
                    key: 'delete',
                    render: (_, record) => (
                      <Popconfirm title="Xóa lịch nghỉ phép này?" onConfirm={() => handleDeleteLeave(record.empCode, record.date)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )
                  }
                ]}
              />
            </Card>
          )}

          {/* TAB: SCHEDULE */}
          {activeTab === 'schedule' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
              <Card title="Quản lý mốc giờ chạy tự động" className="premium-card">
                <p style={{ color: '#9ca3af', fontSize: '0.88rem', marginBottom: 16 }}>
                  Các mốc giờ bot sẽ tự động đăng nhập và chạy chấm công. Chỉnh sửa hoặc thêm mới sẽ cập nhật trực tiếp lịch chạy trên Server.
                </p>
                <div style={{ marginBottom: 16 }}>
                  {settings.checkTimes.length === 0 ? (
                    <p style={{ color: '#6b7280' }}>Chưa thiết lập giờ chạy tự động nào.</p>
                  ) : (
                    settings.checkTimes.map((time, idx) => {
                      const isEditing = idx === editingTimeIndex;
                      return (
                        <div key={idx} className="check-time-item">
                          {isEditing ? (
                            <Space size="small">
                              <InputNumber min={0} max={23} value={editingTimeHour} onChange={setEditingTimeHour} style={{ width: 60 }} />
                              <strong>:</strong>
                              <InputNumber min={0} max={59} value={editingTimeMin} onChange={setEditingTimeMin} style={{ width: 60 }} />
                            </Space>
                          ) : (
                            <span>Hàng ngày lúc <strong>{String(time.hour).padStart(2, '0')}:{String(time.minute).padStart(2, '0')}</strong></span>
                          )}
                          <Space size="small">
                            {isEditing ? (
                              <>
                                <Button size="small" type="text" style={{ color: '#52c41a' }} icon={<CheckOutlined />} onClick={() => handleSaveEditTime(idx)} />
                                <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => setEditingTimeIndex(null)} />
                              </>
                            ) : (
                              <>
                                <Button size="small" type="text" style={{ color: '#1890ff' }} icon={<EditOutlined />} onClick={() => handleStartEditTime(idx, time)} />
                                <Popconfirm title="Xóa mốc giờ này?" onConfirm={() => handleDeleteTime(idx)}>
                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </>
                            )}
                          </Space>
                        </div>
                      );
                    })
                  )}
                </div>

                <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ fontSize: '0.85rem', marginBottom: 8, color: '#9ca3af' }}>Thêm giờ chạy tự động mới</h4>
                  <Space>
                    <InputNumber placeholder="Giờ" min={0} max={23} value={newHour} onChange={setNewHour} style={{ width: 80 }} />
                    <strong>:</strong>
                    <InputNumber placeholder="Phút" min={0} max={59} value={newMin} onChange={setNewMin} style={{ width: 80 }} />
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleAddTimeRow}>
                      Thêm
                    </Button>
                  </Space>
                </div>
              </Card>

              <Card title="Cấu hình múi giờ hệ thống" className="premium-card">
                <Form form={scheduleForm} layout="vertical" onFinish={saveSettings}>
                  <Form.Item name="timezone" label="Múi giờ hoạt động" rules={[{ required: true, message: 'Vui lòng nhập múi giờ!' }]}>
                    <Input placeholder="Asia/Ho_Chi_Minh" />
                  </Form.Item>
                  <span style={{ fontSize: '0.8rem', color: '#6b7280', display: 'block', marginBottom: 12 }}>
                    Mặc định: Asia/Ho_Chi_Minh. Đảm bảo giờ chạy của bot khớp với giờ thực tế tại Việt Nam.
                  </span>
                  <Button type="primary" htmlType="submit">
                    Cập nhật múi giờ
                  </Button>
                </Form>
              </Card>
            </div>
          )}

          {/* TAB: TELEGRAM */}
          {activeTab === 'telegram' && (
            <Card title="Cấu hình thông báo Telegram" className="premium-card" style={{ maxWidth: 600, margin: '0 auto' }}>
              <Form form={telegramForm} layout="vertical" onFinish={saveSettings}>
                <Form.Item name="telegramToken" label="Telegram Bot Token" rules={[{ required: true, message: 'Vui lòng nhập Bot Token!' }]}>
                  <Input.Password placeholder="8062669563:AAG..." />
                </Form.Item>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.88rem' }}>Danh sách Chat ID nhận báo cáo</label>
                  {settings.telegramChatIds.length === 0 ? (
                    <p style={{ color: '#6b7280' }}>Chưa cấu hình Chat ID nhận tin nhắn.</p>
                  ) : (
                    settings.telegramChatIds.map((chatId, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, marginBottom: 6 }}>
                        <span>ID: <strong>{chatId}</strong></span>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteChatId(idx)} />
                      </div>
                    ))
                  )}
                  <Space style={{ marginTop: 8 }}>
                    <Input placeholder="Nhập Chat ID mới" value={newChatId} onChange={e => setNewChatId(e.target.value)} />
                    <Button icon={<PlusOutlined />} onClick={handleAddChatId}>Thêm ID</Button>
                  </Space>
                </div>
                <Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit">Lưu cấu hình Telegram</Button>
                    <Button onClick={sendTestTelegramMsg}>Gửi thử tin nhắn test</Button>
                  </Space>
                </Form.Item>
              </Form>
            </Card>
          )}
        </Content>
      </Layout>

      {/* MODAL: USER (ADD / EDIT) */}
      <Modal
        title={editingUser ? "Chỉnh sửa tài khoản nhân viên" : "Thêm nhân viên mới"}
        open={isUserModalVisible}
        onCancel={() => setIsUserModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={userForm} layout="vertical" onFinish={handleUserSubmit}>
          <Form.Item name="empCode" label="Mã nhân viên (365ERP)" rules={[{ required: true, message: 'Vui lòng nhập mã nhân viên!' }]}>
            <Input placeholder="Nhập mã nhân viên..." disabled={!!editingUser} />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu ERP" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu ERP!' }]}>
            <Input.Password placeholder="Nhập mật khẩu ERP..." />
          </Form.Item>
          <Form.Item name="fullName" label="Họ và tên">
            <Input placeholder="Hệ thống tự điền khi bấm nút Test bên dưới..." />
          </Form.Item>
          <Form.Item name="isActive" valuePropName="checked" label="Trạng thái">
            <Switch />
          </Form.Item>

          {testLoginResult && (
            <div style={{ padding: 8, borderRadius: 6, background: testLoginResult.success ? 'rgba(82, 196, 26, 0.15)' : 'rgba(255, 77, 79, 0.15)', border: `1px solid ${testLoginResult.success ? '#52c41a' : '#ff4d4f'}`, color: testLoginResult.success ? '#52c41a' : '#ff4d4f', marginBottom: 16 }}>
              {testLoginResult.message}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={testErpLogin} loading={testLoginLoading}>Test Đăng nhập ERP</Button>
            <Button type="primary" htmlType="submit">Lưu</Button>
          </div>
        </Form>
      </Modal>

      {/* MODAL: LEAVE */}
      <Modal
        title="Thêm lịch nghỉ phép mới"
        open={isLeaveModalVisible}
        onCancel={() => setIsLeaveModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={leaveForm} layout="vertical" onFinish={handleAddLeave}>
          <Form.Item name="empCode" label="Nhân viên" rules={[{ required: true, message: 'Vui lòng chọn nhân viên!' }]}>
            <Select placeholder="Chọn nhân viên...">
              {users.map(u => (
                <Option key={u.empCode} value={u.empCode}>
                  {u.fullName ? `${u.fullName} (${u.empCode})` : u.empCode}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="date" label="Ngày nghỉ" rules={[{ required: true, message: 'Vui lòng chọn ngày!' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="type" label="Loại nghỉ" rules={[{ required: true, message: 'Vui lòng chọn loại nghỉ!' }]}>
            <Select placeholder="Chọn loại nghỉ...">
              <Option value="Cả ngày">Nghỉ cả ngày (OFF)</Option>
              <Option value="Buổi sáng">Nghỉ buổi sáng (AM OFF)</Option>
              <Option value="Buổi chiều">Nghỉ buổi chiều (PM OFF)</Option>
            </Select>
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setIsLeaveModalVisible(false)}>Hủy</Button>
            <Button type="primary" htmlType="submit">Lưu</Button>
          </div>
        </Form>
      </Modal>
    </Layout>
  );
}
