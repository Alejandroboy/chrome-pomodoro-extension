const DEFAULT_SETTINGS = {
    workMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    sessionsPerBlock: 4,
    autoStartBreaks: true,
    autoStartWork: false,
};

const DEFAULT_TIMER = {
    phase: 'work',
    status: 'idle',
    endsAt: null,
    remainingMs: null,
    startedAt: null,
    plannedMs: null,
    completedSessions: 0,
};

const EMPTY_DAY = { focusMs: 0, breakMs: 0, sessions: 0, interrupted: 0 };

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
        <button id="toggleWeek" class="btn btn-quiet">Неделя</button>
        <button id="toggleHistory" class="btn btn-quiet">История</button>
    </div>

    <div class="week" id="week">
        <div class="panel-head">
            <h3>Неделя</h3>
            <span id="weekTotal" class="panel-note">0 мин</span>
            <button id="clearStats" class="btn btn-quiet" title="Стереть журнал и всю статистику">Сбросить</button>
        </div>
        <div class="week-bars" id="weekBars"></div>
    </div>

    <div class="history" id="history">
        <div class="panel-head">
            <h3>История</h3>
            <button id="clearHistory" class="btn btn-quiet" title="Очистить журнал, статистика останется">Очистить журнал</button>
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
        <label for="autoStartBreaks">
            <span>Начинать перерыв автоматически</span>
            <input type="checkbox" id="autoStartBreaks">
        </label>
        <label for="autoStartWork">
            <span>Начинать работу автоматически</span>
            <input type="checkbox" id="autoStartWork">
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
    toggleWeek: shadow.querySelector('#toggleWeek'),
    week: shadow.querySelector('#week'),
    weekBars: shadow.querySelector('#weekBars'),
    weekTotal: shadow.querySelector('#weekTotal'),
    clearStats: shadow.querySelector('#clearStats'),
    toggleHistory: shadow.querySelector('#toggleHistory'),
    clearHistory: shadow.querySelector('#clearHistory'),
    history: shadow.querySelector('#history'),
    historyList: shadow.querySelector('#historyList'),
};

const NUMBER_KEYS = ['workMinutes', 'shortMinutes', 'longMinutes', 'sessionsPerBlock'];
const FLAG_KEYS = ['autoStartBreaks', 'autoStartWork'];

const inputs = {
    workMinutes: shadow.querySelector('#workMinutes'),
    shortMinutes: shadow.querySelector('#shortMinutes'),
    longMinutes: shadow.querySelector('#longMinutes'),
    sessionsPerBlock: shadow.querySelector('#sessionsPerBlock'),
    autoStartBreaks: shadow.querySelector('#autoStartBreaks'),
    autoStartWork: shadow.querySelector('#autoStartWork'),
};

let settings = { ...DEFAULT_SETTINGS };
let timer = { ...DEFAULT_TIMER };
let history = [];
let daily = {};
let historyOpen = false;
let weekOpen = false;
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

// Local calendar date as 'YYYY-MM-DD' - must match the key the worker writes.
const dateKey = (ts = Date.now()) => {
    const date = new Date(ts);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

const dayTotals = (key) => ({ ...EMPTY_DAY, ...(daily[key] || {}) });

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

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEK_DAYS_SHOWN = 7;
const BAR_MIN_PERCENT = 3;   // so that an empty day still shows a baseline

// Focused minutes per day for the last 7 days, oldest first.
const weekStats = () => {
    const days = [];

    for (let offset = WEEK_DAYS_SHOWN - 1; offset >= 0; offset -= 1) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);

        const day = dayTotals(dateKey(date));
        days.push({
            label: WEEKDAYS[date.getDay()],
            isToday: offset === 0,
            minutes: minutesOf(day.focusMs),
            sessions: day.sessions,
        });
    }

    return days;
};

const renderWeek = () => {
    el.week.classList.toggle('open', weekOpen);
    el.toggleWeek.textContent = weekOpen ? 'Скрыть неделю' : 'Неделя';
    if (!weekOpen) return;

    const days = weekStats();
    const peak = Math.max(...days.map((day) => day.minutes));
    const total = days.reduce((sum, day) => sum + day.minutes, 0);
    el.weekTotal.textContent = `${total} мин за 7 дней`;

    el.weekBars.replaceChildren();

    for (const day of days) {
        const column = document.createElement('div');
        column.className = day.isToday ? 'week-day today' : 'week-day';
        column.title = `${day.minutes} мин · сессий: ${day.sessions}`;

        const value = document.createElement('span');
        value.className = 'week-value';
        value.textContent = day.minutes > 0 ? String(day.minutes) : '';

        const track = document.createElement('div');
        track.className = 'week-track';

        const bar = document.createElement('div');
        bar.className = 'week-bar';
        const share = peak > 0 ? (day.minutes / peak) * 100 : 0;
        bar.style.height = `${Math.max(BAR_MIN_PERCENT, share)}%`;

        const label = document.createElement('span');
        label.className = 'week-label';
        label.textContent = day.label;

        track.append(bar);
        column.append(value, track, label);
        el.weekBars.append(column);
    }
};

const renderStats = () => {
    const today = dayTotals(dateKey());

    el.focusToday.textContent = `${minutesOf(today.focusMs)} мин`;
    el.sessionsToday.textContent = String(today.sessions);
    el.sessionsInBlock.textContent = `${timer.completedSessions} / ${settings.sessionsPerBlock}`;
};

const render = () => {
    renderClock();
    el.phase.textContent = PHASE_LABEL[timer.phase];
    el.phase.dataset.phase = timer.phase;
    el.start.textContent = START_LABEL[timer.status];
    renderStats();
    renderWeek();
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
    for (const key of NUMBER_KEYS) inputs[key].value = settings[key];
    for (const key of FLAG_KEYS) inputs[key].checked = Boolean(settings[key]);
    el.widget.classList.add('settings-open');
});
el.cancel.addEventListener('click', closeSettings);

el.save.addEventListener('click', async () => {
    const next = { ...settings };

    for (const key of NUMBER_KEYS) {
        const value = Math.floor(Number(inputs[key].value));
        // a blank or nonsense field keeps the previous value instead of breaking the timer
        if (Number.isFinite(value) && value >= 1) next[key] = value;
    }

    for (const key of FLAG_KEYS) {
        next[key] = inputs[key].checked;
    }

    await chrome.storage.local.set({ settings: next });
    closeSettings();
});

el.toggleWeek.addEventListener('click', () => {
    weekOpen = !weekOpen;
    renderWeek();
});

el.toggleHistory.addEventListener('click', () => {
    historyOpen = !historyOpen;
    renderHistory();
});

el.clearHistory.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear-history' });
});

el.clearStats.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear-stats' });
});

// --- storage sync ---

chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    if (changes.timer) timer = { ...DEFAULT_TIMER, ...changes.timer.newValue };
    if (changes.history) history = changes.history.newValue || [];
    if (changes.daily) daily = changes.daily.newValue || {};
    if (changes.settings || changes.timer || changes.history || changes.daily) render();
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggle-widget') toggleWidget();
});

(async () => {
    const stored = await chrome.storage.local.get(['settings', 'timer', 'history', 'daily']);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    timer = { ...DEFAULT_TIMER, ...(stored.timer || {}) };
    history = stored.history || [];
    daily = stored.daily || {};
    render();
})();