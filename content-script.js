const DEFAULT_SETTINGS = {
    workMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    sessionsPerBlock: 4,
};

const DEFAULT_TIMER = {
    phase: 'work',
    status: 'idle',
    endsAt: null,
    remainingMs: null,
    startedAt: null,
    plannedMs: null,
    completedSessions: 0,
    sessionsToday: 0,
    day: null,
};

const PHASE_LABEL = {
    work: 'Работа',
    shortBreak: 'Короткий перерыв',
    longBreak: 'Длинный перерыв',
};

const PHASE_SETTING = {
    work: 'workMinutes',
    shortBreak: 'shortMinutes',
    longBreak: 'longMinutes',
};

const START_LABEL = {
    running: 'Пауза',
    paused: 'Продолжить',
    idle: 'Запустить',
};

const HISTORY_VISIBLE = 50;

const host = document.createElement('div');
host.style.display = 'none';
document.body.appendChild(host);

const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `
<link rel="stylesheet" href="${chrome.runtime.getURL('styles.css')}">
<div class="widget">
    <div class="head">
        <h2>Pomodoro</h2>
        <button id="close" title="Закрыть">×</button>
    </div>

    <div class="top">
        <div class="clock">
            <div id="phase" class="phase">Работа</div>
            <div id="timer" class="timer">25:00</div>
        </div>
        <dl class="stats">
            <dt>В фокусе сегодня</dt>
            <dd id="focusToday">0 мин</dd>
            <dt>Сессий за день</dt>
            <dd id="sessionsToday">0</dd>
            <dt>Сессий в блоке</dt>
            <dd id="sessionsInBlock">0 / 4</dd>
        </dl>
    </div>

    <div class="controls">
        <button id="start" class="btn btn-primary">Запустить</button>
        <button id="reset" class="btn">Сбросить</button>
        <button id="skip" class="btn">Пропустить</button>
        <span class="spacer"></span>
        <button id="tune" class="btn btn-quiet">Настроить</button>
        <button id="toggleHistory" class="btn btn-quiet">История</button>
    </div>

    <div class="history" id="history">
        <div class="history-head">
            <h3>История</h3>
            <button id="clearHistory" class="btn btn-quiet">Очистить</button>
        </div>
        <ul class="history-list" id="historyList"></ul>
    </div>

    <div class="modal" id="modal">
        <h3>Настройки</h3>
        <label for="workMinutes">
            <span>Минут рабочей сессии</span>
            <input type="number" min="1" id="workMinutes">
        </label>
        <label for="shortMinutes">
            <span>Минут короткого перерыва</span>
            <input type="number" min="1" id="shortMinutes">
        </label>
        <label for="longMinutes">
            <span>Минут длинного перерыва</span>
            <input type="number" min="1" id="longMinutes">
        </label>
        <label for="sessionsPerBlock">
            <span>Сессий в блоке</span>
            <input type="number" min="1" id="sessionsPerBlock">
        </label>
        <div class="controls">
            <button id="save" class="btn btn-primary">Сохранить</button>
            <button id="cancel" class="btn">Отмена</button>
        </div>
    </div>
</div>
`;

const el = {
    widget: shadow.querySelector('.widget'),
    phase: shadow.querySelector('#phase'),
    timer: shadow.querySelector('#timer'),
    start: shadow.querySelector('#start'),
    reset: shadow.querySelector('#reset'),
    skip: shadow.querySelector('#skip'),
    tune: shadow.querySelector('#tune'),
    save: shadow.querySelector('#save'),
    cancel: shadow.querySelector('#cancel'),
    close: shadow.querySelector('#close'),
    modal: shadow.querySelector('#modal'),
    focusToday: shadow.querySelector('#focusToday'),
    sessionsToday: shadow.querySelector('#sessionsToday'),
    sessionsInBlock: shadow.querySelector('#sessionsInBlock'),
    toggleHistory: shadow.querySelector('#toggleHistory'),
    clearHistory: shadow.querySelector('#clearHistory'),
    history: shadow.querySelector('#history'),
    historyList: shadow.querySelector('#historyList'),
};

const SETTING_KEYS = ['workMinutes', 'shortMinutes', 'longMinutes', 'sessionsPerBlock'];
const inputs = {
    workMinutes: shadow.querySelector('#workMinutes'),
    shortMinutes: shadow.querySelector('#shortMinutes'),
    longMinutes: shadow.querySelector('#longMinutes'),
    sessionsPerBlock: shadow.querySelector('#sessionsPerBlock'),
};

let settings = { ...DEFAULT_SETTINGS };
let timer = { ...DEFAULT_TIMER };
let history = [];
let historyOpen = false;
let tickId = null;

const phaseDurationMs = (phase) => {
    const minutes = Number(settings[PHASE_SETTING[phase]]);
    return Math.max(1, minutes || 1) * 60_000;
};

const remainingMs = () => {
    if (timer.status === 'running') return Math.max(0, timer.endsAt - Date.now());
    if (timer.status === 'paused') return Math.max(0, timer.remainingMs || 0);
    return phaseDurationMs(timer.phase);
};

