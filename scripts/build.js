import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('📦 Đang đóng gói Backend vào thư mục dist/...');

// Reset dist folder
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Files and folders to copy
const itemsToCopy = [
  'server.js',
  'database.js',
  'scheduler.js',
  'package.json',
  'package-lock.json'
];

if (fs.existsSync(path.join(rootDir, 'public'))) {
  itemsToCopy.push('public');
}

for (const item of itemsToCopy) {
  const src = path.join(rootDir, item);
  const dest = path.join(distDir, item);

  if (fs.existsSync(src)) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
    console.log(`  ✓ Coppy: ${item}`);
  }
}

console.log('✅ Đã hoàn tất! Thư mục "dist" đã được tạo thành công.');
console.log('👉 Hướng dẫn: Bạn chỉ cần nén thư mục "dist" hoặc upload các file trong "dist" lên Host/VPS, sau đó chạy "npm install --production" và "npm start".');
