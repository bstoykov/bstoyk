// ============================================
// ОФИС ТРАКЕР 3x2 - GOOGLE APPS SCRIPT
// Created by Bozhidar Stoykov
// ============================================

// ============================================
// WEB APP ENDPOINT
// ============================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    let result;
    switch(action) {
      case 'register':
        result = register(data);
        break;
      case 'login':
        result = login(data);
        break;
      case 'saveAttendance':
        result = saveAttendance(data);
        break;
      case 'loadAttendance':
        result = loadAttendance(data);
        break;
      case 'sendReport':
        result = sendReport(data);
        break;
      case 'updateSettings':
        result = updateSettings(data);
        break;
      case 'adminGetStats':
        result = adminGetStats(data);
        break;
      case 'adminResetPassword':
        result = adminResetPassword(data);
        break;
      case 'adminSetUserStatus':
        result = adminSetUserStatus(data);
        break;
      case 'adminDeleteUser':
        result = adminDeleteUser(data);
        break;
      default:
        result = { success: false, error: 'Unknown action' };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    const callback = e.parameter.callback;
    
    let result;
    
    switch(action) {
      case 'login':
        result = login(e.parameter);
        break;
      case 'register':
        result = register(e.parameter);
        break;
      case 'loadAttendance':
        result = loadAttendance(e.parameter);
        break;
      case 'adminGetStats':
        result = adminGetStats(e.parameter);
        break;
      case 'adminResetPassword':
        result = adminResetPassword(e.parameter);
        break;
      case 'adminSetUserStatus':
        result = adminSetUserStatus(e.parameter);
        break;
      case 'adminDeleteUser':
        result = adminDeleteUser(e.parameter);
        break;
      default:
        result = { success: true, message: 'Office Tracker API is running!' };
    }
    
    // JSONP response for cross-origin requests
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${JSON.stringify(result)})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  // ВАЖНО: Промени това с ID на твоя Google Sheet!
  const SPREADSHEET_ID = '1HilI1p0piuUgcveBE7_ZDUHVU1KvllhLb7MNdUiv1dA';
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function hashPassword(password) {
  // Simple hash (в продукция използвай по-сигурен метод)
  return Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + 'salt_key_офис_тракер'
  ));
}

// ============================================
// ADMIN AUTHENTICATION
// ============================================
// ВАЖНО: Настрой тези стойности ЕДИН ПЪТ през:
// Apps Script Editor -> Project Settings (⚙️) -> Script Properties -> Add property
// Ключ: ADMIN_PASSWORD_HASH  | Стойност: резултата от hashPassword('Testvam123') - виж setupAdminPassword() по-долу
// Ключ: ADMIN_GITHUB_USERNAME | Стойност: твоето GitHub потребителско име (напр. bstoykov)
function setupAdminPassword() {
  // Изпълни тази функция РЪЧНО ЕДНОКРАТНО от Apps Script Editor (Run бутон),
  // за да генерираш и запазиш хеша на админ паролата в Script Properties.
  // След това МОЖЕШ да изтриеш/промениш паролата тук и да пуснеш отново ако искаш да я смениш.
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD_HASH', hashPassword('Testvam123'));
  props.setProperty('ADMIN_GITHUB_USERNAME', 'bstoykov'); // ← Смени с твоето GitHub потребителско име!
  Logger.log('Admin credentials configured!');
}