const formatClock = (ms) => {
    const total = Math.ceil(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
};

const formatTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

const minutesOf = (ms) => Math.round(ms / 60_000);

const isSameDay = (ts, date) => new Date(ts).toDateString() === date.toDateString();

// --- rendering ---

const renderClock = () => {
    el.timer.textContent = formatClock(remainingMs());
};

const renderHistory = () => {
    el.history.classList.toggle('open', historyOpen);
    el.toggleHistory.textContent = historyOpen ? 'Скрыть историю' : 'История';
    if (!historyOpen) return;

    el.historyList.replaceChildren();

    if (history.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'history-empty';
        empty.textContent = 'Пока пусто. Заверши первую сессию.';
        el.historyList.append(empty);
        return;
    }

    for (const entry of history.slice(0, HISTORY_VISIBLE)) {
        const item = document.createElement('li');
        item.className = entry.completed ? 'history-item' : 'history-item interrupted';
        item.dataset.phase = entry.phase;

        const time = document.createElement('span');
        time.className = 'history-time';
        time.textContent = `${formatTime(entry.startedAt)}–${formatTime(entry.endedAt)}`;

        const label = document.createElement('span');
        label.className = 'history-label';
        label.textContent = PHASE_LABEL[entry.phase];

        const duration = document.createElement('span');
        duration.className = 'history-duration';
        duration.textContent = entry.completed
            ? `${minutesOf(entry.plannedMs)} мин`
            : `${minutesOf(entry.actualMs)} / ${minutesOf(entry.plannedMs)} мин · прервано`;

        item.append(time, label, duration);
        el.historyList.append(item);
    }
};

const renderStats = () => {
    const now = new Date();
    const focusedMs = history
        .filter((entry) => entry.phase === 'work' && isSameDay(entry.endedAt, now))
        .reduce((sum, entry) => sum + entry.actualMs, 0);

    el.focusToday.textContent = `${minutesOf(focusedMs)} мин`;
    el.sessionsToday.textContent = String(timer.sessionsToday);
    el.sessionsInBlock.textContent = `${timer.completedSessions} / ${settings.sessionsPerBlock}`;
};

const render = () => {
    renderClock();
    el.phase.textContent = PHASE_LABEL[timer.phase];
    el.phase.dataset.phase = timer.phase;
    el.start.textContent = START_LABEL[timer.status];
    renderStats();
    renderHistory();

    clearInterval(tickId);
    tickId = null;
    if (timer.status === 'running') {
        tickId = setInterval(renderClock, 250);
    }
};

// --- widget visibility ---

const isVisible = () => host.style.display !== 'none';

const closeSettings = () => el.widget.classList.remove('settings-open');

const hideWidget = () => {
    closeSettings();
    host.style.display = 'none';
};

const toggleWidget = () => {
    if (isVisible()) {
        hideWidget();
    } else {
        host.style.display = 'block';
    }
};

// --- UI events ---

el.start.addEventListener('click', () => {
    const action = timer.status === 'running' ? 'pause' : 'start';
    chrome.runtime.sendMessage({ action });
});
el.reset.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'reset' }));
el.skip.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'skip' }));
el.close.addEventListener('click', hideWidget);

// Esc closes the settings first, then the widget itself.
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isVisible()) return;

    if (el.widget.classList.contains('settings-open')) {
        closeSettings();
    } else {
        hideWidget();
    }
});

// A click outside dismisses the settings, but leaves the timer on screen.
document.addEventListener('pointerdown', (event) => {
    if (!isVisible() || !el.widget.classList.contains('settings-open')) return;
    if (event.composedPath().includes(host)) return;
    closeSettings();
});

el.tune.addEventListener('click', () => {
    for (const key of SETTING_KEYS) inputs[key].value = settings[key];
    el.widget.classList.add('settings-open');
});
el.cancel.addEventListener('click', closeSettings);

el.save.addEventListener('click', async () => {
    const next = { ...settings };
    for (const key of SETTING_KEYS) {
        const value = Math.floor(Number(inputs[key].value));
        if (Number.isFinite(value) && value >= 1) next[key] = value;
    }
    await chrome.storage.local.set({ settings: next });
    closeSettings();
});

el.toggleHistory.addEventListener('click', () => {
    historyOpen = !historyOpen;
    renderHistory();
});

el.clearHistory.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear-history' });
});

// --- storage sync ---

chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    if (changes.timer) timer = { ...DEFAULT_TIMER, ...changes.timer.newValue };
    if (changes.history) history = changes.history.newValue || [];
    if (changes.settings || changes.timer || changes.history) render();
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggle-widget') toggleWidget();
});

(async () => {
    const stored = await chrome.storage.local.get(['settings', 'timer', 'history']);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    timer = { ...DEFAULT_TIMER, ...(stored.timer || {}) };
    history = stored.history || [];
    render();
})();