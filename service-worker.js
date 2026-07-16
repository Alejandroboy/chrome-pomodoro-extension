const ALARM = 'pomodoro-end';
const BADGE_ALARM = 'badge-tick';

// Chrome clamps periodic alarms to 30 seconds, which is also all we need:
// the badge counts whole minutes, so it can never be off by more than that.
const BADGE_PERIOD_MINUTES = 0.5;

const DEFAULT_SETTINGS = {
    workMinutes: 25,
    shortMinutes: 5,
    longMinutes: 15,
    sessionsPerBlock: 4,
    dailyGoal: 8,
    sound: true,
    autoStartBreaks: true,
    autoStartWork: false,
};

const DEFAULT_TIMER = {
    phase: 'work',          // work | shortBreak | longBreak
    status: 'idle',         // idle | running | paused
    endsAt: null,           // timestamp of the phase end, set while status === 'running'
    remainingMs: null,      // time left, set while status === 'paused'
    startedAt: null,        // timestamp of the first start of the current phase
    plannedMs: null,        // full length of the current phase, frozen at its first start
    completedSessions: 0,   // work sessions since the last long break
    label: '',              // what the user is working on, carried between work sessions
};

const EMPTY_DAY = { focusMs: 0, breakMs: 0, sessions: 0, interrupted: 0, labels: {} };

const LABEL_MAX_LENGTH = 60;

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

const PHASE_COLOR = {
    work: '#c0392b',
    shortBreak: '#2f855a',
    longBreak: '#2b6cb0',
};

const PAUSED_COLOR = '#8a8a8a';

// Interrupted phases shorter than this are not worth recording.
const MIN_RECORD_MS = 30_000;

// The log is a recent-activity feed, so it is bounded by time, not by count:
// every number the UI shows comes from the daily totals, which are never dropped.
// The count is only a safety net against a flood of one-minute sessions
// (~130 bytes per entry, so 2000 entries is ~260 KB against a 10 MB quota).
const HISTORY_DAYS = 30;
const HISTORY_MAX_ENTRIES = 2000;

// Local calendar date as 'YYYY-MM-DD'. Built by hand rather than via a locale:
// toISOString() would give the UTC date and push late-evening sessions into the
// next day, while a locale format is not guaranteed to be sortable.
const dateKey = (ts = Date.now()) => {
    const date = new Date(ts);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

// Every command that mutates the timer goes through this queue. Without it,
// a phase-end ping from several open tabs would advance the phase several times.
let queue = Promise.resolve();

const serialize = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
};

const getSettings = async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
};

const getTimer = async () => {
    const { timer } = await chrome.storage.local.get('timer');
    return { ...DEFAULT_TIMER, ...(timer || {}) };
};

const saveTimer = async (timer) => {
    await chrome.storage.local.set({ timer });
    await syncBadge(timer);
};

const phaseDurationMs = (phase, settings) => {
    const minutes = Number(settings[PHASE_SETTING[phase]]);
    return Math.max(1, minutes || 1) * 60_000;
};

const remainingMs = (timer) => {
    if (timer.status === 'running') return Math.max(0, timer.endsAt - Date.now());
    if (timer.status === 'paused') return Math.max(0, timer.remainingMs || 0);
    return 0;
};

// --- sound ---

const OFFSCREEN_PATH = 'offscreen.html';

let offscreenReady = null;

// createDocument() throws if one already exists, so concurrent calls share a promise.
const ensureOffscreen = () => {
    if (offscreenReady) return offscreenReady;

    offscreenReady = (async () => {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
        });

        if (contexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_PATH,
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'Звуковой сигнал в конце фазы помидора',
            });
        }
    })().finally(() => {
        offscreenReady = null;
    });

    return offscreenReady;
};

// The service worker has no DOM, so the chime is played by an offscreen document.
const playSound = async (finished, settings) => {
    if (!settings.sound) return;

    try {
        await ensureOffscreen();
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'play-sound',
            phase: finished,
        });
    } catch {
        // no sound is not worth breaking the phase transition over
    }
};