function verifyAdmin(password, githubToken) {
  const props = PropertiesService.getScriptProperties();
  const storedHash = props.getProperty('ADMIN_PASSWORD_HASH');
  const expectedGithubUser = props.getProperty('ADMIN_GITHUB_USERNAME');
  
  if (!storedHash || !expectedGithubUser) {
    return { valid: false, error: 'Admin достъпът не е конфигуриран! Изпълни setupAdminPassword() веднъж от Apps Script Editor.' };
  }
  
  if (!password || !githubToken) {
    return { valid: false, error: 'Парола и GitHub token са задължителни!' };
  }
  
  // Check password
  const passwordHash = hashPassword(password);
  if (passwordHash !== storedHash) {
    return { valid: false, error: 'Грешна парола!' };
  }
  
  // Check GitHub token - real verification against GitHub API
  try {
    const response = UrlFetchApp.fetch('https://api.github.com/user', {
      headers: {
        'Authorization': 'token ' + githubToken,
        'Accept': 'application/vnd.github+json'
      },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      return { valid: false, error: 'Невалиден GitHub token!' };
    }
    
    const githubUser = JSON.parse(response.getContentText());
    
    if (githubUser.login !== expectedGithubUser) {
      return { valid: false, error: 'GitHub token не принадлежи на очаквания акаунт!' };
    }
    
    return { valid: true };
    
  } catch (error) {
    return { valid: false, error: 'Грешка при проверка на GitHub token: ' + error.toString() };
  }
}

// ============================================
// USER MANAGEMENT
// ============================================
function register(data) {
  const sheet = getSpreadsheet().getSheetByName('Users');
  const email = data.email;
  const password = data.password;
  const name = data.name || email.split('@')[0];
  
  if (!email || !password) {
    return { success: false, error: 'Email и парола са задължителни!' };
  }
  
  // Check if user exists
  const existingUsers = sheet.getDataRange().getValues();
  for (let i = 1; i < existingUsers.length; i++) {
    if (existingUsers[i][0] === email) {
      return { success: false, error: 'Email вече съществува!' };
    }
  }
  
  // Add new user
  const hashedPassword = hashPassword(password);
  const timestamp = new Date();
  
  // Columns: Email, Password, Name, Created, AutoSendToMe, AutoSendToManager, ManagerEmail, TargetPercent, LastLogin, Status
  sheet.appendRow([email, hashedPassword, name, timestamp, false, false, '', 60, '', 'active']);
  
  return { 
    success: true, 
    user: { email, name }
  };
}

function login(data) {
  const sheet = getSpreadsheet().getSheetByName('Users');
  const email = data.email;
  const password = data.password;
  
  if (!email || !password) {
    return { success: false, error: 'Email и парола са задължителни!' };
  }
  
  const hashedPassword = hashPassword(password);
  const users = sheet.getDataRange().getValues();
  
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === email) {
      // Email found - check password
      if (users[i][1] === hashedPassword) {
        
        const status = users[i][9] || 'active';
        if (status === 'deactivated') {
          return { success: false, error: 'Този акаунт е деактивиран. Свържи се с администратор.' };
        }
        
        // Update LastLogin timestamp (column I = index 9, 1-based col 9)
        sheet.getRange(i + 1, 9).setValue(new Date());
        
        return { 
          success: true,
          user: {
            email: users[i][0],
            name: users[i][2],
            autoSendToMe: users[i][4],
            autoSendToManager: users[i][5],
            managerEmail: users[i][6],
            targetPercent: users[i][7] || 60
          }
        };
      } else {
        // Email found but wrong password
        return { success: false, error: 'Грешна парола!' };
      }
    }
  }
  
  return { success: false, error: 'Потребителят не е намерен!' };
}

// ============================================
// ATTENDANCE MANAGEMENT
// ============================================
function saveAttendance(data) {
  const sheet = getSpreadsheet().getSheetByName('Attendance');
  const email = data.email;
  const dateString = data.date; // Keep as string YYYY-MM-DD
  const type = data.type;
  const timestamp = new Date();
  
  if (!email || !dateString || !type) {
    return { success: false, error: 'Email, дата и тип са задължителни!' };
  }
  
  // Check if entry exists
  const attendance = sheet.getDataRange().getValues();
  let found = false;
  
  for (let i = 1; i < attendance.length; i++) {
    // Always compare as strings
    const existingDate = attendance[i][1].toString();
    
    if (attendance[i][0] === email && existingDate === dateString) {
      // Update existing
      sheet.getRange(i + 1, 3).setValue(type);
      sheet.getRange(i + 1, 4).setValue(timestamp);
      found = true;
      break;
    }
  }
  
  if (!found) {
    // Add new - store date as STRING to avoid timezone issues
    sheet.appendRow([email, dateString, type, timestamp]);
  }
  
  return { success: true };
}

