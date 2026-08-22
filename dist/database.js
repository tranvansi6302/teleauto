import pg from 'pg';

const { Pool } = pg;

// Supabase PostgreSQL pool configurations
const pool = new Pool({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.muyqxmmrcswbcsdtjntj',
  password: '365EJSC@123',
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize Supabase Tables
export async function initDb() {
  const client = await pool.connect();
  try {
    // Settings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        telegram_token TEXT DEFAULT '8062669563:AAGFgodK1Lup5Jwn9vlN3x9JNkja-uJwlyo',
        telegram_chat_ids JSONB DEFAULT '["7864804029", "8145357636"]',
        timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
        check_times JSONB DEFAULT '[{"hour": 8, "minute": 0}, {"hour": 12, "minute": 0}, {"hour": 18, "minute": 0}]'
      );
    `);
    
    // Seed initial row
    await client.query(`
      INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `);

    // Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        emp_code TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        full_name TEXT DEFAULT '',
        is_active BOOLEAN DEFAULT TRUE
      );
    `);

    // Leaves Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leaves (
        emp_code TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        PRIMARY KEY (emp_code, date)
      );
    `);

    // Drop logs table if exists
    await client.query(`DROP TABLE IF EXISTS logs;`);

    console.log('[Database] Supabase PostgreSQL tables initialized successfully.');
  } catch (error) {
    console.error('[Database] Failed to initialize Supabase tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

export const db = {
  // Settings methods
  async getSettings() {
    const res = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (res.rows.length === 0) {
      return {
        telegramToken: '',
        telegramChatIds: [],
        timezone: 'Asia/Ho_Chi_Minh',
        checkTimes: []
      };
    }
    const row = res.rows[0];
    
    let telegramChatIds = row.telegram_chat_ids;
    if (typeof telegramChatIds === 'string') {
      try { telegramChatIds = JSON.parse(telegramChatIds); } catch(e) { telegramChatIds = []; }
    }
    
    let checkTimes = row.check_times;
    if (typeof checkTimes === 'string') {
      try { checkTimes = JSON.parse(checkTimes); } catch(e) { checkTimes = []; }
    }

    return {
      telegramToken: row.telegram_token || '',
      telegramChatIds: telegramChatIds || [],
      timezone: row.timezone || 'Asia/Ho_Chi_Minh',
      checkTimes: checkTimes || []
    };
  },

  async updateSettings(newSettings) {
    const current = await this.getSettings();
    const merged = { ...current, ...newSettings };
    
    await pool.query(
      `UPDATE settings 
       SET telegram_token = $1, 
           telegram_chat_ids = $2, 
           timezone = $3, 
           check_times = $4 
       WHERE id = 1`,
      [
        merged.telegramToken,
        JSON.stringify(merged.telegramChatIds),
        merged.timezone,
        JSON.stringify(merged.checkTimes)
      ]
    );
    return merged;
  },

  // Users methods
  async getUsers() {
    const res = await pool.query('SELECT * FROM users ORDER BY emp_code ASC');
    return res.rows.map(row => ({
      empCode: row.emp_code,
      password: row.password,
      fullName: row.full_name,
      isActive: row.is_active
    }));
  },

  async addUser(user) {
    await pool.query(
      `INSERT INTO users (emp_code, password, full_name, is_active) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (emp_code) 
       DO UPDATE SET password = $2, full_name = $3, is_active = $4`,
      [
        user.empCode,
        user.password,
        user.fullName || '',
        user.isActive !== undefined ? user.isActive : true
      ]
    );
    return user;
  },

  async updateUser(empCode, updatedData) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (updatedData.password !== undefined) {
      fields.push(`password = $${idx++}`);
      values.push(updatedData.password);
    }
    if (updatedData.fullName !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(updatedData.fullName);
    }
    if (updatedData.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(updatedData.isActive);
    }

    if (fields.length === 0) return {};

    values.push(empCode);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE emp_code = $${idx} RETURNING *`;
    const res = await pool.query(query, values);
    if (res.rows.length === 0) {
      throw new Error('User not found');
    }
    const row = res.rows[0];
    return {
      empCode: row.emp_code,
      password: row.password,
      fullName: row.full_name,
      isActive: row.is_active
    };
  },

  async deleteUser(empCode) {
    await pool.query('DELETE FROM users WHERE emp_code = $1', [empCode]);
  },

  // Leaves methods
  async getLeaves() {
    const res = await pool.query('SELECT * FROM leaves ORDER BY date ASC, emp_code ASC');
    return res.rows.map(row => ({
      empCode: row.emp_code,
      date: row.date,
      type: row.type
    }));
  },

  async addLeave(leave) {
    await pool.query(
      `INSERT INTO leaves (emp_code, date, type) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (emp_code, date) 
       DO UPDATE SET type = $3`,
      [leave.empCode, leave.date, leave.type]
    );
    return leave;
  },

  async deleteLeave(empCode, date) {
    await pool.query('DELETE FROM leaves WHERE emp_code = $1 AND date = $2', [empCode, date]);
  },

  // Dummy console log for logging events on server stdout
  addLog(type, message) {
    console.log(`[Log:${type}] ${message}`);
  }
};
