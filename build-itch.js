// Собирает архив для загрузки на itch.io.
//
// Запуск:
//   node build-itch.js https://адрес-вашего-сервера
//
// Получится файл itch-krivoruchka.zip — его и загружают на itch.io.
// Внутри только клиент: index.html, roles.js и config.js с вписанным
// адресом сервера. Сам сервер должен быть уже запущен на хостинге.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const server = (process.argv[2] || '').replace(/\/+$/, '');

if (!server) {
  console.error('\n  Укажите адрес сервера. Например:\n');
  console.error('    node build-itch.js https://krivoruchka.onrender.com\n');
  process.exit(1);
}
if (!/^https?:\/\//.test(server)) {
  console.error('\n  Адрес должен начинаться с https:// или http://\n');
  process.exit(1);
}
if (server.startsWith('http://')) {
  console.warn('\n  Внимание: itch.io отдаёт страницы по https, и браузер заблокирует');
  console.warn('  обращения к серверу по http. Нужен адрес на https.\n');
}

const OUT = path.join(__dirname, 'itch-build');
const ZIP = path.join(__dirname, 'itch-krivoruchka.zip');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

fs.copyFileSync(path.join(__dirname, 'public', 'index.html'), path.join(OUT, 'index.html'));
fs.copyFileSync(path.join(__dirname, 'public', 'roles.js'),   path.join(OUT, 'roles.js'));
fs.writeFileSync(path.join(OUT, 'config.js'),
  '// Адрес сервера, к которому подключается игра.\n' +
  '// Подставлен автоматически при сборке ' + new Date().toISOString().slice(0, 10) + '\n' +
  "window.KR_SERVER = '" + server + "';\n");

fs.rmSync(ZIP, { force: true });
try {
  execSync('cd "' + OUT + '" && zip -qr "' + ZIP + '" .');
} catch (e) {
  console.error('\n  Не удалось создать архив автоматически.');
  console.error('  Запакуйте вручную содержимое папки itch-build');
  console.error('  (три файла, без самой папки) в zip.\n');
  process.exit(1);
}

const kb = (fs.statSync(ZIP).size / 1024).toFixed(0);
console.log('\n  Готово: itch-krivoruchka.zip (' + kb + ' КБ)');
console.log('  Сервер: ' + server);
console.log('\n  Что дальше:');
console.log('  1. На itch.io создайте проект, тип — HTML.');
console.log('  2. Загрузите этот архив и отметьте его как «This file will be played in the browser».');
console.log('  3. Размер окна: 1280 × 800, включите «Fullscreen button» и «Mobile friendly».');
console.log('  4. Проверьте, что сервер на хостинге запущен, и откройте страницу.\n');