function loadAttendance(data) {
  const sheet = getSpreadsheet().getSheetByName('Attendance');
  const email = data.email;
  
  if (!email) {
    return { success: false, error: 'Email е задължителен!' };
  }
  
  const attendance = sheet.getDataRange().getValues();
  const userAttendance = {};
  
  for (let i = 1; i < attendance.length; i++) {
    if (attendance[i][0] === email) {
      const dateValue = attendance[i][1];
      let dateStr;
      
      if (dateValue instanceof Date) {
        // Convert Date object to YYYY-MM-DD string
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      } else if (typeof dateValue === 'string') {
        // Already a string - check if it's in YYYY-MM-DD format
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dateStr = dateValue;
        } else {
          // Try to parse and reformat
          const parsed = new Date(dateValue);
          if (!isNaN(parsed.getTime())) {
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
          } else {
            continue; // Skip invalid dates
          }
        }
      } else {
        continue; // Skip non-date values
      }
      
      userAttendance[dateStr] = attendance[i][2];
    }
  }
  
  return { 
    success: true, 
    data: userAttendance 
  };
}

// ============================================
// SETTINGS MANAGEMENT
// ============================================
function updateSettings(data) {
  const sheet = getSpreadsheet().getSheetByName('Users');
  const email = data.email;
  
  const users = sheet.getDataRange().getValues();
  
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === email) {
      if (data.hasOwnProperty('autoSendToMe')) {
        sheet.getRange(i + 1, 5).setValue(data.autoSendToMe);
      }
      if (data.hasOwnProperty('autoSendToManager')) {
        sheet.getRange(i + 1, 6).setValue(data.autoSendToManager);
      }
      if (data.hasOwnProperty('managerEmail')) {
        sheet.getRange(i + 1, 7).setValue(data.managerEmail);
      }
      if (data.hasOwnProperty('targetPercent')) {
        sheet.getRange(i + 1, 8).setValue(data.targetPercent);
      }
      
      return { success: true };
    }
  }
  
  return { success: false, error: 'User not found' };
}

// ============================================
// ADMIN ACTIONS
// (всяка от тях изисква парола + GitHub token, проверени сървърно)
// ============================================
function adminGetStats(data) {
  const auth = verifyAdmin(data.adminPassword, data.githubToken);
  if (!auth.valid) return { success: false, error: auth.error };
  
  const sheet = getSpreadsheet().getSheetByName('Users');
  const users = sheet.getDataRange().getValues();
  
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  let totalUsers = 0;
  let activeLast30Days = 0;
  let everLoggedIn = 0;
  let autoSendCount = 0;
  const userList = [];
  
  for (let i = 1; i < users.length; i++) {
    totalUsers++;
    
    const lastLogin = users[i][8];
    const status = users[i][9] || 'active';
    const autoSendToMe = users[i][4];
    const autoSendToManager = users[i][5];
    
    let lastLoginStr = 'Никога';
    let hasLoggedIn = false;
    
    if (lastLogin) {
      hasLoggedIn = true;
      everLoggedIn++;
      const lastLoginDate = new Date(lastLogin);
      lastLoginStr = Utilities.formatDate(lastLoginDate, 'GMT+2', 'dd.MM.yyyy HH:mm');
      
      if (lastLoginDate >= thirtyDaysAgo) {
        activeLast30Days++;
      }
    }
    
    if (autoSendToMe || autoSendToManager) {
      autoSendCount++;
    }
    
    userList.push({
      email: users[i][0],
      name: users[i][2],
      created: Utilities.formatDate(new Date(users[i][3]), 'GMT+2', 'dd.MM.yyyy'),
      lastLogin: lastLoginStr,
      status: status,
      autoSendToMe: !!autoSendToMe,
      autoSendToManager: !!autoSendToManager,
      targetPercent: users[i][7] || 60
    });
  }
  
  return {
    success: true,
    stats: {
      totalUsers,
      activeLast30Days,
      everLoggedIn,
      autoSendCount
    },
    users: userList
  };
}