// --- badge ---

const badgeText = (timer) => {
    if (timer.status === 'idle') return '';

    const left = remainingMs(timer);
    if (left <= 0) return '';
    if (left < 60_000) return '<1';
    return String(Math.ceil(left / 60_000));
};

const badgeTitle = (timer) => {
    const phase = PHASE_LABEL[timer.phase];
    if (timer.status === 'idle') return `Pomodoro — ${phase}, не запущено`;

    const text = badgeText(timer);
    const paused = timer.status === 'paused' ? ', пауза' : '';
    return `Pomodoro — ${phase}: ${text} мин${paused}`;
};

// Redraw the badge and keep the ticking alarm alive only while it counts down.
const syncBadge = async (timer) => {
    const color = timer.status === 'paused' ? PAUSED_COLOR : PHASE_COLOR[timer.phase];

    await chrome.action.setBadgeText({ text: badgeText(timer) });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    await chrome.action.setTitle({ title: badgeTitle(timer) });

    if (timer.status === 'running') {
        chrome.alarms.create(BADGE_ALARM, { periodInMinutes: BADGE_PERIOD_MINUTES });
    } else {
        await chrome.alarms.clear(BADGE_ALARM);
    }
};

// --- history log + daily totals ---

// Fold one finished phase into a day's totals.
const applyToDay = (day, entry) => {
    const next = { ...EMPTY_DAY, ...day };

    if (entry.phase !== 'work') {
        next.breakMs += entry.actualMs;
        return next;
    }

    next.focusMs += entry.actualMs;
    if (entry.completed) {
        next.sessions += 1;
    } else {
        next.interrupted += 1;
    }

    if (entry.label) {
        const labels = { ...next.labels };
        labels[entry.label] = (labels[entry.label] || 0) + entry.actualMs;
        next.labels = labels;
    }

    return next;
};

const pruneHistory = (history) => {
    const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
    return history
        .filter((entry) => entry.endedAt >= cutoff)
        .slice(0, HISTORY_MAX_ENTRIES);
};

const saveEntry = async (entry) => {
    const { history = [], daily = {} } = await chrome.storage.local.get(['history', 'daily']);
    const key = dateKey(entry.endedAt);

    await chrome.storage.local.set({
        history: pruneHistory([entry, ...history]),
        daily: { ...daily, [key]: applyToDay(daily[key], entry) },
    });
};

// Write down the phase that is about to end.
const recordPhase = async (timer, completed) => {
    if (!timer.startedAt || !timer.plannedMs) return;   // phase was never started

    const actualMs = completed
        ? timer.plannedMs
        : Math.max(0, timer.plannedMs - remainingMs(timer));

    if (!completed && actualMs < MIN_RECORD_MS) return;

    await saveEntry({
        phase: timer.phase,
        label: timer.phase === 'work' ? timer.label : '',
        startedAt: timer.startedAt,
        endedAt: Date.now(),
        plannedMs: timer.plannedMs,
        actualMs,
        completed,
    });
};

// Keys written by 1.x, when settings and the countdown shared one storage slot.
const LEGACY_KEYS = ['workInterval', 'shortInterval', 'longInterval', 'sessionCount'];

const dropLegacyKeys = () => chrome.storage.local.remove(LEGACY_KEYS);

// One-off: build daily totals for users who already have a history log.
const backfillDaily = async () => {
    const { history = [], daily } = await chrome.storage.local.get(['history', 'daily']);
    if (daily || history.length === 0) return;

    const totals = {};
    for (const entry of history) {
        const key = dateKey(entry.endedAt);
        totals[key] = applyToDay(totals[key], entry);
    }
    await chrome.storage.local.set({ daily: totals });
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

// Fires exactly once per day: the counter can only pass the goal by landing on it.
const notifyGoalReached = async (settings) => {
    const goal = Math.max(1, Number(settings.dailyGoal) || 1);
    const { daily = {} } = await chrome.storage.local.get('daily');
    const done = daily[dateKey()]?.sessions || 0;

    if (done !== goal) return;

    chrome.notifications.create('pomodoro-goal', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon-128.png'),
        title: 'Дневная цель достигнута',
        message: `${goal} сессий за день. Можно выдохнуть.`,
    });
};

