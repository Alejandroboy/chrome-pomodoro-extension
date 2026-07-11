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
    completedSessions: 0,   // work sessions since the last long break
    sessionsToday: 0,
    day: null,              // 'YYYY-MM-DD', used to reset sessionsToday on a new day
};

const PHASE_LABEL = {
    work: 'работа',
    shortBreak: 'короткий перерыв',
    longBreak: 'длинный перерыв',
};

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

const PHASE_SETTING = {
    work: 'workMinutes',
    shortBreak: 'shortMinutes',
    longBreak: 'longMinutes',
};

const phaseDurationMs = (phase, settings) => {
    const minutes = Number(settings[PHASE_SETTING[phase]]);
    return Math.max(1, minutes || 1) * 60_000;
};

// --- commands ---

const start = async () => {
    const settings = await getSettings();
    const timer = await getTimer();

    // resume from a pause, otherwise run the whole phase
    const isResume = timer.status === 'paused' && timer.remainingMs > 0;
    const duration = isResume ? timer.remainingMs : phaseDurationMs(timer.phase, settings);

    const endsAt = Date.now() + duration;
    await saveTimer({ ...timer, status: 'running', endsAt, remainingMs: null });
    chrome.alarms.create(ALARM, { when: endsAt });
};

const pause = async () => {
    const timer = await getTimer();
    if (timer.status !== 'running') return;

    await chrome.alarms.clear(ALARM);
    await saveTimer({
        ...timer,
        status: 'paused',
        remainingMs: Math.max(0, timer.endsAt - Date.now()),
        endsAt: null,
    });
};

const reset = async () => {
    await chrome.alarms.clear(ALARM);
    const timer = await getTimer();
    await saveTimer({ ...timer, status: 'idle', endsAt: null, remainingMs: null });
};

const nextPhase = (timer, settings) => {
    if (timer.phase !== 'work') {
        // a new block starts after a long break
        const completedSessions = timer.phase === 'longBreak' ? 0 : timer.completedSessions;
        return { phase: 'work', completedSessions };
    }
    const completedSessions = timer.completedSessions + 1;
    const perBlock = Math.max(1, Number(settings.sessionsPerBlock) || 1);
    return {
        phase: completedSessions >= perBlock ? 'longBreak' : 'shortBreak',
        completedSessions,
    };
};

// Move to the next phase. It lands in 'idle', so the user starts it explicitly.
const advance = async ({ notify }) => {
    await chrome.alarms.clear(ALARM);
    const settings = await getSettings();
    const timer = await getTimer();
    const finished = timer.phase;

    const day = today();
    const base = timer.day === day ? timer.sessionsToday : 0;
    const sessionsToday = finished === 'work' ? base + 1 : base;

    const { phase, completedSessions } = nextPhase(timer, settings);

    await saveTimer({
        ...timer,
        phase,
        completedSessions,
        sessionsToday,
        day,
        status: 'idle',
        endsAt: null,
        remainingMs: null,
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
        await advance({ notify: true });
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
        case 'skip': advance({ notify: false }); break;
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