function adminResetPassword(data) {
  const auth = verifyAdmin(data.adminPassword, data.githubToken);
  if (!auth.valid) return { success: false, error: auth.error };
  
  const email = data.targetEmail;
  const newPassword = data.newPassword;
  
  if (!email || !newPassword || newPassword.length < 6) {
    return { success: false, error: 'Email и нова парола (мин. 6 символа) са задължителни!' };
  }
  
  const sheet = getSpreadsheet().getSheetByName('Users');
  const users = sheet.getDataRange().getValues();
  
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === email) {
      sheet.getRange(i + 1, 2).setValue(hashPassword(newPassword));
      return { success: true, message: `Паролата на ${email} е сменена!` };
    }
  }
  
  return { success: false, error: 'Потребителят не е намерен!' };
}

function adminSetUserStatus(data) {
  const auth = verifyAdmin(data.adminPassword, data.githubToken);
  if (!auth.valid) return { success: false, error: auth.error };
  
  const email = data.targetEmail;
  const newStatus = data.newStatus; // 'active' или 'deactivated'
  
  if (!email || (newStatus !== 'active' && newStatus !== 'deactivated')) {
    return { success: false, error: 'Невалидни параметри!' };
  }
  
  const sheet = getSpreadsheet().getSheetByName('Users');
  const users = sheet.getDataRange().getValues();
  
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === email) {
      sheet.getRange(i + 1, 10).setValue(newStatus);
      return { success: true, message: `${email} вече е "${newStatus}"` };
    }
  }
  
  return { success: false, error: 'Потребителят не е намерен!' };
}

function adminDeleteUser(data) {
  const auth = verifyAdmin(data.adminPassword, data.githubToken);
  if (!auth.valid) return { success: false, error: auth.error };
  
  const email = data.targetEmail;
  if (!email) return { success: false, error: 'Email е задължителен!' };
  
  const usersSheet = getSpreadsheet().getSheetByName('Users');
  const users = usersSheet.getDataRange().getValues();
  
  let deletedUser = false;
  for (let i = users.length - 1; i >= 1; i--) {
    if (users[i][0] === email) {
      usersSheet.deleteRow(i + 1);
      deletedUser = true;
      break;
    }
  }
  
  if (!deletedUser) {
    return { success: false, error: 'Потребителят не е намерен!' };
  }
  
  // Also delete their attendance records
  const attendanceSheet = getSpreadsheet().getSheetByName('Attendance');
  const attendance = attendanceSheet.getDataRange().getValues();
  
  for (let i = attendance.length - 1; i >= 1; i--) {
    if (attendance[i][0] === email) {
      attendanceSheet.deleteRow(i + 1);
    }
  }
  
  return { success: true, message: `${email} и всичките му записи са изтрити!` };
}

// ============================================
// EMAIL REPORTING
// ============================================
function sendReport(data) {
  const email = data.email;
  const reportHTML = data.reportHTML;
  const toEmails = data.toEmails || [email];
  
  const subject = `📊 Офис Тракер - Отчет ${Utilities.formatDate(new Date(), 'GMT+2', 'dd.MM.yyyy')}`;
  
  toEmails.forEach(recipient => {
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      htmlBody: reportHTML,
      name: 'Офис Тракер репорт | Bozhidar Stoykov'
    });
  });
  
  return { 
    success: true, 
    message: `Email изпратен до ${toEmails.length} получател(и)` 
  };
}

