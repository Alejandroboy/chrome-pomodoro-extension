const state = {
    timeLeft: 16,
    isRunning: false,
    timerMode: 'notStarted',
    sessionCount: 3,
    timerState: 'work',
    shortInterval: 300,
    longInterval: 1500,
    workInterval: 1500,
}

chrome.action.onClicked.addListener(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'activate-widget' });
    });
})

const  startTimer = async (time = 16) => {
   const result = await  chrome.storage.local.get(['workInterval']);
    if (result.workInterval) {
        state.workInterval = result.workInterval
    } else {
        state.workInterval = time
    }
    state.timerMode = 'started'
    return chrome.alarms.create('alarm', { periodInMinutes: 1/60 });
}

chrome.alarms.onAlarm.addListener(() => {
    state.workInterval -= 1;
    chrome.storage.local.set({workInterval: state.workInterval});
    if (state.workInterval <= 0) {
        chrome.alarms.clear('alarm');
        state.timerState = 'shortBreak';
        state.timerMode = 'notStarted'
        chrome.notifications.create('timer-end', {
            type: 'basic',
            title: 'Окончание',
            message: 'Рабочий интервал закончен',
            iconUrl: chrome.runtime.getURL('images/icon-128.png'),
            buttons: [{
                title: 'Перерыв'
            }]
        });
    }
})

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'start-timer') {
        startTimer();
    }
})

chrome.storage.local.onChanged.addListener((change) => {
    if (change.workInterval?.newValue) {
        state.workInterval = change.workInterval.newValue;
    }
    if (change.shortInterval?.newValue) {
        state.shortInterval = change.shortInterval.newValue;
    }
    if (change.longInterval?.newValue) {
        state.longInterval = change.longInterval.newValue;
    }
    if (change.sessionCount?.newValue) {
        state.sessionCount = change.sessionCount.newValue;
    }
})