// The label applies to the running work session, so it can be edited mid-phase.
const setLabel = async (raw) => {
    const timer = await getTimer();
    const label = String(raw || '').trim().slice(0, LABEL_MAX_LENGTH);
    if (label === timer.label) return;

    await saveTimer({ ...timer, label });
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

const shouldAutoStart = (phase, settings) => (
    phase === 'work' ? Boolean(settings.autoStartWork) : Boolean(settings.autoStartBreaks)
);

// Move to the next phase. It starts on its own only if the settings say so;
// otherwise it waits in 'idle' for an explicit start.
const advance = async ({ completed, notify }) => {
    await chrome.alarms.clear(ALARM);
    const settings = await getSettings();
    const timer = await getTimer();
    const finished = timer.phase;

    await recordPhase(timer, completed);

    if (finished === 'work' && completed) await notifyGoalReached(settings);

    const { phase, completedSessions } = nextPhase(timer, settings, completed);
    const autoStart = shouldAutoStart(phase, settings);

    await saveTimer({
        ...timer,
        phase,
        completedSessions,
        status: 'idle',
        endsAt: null,
        remainingMs: null,
        startedAt: null,
        plannedMs: null,
    });

    if (notify) {
        notifyPhaseEnd(finished, phase, autoStart);
        playSound(finished, settings);
    }
    if (autoStart) await start();
};

// An auto-started phase needs no action button - it is already running.
const notifyPhaseEnd = (finished, next, autoStart) => {
    const options = {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon-128.png'),
        title: finished === 'work' ? 'Рабочая сессия окончена' : 'Перерыв окончен',
        message: autoStart
            ? `Начался ${PHASE_LABEL[next]}`
            : `Дальше — ${PHASE_LABEL[next]}`,
        requireInteraction: !autoStart,
    };

    if (!autoStart) {
        options.buttons = [{ title: `Начать: ${PHASE_LABEL[next]}` }];
    }

    chrome.notifications.create(ALARM, options);
};

// The worker may have been asleep or killed: check the stored state against the clock.
const reconcile = async () => {
    const timer = await getTimer();

    if (timer.status !== 'running') {
        await syncBadge(timer);
        return;
    }

    if (Date.now() >= timer.endsAt) {
        await advance({ completed: true, notify: true });
    } else {
        chrome.alarms.create(ALARM, { when: timer.endsAt });
        await syncBadge(timer);
    }
};

// --- events ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM) {
        serialize(reconcile);
        return;
    }
    if (alarm.name === BADGE_ALARM) {
        syncBadge(await getTimer());
    }
});

chrome.runtime.onStartup.addListener(() => serialize(reconcile));

chrome.runtime.onInstalled.addListener(() => serialize(async () => {
    await dropLegacyKeys();
    await backfillDaily();
    await reconcile();
}));

chrome.runtime.onMessage.addListener((request) => {
    switch (request.action) {
        case 'start': serialize(start); break;
        case 'pause': serialize(pause); break;
        case 'reset': serialize(reset); break;
        case 'skip': serialize(() => advance({ completed: false, notify: false })); break;
        case 'set-label': serialize(() => setLabel(request.label)); break;

        // the widget saw the countdown hit zero: finish the phase now instead of
        // waiting for the alarm, which Chrome may fire up to 30 seconds late
        case 'phase-elapsed': serialize(reconcile); break;

        case 'clear-history': chrome.storage.local.set({ history: [] }); break;
        case 'clear-stats': chrome.storage.local.set({ history: [], daily: {} }); break;
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