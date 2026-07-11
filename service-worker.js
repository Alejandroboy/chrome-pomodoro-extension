const ALARM = 'pomodoro-end';

const DEFAULT_SETTINGS = {
    workMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    sessionsPerBlock: 4,
};

const DEFAULT_TIMER = {
    phase: 'work',          // work | shortBreak | longBreak
    status: 'idle',         // idle | running | paused
    endsAt: null,           // timestamp of the phase end, set while status === 'running'
    remainingMs: null,      // time left, set while status === 'paused'
    startedAt: null,        // timestamp of the first start of the current phase
    plannedMs: null,        // full length of the current phase, frozen at its first start
    completedSessions: 0,   // work sessions since the last long break
    sessionsToday: 0,
    day: null,              // 'YYYY-MM-DD', used to reset sessionsToday on a new day
};

const PHASE_LABEL = {
    work: 'работа',
    shortBreak: 'короткий перерыв',
    longBreak: 'длинный перерыв',
};

const PHASE_SETTING = {
    work: 'workMinutes',
    shortBreak: 'shortMinutes',
    longBreak: 'longMinutes',
};

// Interrupted phases shorter than this are not worth a history entry.
const MIN_RECORD_MS = 30_000;
const HISTORY_LIMIT = 500;

const today = () => new Date().toISOString().slice(0, 10);

const getSettings = async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
};

const getTimer = async () => {
    const { timer } = await chrome.storage.local.get('timer');
    return { ...DEFAULT_TIMER, ...(timer || {}) };
};

const saveTimer = (timer) => chrome.storage.local.set({ timer });

const phaseDurationMs = (phase, settings) => {
    const minutes = Number(settings[PHASE_SETTING[phase]]);
    return Math.max(1, minutes || 1) * 60_000;
};

const remainingMs = (timer) => {
    if (timer.status === 'running') return Math.max(0, timer.endsAt - Date.now());
    if (timer.status === 'paused') return Math.max(0, timer.remainingMs || 0);
    return 0;
};

// --- history ---

const addHistoryEntry = async (entry) => {
    const { history = [] } = await chrome.storage.local.get('history');
    await chrome.storage.local.set({ history: [entry, ...history].slice(0, HISTORY_LIMIT) });
};

// Write a history entry for the phase that is about to end.
const recordPhase = async (timer, completed) => {
    if (!timer.startedAt || !timer.plannedMs) return;   // phase was never started

    const actualMs = completed
        ? timer.plannedMs
        : Math.max(0, timer.plannedMs - remainingMs(timer));

    if (!completed && actualMs < MIN_RECORD_MS) return;

    await addHistoryEntry({
        phase: timer.phase,
        startedAt: timer.startedAt,
        endedAt: Date.now(),
        plannedMs: timer.plannedMs,
        actualMs,
        completed,
    });
};

// --- commands ---

const start = async () => {
    const settings = await getSettings();
    const timer = await getTimer();

    const isResume = timer.status === 'paused' && timer.remainingMs > 0;
    const duration = isResume ? timer.remainingMs : phaseDurationMs(timer.phase, settings);
    const endsAt = Date.now() + duration;

    await saveTimer({
        ...timer,
        status: 'running',
        endsAt,
        remainingMs: null,
        startedAt: isResume ? timer.startedAt : Date.now(),
        plannedMs: isResume ? timer.plannedMs : duration,
    });

    chrome.alarms.create(ALARM, { when: endsAt });
};

const pause = async () => {
    const timer = await getTimer();
    if (timer.status !== 'running') return;

    await chrome.alarms.clear(ALARM);
    await saveTimer({
        ...timer,
        status: 'paused',
        remainingMs: remainingMs(timer),
        endsAt: null,
    });
};

// Drop the current phase and put it back to the start.
const reset = async () => {
    await chrome.alarms.clear(ALARM);
    const timer = await getTimer();
    await recordPhase(timer, false);

    await saveTimer({
        ...timer,
        status: 'idle',
        endsAt: null,
        remainingMs: null,
        startedAt: null,
        plannedMs: null,
    });
};

const nextPhase = (timer, settings, completed) => {
    if (timer.phase !== 'work') {
        // a new block starts after a long break
        const completedSessions = timer.phase === 'longBreak' ? 0 : timer.completedSessions;
        return { phase: 'work', completedSessions };
    }

    // a skipped work session counts for nothing
    if (!completed) {
        return { phase: 'shortBreak', completedSessions: timer.completedSessions };
    }

    const completedSessions = timer.completedSessions + 1;
    const perBlock = Math.max(1, Number(settings.sessionsPerBlock) || 1);
    return {
        phase: completedSessions >= perBlock ? 'longBreak' : 'shortBreak',
        completedSessions,
    };
};

// Move to the next phase. It lands in 'idle', so the user starts it explicitly.
const advance = async ({ completed, notify }) => {
    await chrome.alarms.clear(ALARM);
    const settings = await getSettings();
    const timer = await getTimer();
    const finished = timer.phase;

    await recordPhase(timer, completed);

    const day = today();
    const base = timer.day === day ? timer.sessionsToday : 0;
    const countsAsSession = finished === 'work' && completed;
    const sessionsToday = countsAsSession ? base + 1 : base;

    const { phase, completedSessions } = nextPhase(timer, settings, completed);

    await saveTimer({
        ...timer,
        phase,
        completedSessions,
        sessionsToday,
        day,
        status: 'idle',
        endsAt: null,
        remainingMs: null,
        startedAt: null,
        plannedMs: null,
    });

    if (notify) {
        chrome.notifications.create(ALARM, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('images/icon-128.png'),
            title: finished === 'work' ? 'Рабочая сессия окончена' : 'Перерыв окончен',
            message: `Дальше — ${PHASE_LABEL[phase]}`,
            buttons: [{ title: `Начать: ${PHASE_LABEL[phase]}` }],
            requireInteraction: true,
        });
    }
};

// The worker may have been asleep or killed: check the stored state against the clock.
const reconcile = async () => {
    const timer = await getTimer();
    if (timer.status !== 'running') return;

    if (Date.now() >= timer.endsAt) {
        await advance({ completed: true, notify: true });
    } else {
        chrome.alarms.create(ALARM, { when: timer.endsAt });
    }
};

// --- events ---

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) reconcile();
});

chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(reconcile);

chrome.runtime.onMessage.addListener((request) => {
    switch (request.action) {
        case 'start': start(); break;
        case 'pause': pause(); break;
        case 'reset': reset(); break;
        case 'skip': advance({ completed: false, notify: false }); break;
        case 'clear-history': chrome.storage.local.set({ history: [] }); break;
    }
});

chrome.notifications.onButtonClicked.addListener((id) => {
    if (id !== ALARM) return;
    chrome.notifications.clear(id);
    start();
});

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggle-widget' });
    } catch {
        // no content script on chrome://, the Web Store, or tabs opened
        // before install - nothing to toggle there
    }
});