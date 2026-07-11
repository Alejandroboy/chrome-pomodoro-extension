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

const host = document.createElement('div');
host.style.display = 'none';
document.body.appendChild(host);

const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `
<link rel="stylesheet" href="${chrome.runtime.getURL('styles.css')}">
<div class="widget">
    <button id="close" title="Закрыть">×</button>
    <h2>Pomodoro</h2>
    <div class="container">
        <div class="half">
            <div id="phase" class="phase">Работа</div>
            <div id="timer" class="timer">25:00</div>
            <div class="controls">
                <button id="start" class="btn btn-primary">Запустить</button>
                <button id="reset" class="btn">Сбросить</button>
                <button id="skip" class="btn">Пропустить</button>
            </div>
        </div>
        <div class="half relative">
            <p id="sessionsToday">Сессий за день: 0</p>
            <p id="sessionsInBlock">Сессий в блоке: 0 / 4</p>
            <button id="tune" class="btn">Настроить</button>

            <div class="modal" id="modal">
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
    </div>
</div>
`;

const el = {
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
    sessionsToday: shadow.querySelector('#sessionsToday'),
    sessionsInBlock: shadow.querySelector('#sessionsInBlock'),
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
let tickId = null;

const phaseDurationMs = (phase) => {
    const minutes = Number(settings[PHASE_SETTING[phase]]);
    return Math.max(1, minutes || 1) * 60_000;
};

const remainingMs = () => {
    if (timer.status === 'running') return Math.max(0, timer.endsAt - Date.now());
    if (timer.status === 'paused') return Math.max(0, timer.remainingMs ?? 0);
    return phaseDurationMs(timer.phase);
};

const format = (ms) => {
    const total = Math.ceil(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
};

const renderClock = () => {
    el.timer.textContent = format(remainingMs());
};

const render = () => {
    renderClock();
    el.phase.textContent = PHASE_LABEL[timer.phase];
    el.phase.dataset.phase = timer.phase;
    el.start.textContent = START_LABEL[timer.status];
    el.sessionsToday.textContent = `Сессий за день: ${timer.sessionsToday}`;
    el.sessionsInBlock.textContent =
        `Сессий в блоке: ${timer.completedSessions} / ${settings.sessionsPerBlock}`;

    clearInterval(tickId);
    tickId = null;
    if (timer.status === 'running') {
        tickId = setInterval(renderClock, 250);
    }
};

// --- UI events ---

el.start.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: timer.status === 'running' ? 'pause' : 'start' });
});
el.reset.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'reset' }));
el.skip.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'skip' }));
el.close.addEventListener('click', () => { host.style.display = 'none'; });

el.tune.addEventListener('click', () => {
    for (const key of SETTING_KEYS) inputs[key].value = settings[key];
    el.modal.style.display = 'block';
});
el.cancel.addEventListener('click', () => { el.modal.style.display = 'none'; });

el.save.addEventListener('click', async () => {
    const next = { ...settings };
    for (const key of SETTING_KEYS) {
        const value = Math.floor(Number(inputs[key].value));
        if (Number.isFinite(value) && value >= 1) next[key] = value;
    }
    await chrome.storage.local.set({ settings: next });
    el.modal.style.display = 'none';
});

// --- storage sync ---

chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    if (changes.timer) timer = { ...DEFAULT_TIMER, ...changes.timer.newValue };
    if (changes.settings || changes.timer) render();
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggle-widget') {
        host.style.display = host.style.display === 'none' ? 'block' : 'none';
    }
});

(async () => {
    const stored = await chrome.storage.local.get(['settings', 'timer']);
    settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    timer = { ...DEFAULT_TIMER, ...(stored.timer || {}) };
    render();
})();