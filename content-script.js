const DEFAULT_SETTINGS = {
    workMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    sessionsPerBlock: 4,
    dailyGoal: 8,
    sound: true,
    autoStartBreaks: true,
    autoStartWork: false,
    idlePause: true,
    idleMinutes: 5,
    theme: 'auto',   // auto | light | dark
};

const DEFAULT_TIMER = {
    phase: 'work',
    status: 'idle',
    endsAt: null,
    remainingMs: null,
    idleAuto: false,
    startedAt: null,
    plannedMs: null,
    completedSessions: 0,
    label: '',
};

const EMPTY_DAY = { focusMs: 0, breakMs: 0, sessions: 0, interrupted: 0, labels: {} };

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
const SUGGESTED_LABELS = 8;
const TOP_LABELS_SHOWN = 3;

const host = document.createElement('div');
host.style.display = 'none';
document.body.appendChild(host);

const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `
<link rel="stylesheet" href="${chrome.runtime.getURL('styles.css')}">
<div class="widget">
    <div class="head" id="head">
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
            <dt>Цель дня</dt>
            <dd id="sessionsToday">0 / 8</dd>
            <dt>Сессий в блоке</dt>
            <dd id="sessionsInBlock">0 / 4</dd>
        </dl>
    </div>

    <div class="goal">
        <div class="goal-bar" id="goalBar"></div>
    </div>

    <div class="task" id="task">
        <input id="label" list="labelSuggestions" maxlength="60" autocomplete="off"
               placeholder="Над чем работаешь?">
        <datalist id="labelSuggestions"></datalist>
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
        <ul class="top-labels" id="topLabels"></ul>
    </div>

    <div class="history" id="history">
        <div class="panel-head">
            <h3>История</h3>
            <span class="panel-actions">
                <button id="exportCsv" class="btn btn-quiet" title="Журнал в CSV">CSV</button>
                <button id="exportJson" class="btn btn-quiet" title="Полный дамп в JSON">JSON</button>
                <button id="clearHistory" class="btn btn-quiet" title="Очистить журнал, статистика останется">Очистить</button>
            </span>
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
        <label for="dailyGoal">
            <span>Цель: сессий в день</span>
            <input type="number" min="1" id="dailyGoal">
        </label>
        <label for="theme">
            <span>Тема</span>
            <select id="theme">
                <option value="auto">Системная</option>
                <option value="light">Светлая</option>
                <option value="dark">Тёмная</option>
            </select>
        </label>
        <label for="sound">
            <span>Звук в конце фазы</span>
            <input type="checkbox" id="sound">
        </label>
        <label for="idlePause">
            <span>Пауза, когда отхожу</span>
            <input type="checkbox" id="idlePause">
        </label>
        <label for="idleMinutes">
            <span>Считать «отошёл» через, мин</span>
            <input type="number" min="1" id="idleMinutes">
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
    head: shadow.querySelector('#head'),
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
    goalBar: shadow.querySelector('#goalBar'),
    exportCsv: shadow.querySelector('#exportCsv'),
    exportJson: shadow.querySelector('#exportJson'),
    toggleWeek: shadow.querySelector('#toggleWeek'),
    week: shadow.querySelector('#week'),
    weekBars: shadow.querySelector('#weekBars'),
    weekTotal: shadow.querySelector('#weekTotal'),
    topLabels: shadow.querySelector('#topLabels'),
    task: shadow.querySelector('#task'),
    label: shadow.querySelector('#label'),
    labelSuggestions: shadow.querySelector('#labelSuggestions'),
    clearStats: shadow.querySelector('#clearStats'),
    toggleHistory: shadow.querySelector('#toggleHistory'),
    clearHistory: shadow.querySelector('#clearHistory'),
    history: shadow.querySelector('#history'),
    historyList: shadow.querySelector('#historyList'),
};

const NUMBER_KEYS = ['workMinutes', 'shortMinutes', 'longMinutes', 'sessionsPerBlock', 'dailyGoal', 'idleMinutes'];
const FLAG_KEYS = ['sound', 'autoStartBreaks', 'autoStartWork', 'idlePause'];
const CHOICE_KEYS = ['theme'];

const inputs = {
    workMinutes: shadow.querySelector('#workMinutes'),
    shortMinutes: shadow.querySelector('#shortMinutes'),
    longMinutes: shadow.querySelector('#longMinutes'),
    sessionsPerBlock: shadow.querySelector('#sessionsPerBlock'),
    dailyGoal: shadow.querySelector('#dailyGoal'),
    sound: shadow.querySelector('#sound'),
    idlePause: shadow.querySelector('#idlePause'),
    idleMinutes: shadow.querySelector('#idleMinutes'),
    autoStartBreaks: shadow.querySelector('#autoStartBreaks'),
    autoStartWork: shadow.querySelector('#autoStartWork'),
    theme: shadow.querySelector('#theme'),
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

let settings = { ...DEFAULT_SETTINGS };
let timer = { ...DEFAULT_TIMER };
let history = [];
let daily = {};
let historyOpen = false;
let weekOpen = false;
let tickId = null;
let elapsedPingedFor = null;   // endsAt we already reported, so tabs ping once each
let position = null;           // { left, top }, or null while it sits at the default corner   // endsAt we already reported, so tabs ping once each

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

// 'auto' follows the OS; anything else wins over it.
const effectiveTheme = () => {
    if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
    return darkQuery.matches ? 'dark' : 'light';
};

const renderTheme = () => {
    el.widget.dataset.theme = effectiveTheme();
};

// --- rendering ---

const renderClock = () => {
    const left = remainingMs();
    el.timer.textContent = formatClock(left);

    // The alarm may fire up to 30 seconds late (Chrome clamps them), and the widget
    // already knows the phase is over - tell the worker instead of waiting.
    if (timer.status === 'running' && left <= 0 && elapsedPingedFor !== timer.endsAt) {
        elapsedPingedFor = timer.endsAt;
        chrome.runtime.sendMessage({ action: 'phase-elapsed' });
    }
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
        label.textContent = entry.label || PHASE_LABEL[entry.phase];
        label.title = label.textContent;

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

// Minutes per label over the shown week, biggest first.
const weekLabels = () => {
    const totals = new Map();

    for (let offset = WEEK_DAYS_SHOWN - 1; offset >= 0; offset -= 1) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const { labels } = dayTotals(dateKey(date));

        for (const [label, ms] of Object.entries(labels)) {
            totals.set(label, (totals.get(label) || 0) + ms);
        }
    }

    return [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_LABELS_SHOWN);
};

const renderTopLabels = () => {
    el.topLabels.replaceChildren();

    for (const [label, ms] of weekLabels()) {
        const item = document.createElement('li');

        const name = document.createElement('span');
        name.className = 'top-label-name';
        name.textContent = label;

        const value = document.createElement('span');
        value.className = 'top-label-value';
        value.textContent = `${minutesOf(ms)} мин`;

        item.append(name, value);
        el.topLabels.append(item);
    }
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

    renderTopLabels();
};

// Labels the user typed before, newest first - offered as autocomplete.
const renderLabelSuggestions = () => {
    const seen = [];
    for (const entry of history) {
        if (!entry.label || seen.includes(entry.label)) continue;
        seen.push(entry.label);
        if (seen.length === SUGGESTED_LABELS) break;
    }

    el.labelSuggestions.replaceChildren(...seen.map((label) => {
        const option = document.createElement('option');
        option.value = label;
        return option;
    }));
};

const renderLabel = () => {
    el.task.classList.toggle('hidden', timer.phase !== 'work');

    // never overwrite what is being typed right now
    if (shadow.activeElement !== el.label) {
        el.label.value = timer.label || '';
    }

    renderLabelSuggestions();
};

const renderStats = () => {
    const today = dayTotals(dateKey());
    const goal = Math.max(1, Number(settings.dailyGoal) || 1);
    const done = today.sessions;

    el.focusToday.textContent = `${minutesOf(today.focusMs)} мин`;
    el.sessionsToday.textContent = `${done} / ${goal}`;
    el.sessionsInBlock.textContent = `${timer.completedSessions} / ${settings.sessionsPerBlock}`;

    el.goalBar.style.width = `${Math.min(100, (done / goal) * 100)}%`;
    el.goalBar.classList.toggle('reached', done >= goal);
};

const render = () => {
    renderTheme();
    renderClock();

    const idlePaused = timer.status === 'paused' && timer.idleAuto;
    el.phase.textContent = idlePaused ? 'Пауза — вас не было' : PHASE_LABEL[timer.phase];
    el.phase.dataset.phase = timer.phase;
    el.start.textContent = START_LABEL[timer.status];
    renderLabel();
    renderStats();
    renderWeek();
    renderHistory();

    clearInterval(tickId);
    tickId = null;
    if (timer.status === 'running') {
        tickId = setInterval(renderClock, 250);
    }
};

// --- export ---

const CSV_COLUMNS = ['date', 'start', 'end', 'phase', 'label', 'planned_min', 'actual_min', 'completed'];

const csvCell = (value) => {
    const text = String(value ?? '');
    return /[",;\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsv = () => {
    const rows = history.map((entry) => [
        dateKey(entry.endedAt),
        formatTime(entry.startedAt),
        formatTime(entry.endedAt),
        entry.phase,
        entry.label || '',
        minutesOf(entry.plannedMs),
        minutesOf(entry.actualMs),
        entry.completed ? 1 : 0,
    ]);

    const lines = [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(','));
    // BOM so that Excel opens the Cyrillic labels in UTF-8
    return `\ufeff${lines.join('\r\n')}`;
};

const toJson = () => JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings,
    daily,
    history,
}, null, 2);

const download = (content, type, extension) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');

    link.href = url;
    link.download = `pomodoro-${dateKey()}.${extension}`;
    shadow.append(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
};

// --- dragging ---

const MARGIN = 8;   // keep at least this much of the widget on screen

// Keep the widget within the viewport so it can never be dragged out of reach.
const clampPosition = (left, top) => {
    const rect = el.widget.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - MARGIN;
    const maxTop = window.innerHeight - rect.height - MARGIN;
    return {
        left: Math.max(MARGIN, Math.min(left, Math.max(MARGIN, maxLeft))),
        top: Math.max(MARGIN, Math.min(top, Math.max(MARGIN, maxTop))),
    };
};

const applyPosition = () => {
    if (!position) return;   // no saved spot yet - the stylesheet's corner wins
    el.widget.style.left = `${position.left}px`;
    el.widget.style.top = `${position.top}px`;
};

let drag = null;

const onPointerDown = (event) => {
    // left button / touch only, and never when grabbing the close button
    if (event.button !== 0 || event.target.closest('#close')) return;

    const rect = el.widget.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    el.head.setPointerCapture(event.pointerId);
    el.widget.classList.add('dragging');
};

const onPointerMove = (event) => {
    if (!drag) return;
    position = clampPosition(event.clientX - drag.dx, event.clientY - drag.dy);
    applyPosition();
};

const onPointerUp = (event) => {
    if (!drag) return;
    drag = null;
    el.head.releasePointerCapture(event.pointerId);
    el.widget.classList.remove('dragging');
    chrome.storage.local.set({ ui: position });
};

el.head.addEventListener('pointerdown', onPointerDown);
el.head.addEventListener('pointermove', onPointerMove);
el.head.addEventListener('pointerup', onPointerUp);

// A window resize can leave the widget partly off-screen - pull it back.
window.addEventListener('resize', () => {
    if (!position) return;
    position = clampPosition(position.left, position.top);
    applyPosition();
});

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
    commitLabel();   // whatever is typed in the field belongs to the session being started
    const action = timer.status === 'running' ? 'pause' : 'start';
    chrome.runtime.sendMessage({ action });
});
const commitLabel = () => {
    chrome.runtime.sendMessage({ action: 'set-label', label: el.label.value });
};

el.label.addEventListener('change', commitLabel);
el.label.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        commitLabel();
        el.label.blur();
    }
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
    for (const key of CHOICE_KEYS) inputs[key].value = settings[key];
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

    for (const key of CHOICE_KEYS) {
        next[key] = inputs[key].value;
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

el.exportCsv.addEventListener('click', () => {
    download(toCsv(), 'text/csv;charset=utf-8', 'csv');
});

el.exportJson.addEventListener('click', () => {
    download(toJson(), 'application/json', 'json');
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
    if (changes.ui) {
        position = changes.ui.newValue || null;
        applyPosition();
    }
    if (changes.settings || changes.timer || changes.history || changes.daily) render();
});

darkQuery.addEventListener('change', () => {
    if (settings.theme === 'auto') renderTheme();
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggle-widget') toggleWidget();
});

(async () => {
    const stored = await chrome.storage.local.get(['settings', 'timer', 'history', 'daily', 'ui']);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    timer = { ...DEFAULT_TIMER, ...(stored.timer || {}) };
    history = stored.history || [];
    daily = stored.daily || {};
    position = stored.ui || null;
    applyPosition();
    render();
})();