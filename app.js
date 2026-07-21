// ==========================================
// 1. ГЛОБАЛЬНИЙ СТАН
// ==========================================
window.currentUser = null;
window.currentUserId = null;
window.currentWorkspace = 'personal'; 
window.personalDB = null;            
window.sharedWorkspaces = [];        
window.DB = { projects: [], income: [], sharedUsers: [] }; 
window.isReadOnlyMode = false;       

// ==========================================
// 2. ІНІЦІАЛІЗАЦІЯ ТА АВТОРИЗАЦІЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Перевіряємо, чи підключено Supabase
  if (typeof supabase === 'undefined') {
    console.error('Supabase SDK не знайдено! Перевір підключення скрипта Supabase в index.html перед app.js');
    return;
  }

  // Слухаємо стан авторизації
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      window.currentUser = session.user;
      window.currentUserId = session.user.id;
      
      document.getElementById('auth-screen')?.classList.add('hidden');
      document.getElementById('main-app')?.classList.remove('hidden');

      await loadAllWorkspaces();
    } else {
      document.getElementById('auth-screen')?.classList.remove('hidden');
      document.getElementById('main-app')?.classList.add('hidden');
    }
  });
});

// ==========================================
// 3. РОБОТА З ПРОСТОРАМИ (WORKSPACES)
// ==========================================
async function loadAllWorkspaces() {
  if (!window.currentUser) return;
  const userEmail = window.currentUser.email;

  try {
    // 1. Завантажуємо свій кабінет
    const { data: ownData, error: ownError } = await supabase
      .from('crm_data')
      .select('*')
      .eq('user_id', window.currentUserId)
      .maybeSingle();

    if (ownError) console.error('Помилка завантаження свого кабінету:', ownError.message);

    if (ownData && ownData.data) {
      window.personalDB = ownData.data;
    } else {
      window.personalDB = { projects: [], income: [], sharedUsers: [] };
    }

    // 2. Шукаємо чужі кабінети
    const { data: sharedData, error: sharedError } = await supabase
      .from('crm_data')
      .select('*')
      .neq('user_id', window.currentUserId)
      .contains('data', { sharedUsers: [userEmail] });

    if (sharedError) console.error('Помилка завантаження спільного доступу:', sharedError.message);

    window.sharedWorkspaces = sharedData || [];

    renderWorkspaceSelector();
    switchWorkspace(window.currentWorkspace);
  } catch (e) {
    console.error('Помилка в loadAllWorkspaces:', e);
  }
}

function switchWorkspace(workspaceId) {
  window.currentWorkspace = workspaceId;

  if (workspaceId === 'personal') {
    window.DB = window.personalDB || { projects: [], income: [], sharedUsers: [] };
    setReadOnlyMode(false);
  } else {
    const targetWorkspace = window.sharedWorkspaces.find(w => w.user_id === workspaceId);
    if (targetWorkspace) {
      window.DB = targetWorkspace.data || { projects: [], income: [], sharedUsers: [] };
      setReadOnlyMode(true); 
    }
  }

  // Захист від відсутності необхідних масивів
  if (!window.DB.projects) window.DB.projects = [];
  if (!window.DB.income) window.DB.income = [];

  renderApp(); 
}

// ==========================================
// 4. АВТОЗБЕРЕЖЕННЯ В SUPABASE
// ==========================================
let saveTimeout = null;

function triggerAutoSave() {
  if (window.isReadOnlyMode) return;
  
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    _doSave();
  }, 800);
}

async function _doSave() {
  if (!window.currentUserId) return;

  const targetUserId = (window.currentWorkspace === 'personal') 
    ? window.currentUserId 
    : window.currentWorkspace;

  const { error } = await supabase
    .from('crm_data')
    .upsert({
      user_id: targetUserId,
      data: window.DB,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('Помилка збереження в Supabase:', error.message);
  } else {
    console.log('Дані успішно збережено!');
  }
}

// ==========================================
// 5. РЕНДЕРИНГ ІНТЕРФЕЙСУ ТА КЕРУВАННЯ
// ==========================================
function renderWorkspaceSelector() {
  const selector = document.getElementById('workspace-selector');
  if (!selector) return;

  let html = `<option value="personal">Мій кабінет</option>`;
  
  (window.sharedWorkspaces || []).forEach((ws, idx) => {
    const title = ws.data?.workspaceName || `Кабінет клієнта #${idx + 1}`;
    html += `<option value="${ws.user_id}">${title}</option>`;
  });

  selector.innerHTML = html;
  selector.value = window.currentWorkspace;

  selector.onchange = (e) => switchWorkspace(e.target.value);
}

function setReadOnlyMode(readOnly) {
  window.isReadOnlyMode = readOnly;
  
  const writeElements = document.querySelectorAll('.action-btn-write, #btn-add-project, .btn-delete-proj');
  writeElements.forEach(el => {
    if (readOnly) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  });

  const readOnlyBadge = document.getElementById('readonly-badge');
  if (readOnlyBadge) {
    readOnlyBadge.classList.toggle('hidden', !readOnly);
  }
}

function renderApp() {
  renderProjectsList();
  renderStats();
}

function renderProjectsList() {
  const container = document.getElementById('projects-container');
  if (!container) return;

  const projects = window.DB?.projects || [];

  if (projects.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-gray-400">Проєктів поки немає</div>`;
    return;
  }

  container.innerHTML = projects.map(project => `
    <div class="p-4 bg-white dark:bg-slate-800 rounded-xl mb-3 shadow-sm flex justify-between items-center">
      <div>
        <h3 class="font-bold text-gray-800 dark:text-white">${project.title || 'Без назви'}</h3>
        <p class="text-xs text-gray-500">Клієнт: ${project.client || 'Не вказано'} | $${project.price || 0}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-2.5 py-1 text-xs rounded-full bg-blue-50 text-blue-600 font-medium">
          ${project.status || 'В роботі'}
        </span>
        ${!window.isReadOnlyMode ? `
          <button onclick="window.deleteProject('${project.id}')" class="btn-delete-proj text-red-400 hover:text-red-600 p-1">
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

  const projects = window.DB?.projects || [];
  const total = projects.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  totalIncomeEl.innerText = `$${total}`;
}

// ==========================================
// 6. ХЕЛПЕРИ ДЛЯ ЗМІНИ ДАНИХ (CRUD)
// ==========================================
function addProject(projectData) {
  if (window.isReadOnlyMode) return;

  if (!window.DB.projects) window.DB.projects = [];
  
  window.DB.projects.push({
    id: 'proj_' + Date.now(),
    createdAt: new Date().toISOString(),
    ...projectData
  });

  renderApp();
  triggerAutoSave();
}

function deleteProject(id) {
  if (window.isReadOnlyMode) return;

  window.DB.projects = (window.DB.projects || []).filter(p => p.id !== id);
  renderApp();
  triggerAutoSave();
}

// ==========================================
// 7. РЕЄСТРАЦІЯ ФУНКЦІЙ У ГЛОБАЛЬНОМУ ОБ'ЄКТІ WINDOW
// ==========================================
window.switchWorkspace = switchWorkspace;
window.addProject = addProject;
window.deleteProject = deleteProject;
window.triggerAutoSave = triggerAutoSave;
window.renderApp = renderApp;