// ============================================
// AUTOMATIC SCHEDULED REPORTS
// ============================================
function sendScheduledReports() {
  const usersSheet = getSpreadsheet().getSheetByName('Users');
  const attendanceSheet = getSpreadsheet().getSheetByName('Attendance');
  
  const users = usersSheet.getDataRange().getValues();
  
  for (let i = 1; i < users.length; i++) {
    const userEmail = users[i][0];
    const userName = users[i][2];
    const autoSendToMe = users[i][4];
    const autoSendToManager = users[i][5];
    const managerEmail = users[i][6];
    const targetPercent = users[i][7] || 60;
    
    if (!autoSendToMe && !autoSendToManager) continue;
    
    // Get user attendance data
    const attendance = attendanceSheet.getDataRange().getValues();
    const userAttendance = {};
    
    for (let j = 1; j < attendance.length; j++) {
      if (attendance[j][0] === userEmail) {
        const dateValue = attendance[j][1];
        let dateStr;
        if (dateValue instanceof Date) {
          const year = dateValue.getFullYear();
          const month = String(dateValue.getMonth() + 1).padStart(2, '0');
          const day = String(dateValue.getDate()).padStart(2, '0');
          dateStr = `${year}-${month}-${day}`;
        } else {
          dateStr = dateValue.toString();
        }
        userAttendance[dateStr] = attendance[j][2];
      }
    }
    
    // Generate report using the user's own target percent
    const reportHTML = generateReportHTML(userName, userEmail, userAttendance, targetPercent);
    
    // Send emails
    const recipients = [];
    if (autoSendToMe) recipients.push(userEmail);
    if (autoSendToManager && managerEmail) recipients.push(managerEmail);
    
    if (recipients.length > 0) {
      const subject = `📊 Офис Тракер - Автоматичен отчет ${Utilities.formatDate(new Date(), 'GMT+2', 'dd.MM.yyyy')}`;
      
      recipients.forEach(recipient => {
        MailApp.sendEmail({
          to: recipient,
          subject: subject,
          htmlBody: reportHTML,
          name: 'Офис Тракер репорт | Bozhidar Stoykov'
        });
      });
      
      Logger.log(`Report sent to: ${recipients.join(', ')}`);
    }
  }
}

