// ==========================================
// 1. ГЛОБАЛЬНИЙ СТАН
// ==========================================
let currentUser = null;
let currentUserId = null;
let currentWorkspace = 'personal'; // 'personal' або user_id/email іншого кабінету
let personalDB = null;            // Твої особисті дані
let sharedWorkspaces = [];        // Список кабінетів, до яких є доступ
let DB = { projects: [], income: [], sharedUsers: [] }; // Активна база даних
let isReadOnlyMode = false;       // Прапорець "тільки для читання"

// ==========================================
// 2. ІНІЦІАЛІЗАЦІЯ ТА АВТОРИЗАЦІЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Слухаємо стан авторизації в Supabase
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      currentUserId = session.user.id;
      
      // Перемикаємо екрани
      document.getElementById('auth-screen')?.classList.add('hidden');
      document.getElementById('main-app')?.classList.remove('hidden');

      // Підтягуємо всі доступні простори
      await loadAllWorkspaces();
    } else {
      // Показуємо логін, ховаємо додаток
      document.getElementById('auth-screen')?.classList.remove('hidden');
      document.getElementById('main-app')?.classList.add('hidden');
    }
  });
});

// ==========================================
// 3. РОБОТА З ПРОСТОРАМИ (WORKSPACES)
// ==========================================
async function loadAllWorkspaces() {
  if (!currentUser) return;
  const userEmail = currentUser.email;

  // 1. Завантажуємо свій кабінет
  const { data: ownData } = await supabase
    .from('crm_data')
    .select('*')
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (ownData && ownData.data) {
    personalDB = ownData.data;
  } else {
    // Якщо акаунт новий - створюємо дефолтну структуру
    personalDB = { projects: [], income: [], sharedUsers: [] };
  }

  // 2. Шукаємо чужі кабінети, де зашерено на наш email
  const { data: sharedData } = await supabase
    .from('crm_data')
    .select('*')
    .neq('user_id', currentUserId)
    .contains('data', { sharedUsers: [userEmail] });

  sharedWorkspaces = sharedData || [];

  // Оновлюємо селектор просторів у шапці/сайдбарі
  renderWorkspaceSelector();
  
  // Активуємо обраний простір
  switchWorkspace(currentWorkspace);
}

function switchWorkspace(workspaceId) {
  currentWorkspace = workspaceId;

  if (workspaceId === 'personal') {
    // Працюємо зі своїми проєктами
    DB = personalDB;
    setReadOnlyMode(false); // Повний доступ на редагування
  } else {
    // Працюємо в чужому просторі
    const targetWorkspace = sharedWorkspaces.find(w => w.user_id === workspaceId);
    if (targetWorkspace) {
      DB = targetWorkspace.data || { projects: [], income: [] };
      // Чужий простір за замовчуванням у режимі перегляду
      setReadOnlyMode(true); 
    }
  }

  // Перемальовуємо весь інтерфейс
  renderApp(); 
}

// ==========================================
// 4. АВТОЗБЕРЕЖЕННЯ В SUPABASE
// ==========================================
let saveTimeout = null;

// Викликай цієї функцію щоразу, коли міняєш DB (додав проєкт, змінив статус тощо)
function triggerAutoSave() {
  if (isReadOnlyMode) return; // У чужому кабінеті зберігати не даємо
  
  clearTimeout(saveTimeout);
  // Пауза 800мс після останньої дії перед записом в базу
  saveTimeout = setTimeout(() => {
    _doSave();
  }, 800);
}

async function _doSave() {
  if (!currentUserId) return;

  const targetUserId = (currentWorkspace === 'personal') 
    ? currentUserId 
    : currentWorkspace; // Записуємо в user_id власника простору

  const { error } = await supabase
    .from('crm_data')
    .upsert({
      user_id: targetUserId,
      data: DB,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('Помилка збереження:', error.message);
  } else {
    console.log('Збережено в Supabase!');
  }
}

// ==========================================
// 5. РЕНДЕРИНГ ІНТЕРФЕЙСУ ТА РЕЖИМИ
// ==========================================
function renderWorkspaceSelector() {
  const selector = document.getElementById('workspace-selector');
  if (!selector) return;

  let html = `<option value="personal"> Мій кабінет</option>`;
  
  sharedWorkspaces.forEach((ws, idx) => {
    const title = ws.data?.workspaceName || `Кабінет клієнта #${idx + 1}`;
    html += `<option value="${ws.user_id}"> ${title}</option>`;
  });

  selector.innerHTML = html;
  selector.value = currentWorkspace;

  // Подія перемикання кабінету
  selector.onchange = (e) => switchWorkspace(e.target.value);
}

function setReadOnlyMode(readOnly) {
  isReadOnlyMode = readOnly;
  
  // Ховаємо або блокуємо елементи керування, якщо це перегляд
  const writeElements = document.querySelectorAll('.action-btn-write, #btn-add-project, .btn-delete-proj');
  writeElements.forEach(el => {
    if (readOnly) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  });

  // Бейдж режиму "Тільки перегляд"
  const readOnlyBadge = document.getElementById('readonly-badge');
  if (readOnlyBadge) {
    readOnlyBadge.classList.toggle('hidden', !readOnly);
  }
}

function renderApp() {
  // Головний диспетчер перемальовування
  renderProjectsList();
  renderStats();
}

function renderProjectsList() {
  const container = document.getElementById('projects-container');
  if (!container) return;

  if (!DB.projects || DB.projects.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-gray-400">Проєктів поки немає</div>`;
    return;
  }

  // Оновлюємо список (верстка підтягнеться з твоїх стилів)
  container.innerHTML = DB.projects.map(project => `
    <div class="p-4 bg-white dark:bg-slate-800 rounded-xl mb-3 shadow-sm flex justify-between items-center">
      <div>
        <h3 class="font-bold text-gray-800 dark:text-white">${project.title}</h3>
        <p class="text-xs text-gray-500">Клієнт: ${project.client || 'Не вказано'} | $${project.price || 0}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-2.5 py-1 text-xs rounded-full bg-blue-50 text-blue-600 font-medium">
          ${project.status || 'В роботі'}
        </span>
        ${!isReadOnlyMode ? `
          <button onclick="deleteProject('${project.id}')" class="btn-delete-proj text-red-400 hover:text-red-600 p-1">
            🗑️
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function renderStats() {
  const totalIncomeEl = document.getElementById('stat-total-income');
  if (!totalIncomeEl) return;

  const total = (DB.projects || []).reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  totalIncomeEl.innerText = `$${total}`;
}

// ==========================================
// 6. ХЕЛПЕРИ ДЛЯ ЗМІНИ ДАНИХ (CRUD)
// ==========================================
function addProject(projectData) {
  if (isReadOnlyMode) return;

  if (!DB.projects) DB.projects = [];
  
  DB.projects.push({
    id: 'proj_' + Date.now(),
    createdAt: new Date().toISOString(),
    ...projectData
  });

  renderApp();
  triggerAutoSave();
}

function deleteProject(id) {
  if (isReadOnlyMode) return;

  DB.projects = DB.projects.filter(p => p.id !== id);
  renderApp();
  triggerAutoSave();
}