// ============================================
// REPORT GENERATION
// ============================================
function generateReportHTML(name, email, attendanceData, targetPercent) {
  targetPercent = targetPercent || 60;
  const today = new Date();
  const stats = calculateStats(attendanceData, today, targetPercent);
  
  return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h2 { color: #667eea; }
          h3 { color: #333; margin-top: 25px; }
          .stat { margin: 10px 0; }
          .stat strong { color: #667eea; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e0e0e0; color: #666; font-size: 0.9em; }
        </style>
      </head>
      <body>
        <h2>📊 ОФИС ТРАКЕР - ОТЧЕТ</h2>
        
        <p>Здравей${name ? ' ' + name : ''}!</p>
        <p>📅 Дата: ${Utilities.formatDate(today, 'GMT+2', 'dd MMMM yyyy', 'bg')}</p>
        <p style="color: #999; font-size: 0.85em;">🎯 Целева база: ${targetPercent}% / ${100 - targetPercent}%</p>
        
        <hr>
        
        <h3>📍 СЕДМИЧНА СТАТИСТИКА</h3>
        <div class="stat">🏢 Офис: ${stats.week.office} дни</div>
        <div class="stat">🏠 Home Office: ${stats.week.home} дни</div>
        <div class="stat">🎯 Комплайънс: ${stats.week.compliance}% ${stats.week.compliance >= targetPercent ? '✅' : '⚠️'}</div>
        <div class="stat">⚡ Остават: ${stats.week.remaining} ${stats.week.remaining === 0 ? '(цел постигната!)' : 'офис дни'}</div>
        
        <h3>📍 МЕСЕЧНА СТАТИСТИКА</h3>
        <div class="stat">🏢 Офис: ${stats.month.office} дни</div>
        <div class="stat">🏠 Home Office: ${stats.month.home} дни</div>
        <div class="stat">🌴 Почивка: ${stats.month.vacation} дни</div>
        <div class="stat">🎯 Комплайънс: ${stats.month.compliance}% ${stats.month.compliance >= targetPercent ? '✅' : '⚠️'}</div>
        <div class="stat">⚡ Остават: ${stats.month.remaining} ${stats.month.remaining === 0 ? '(цел постигната!)' : 'офис дни'}</div>
        
        <h3>📍 ТРИМЕСЕЧНА СТАТИСТИКА</h3>
        <div class="stat">🏢 Офис: ${stats.quarter.office} дни</div>
        <div class="stat">🏠 Home Office: ${stats.quarter.home} дни</div>
        <div class="stat">🌴 Почивка: ${stats.quarter.vacation} дни</div>
        <div class="stat">🎉 Празници: ${stats.quarter.holidays} дни</div>
        <div class="stat">🎯 Комплайънс: ${stats.quarter.compliance}% ${stats.quarter.compliance >= targetPercent ? '✅' : '⚠️'}</div>
        <div class="stat">⚡ Остават: ${stats.quarter.remaining} ${stats.quarter.remaining === 0 ? '(комплайънт!)' : 'офис дни'}</div>
        
        <div class="footer">
          <p><strong>Офис Тракер 3x2</strong> by Bozhidar Stoykov</p>
        </div>
      </body>
    </html>
  `;
}

// ============================================
// DATE RANGE HELPERS (server-side, mirrors client logic)
// ============================================
function getDateRangeGAS(period, today) {
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let startDate, endDate;

  if (period === 'week') {
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate = new Date(today);
    startDate.setDate(today.getDate() + diff);
    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
  } else if (period === 'month') {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (period === 'quarter') {
    const currentMonth = today.getMonth();
    const quarterStartMonth = Math.floor(currentMonth / 3) * 3;
    startDate = new Date(today.getFullYear(), quarterStartMonth, 1);
    endDate = new Date(today.getFullYear(), quarterStartMonth + 3, 0);
  }

  return { startDate, endDate };
}

function getWorkingDaysInRangeGAS(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function calculatePeriodStats(attendanceData, period, today, targetPercent) {
  const { startDate, endDate } = getDateRangeGAS(period, today);
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let officeDays = 0, homeDays = 0, vacationDays = 0, holidayDays = 0, autoHomeDays = 0;

  const current = new Date(startDate);
  while (current <= endDate) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const dStr = `${year}-${month}-${day}`;

    const dayOfWeek = current.getDay();

    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const recordedType = attendanceData[dStr];
      if (recordedType === 'office') officeDays++;
      else if (recordedType === 'home') homeDays++;
      else if (recordedType === 'vacation') vacationDays++;
      else if (recordedType === 'holiday') holidayDays++;
      else if (current < todayNorm) autoHomeDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  const totalHomeDays = homeDays + autoHomeDays;
  const totalWorkingDays = getWorkingDaysInRangeGAS(startDate, endDate);
  const availableWorkingDays = totalWorkingDays - vacationDays - holidayDays;
  const targetOfficeDays = Math.round(availableWorkingDays * (targetPercent / 100));
  const compliancePercent = availableWorkingDays > 0 ? (officeDays / availableWorkingDays * 100) : 0;
  const remainingOfficeDays = Math.max(0, targetOfficeDays - officeDays);

  return {
    office: officeDays,
    home: totalHomeDays,
    vacation: vacationDays,
    holidays: holidayDays,
    compliance: Math.round(compliancePercent),
    remaining: remainingOfficeDays
  };
}

function calculateStats(attendanceData, today, targetPercent) {
  targetPercent = targetPercent || 60;
  return {
    week: calculatePeriodStats(attendanceData, 'week', today, targetPercent),
    month: calculatePeriodStats(attendanceData, 'month', today, targetPercent),
    quarter: calculatePeriodStats(attendanceData, 'quarter', today, targetPercent)
  };
}

// ============================================
// SETUP TRIGGER (Run this once manually)
// ============================================
function setupTrigger() {
  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  // Create new trigger for every 4 days at 5 PM
  ScriptApp.newTrigger('sendScheduledReports')
    .timeBased()
    .everyDays(4)
    .atHour(17)
    .create();
    
  Logger.log('Trigger created successfully!');
}
