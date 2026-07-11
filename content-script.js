const host = document.createElement('div');
document.body.appendChild(host);
const shadow = host.attachShadow({mode: 'open'});
host.style.display = 'none'
shadow.innerHTML = `
<link rel="stylesheet" href="${chrome.runtime.getURL('styles.css')}">
<div class="widget">
    <button id="close">X</button>
    <h2>Pomodoro timer</h2>
    <div class="container">
        <div class="half">
            <div id="timer">
            </div>
            <div id="info">
                Осталось времени
            </div>
            <button id="start" class="btn">Запустить</button>
        </div>
        <div class="half relative">
            <div class="modal">
                <label for="workInterval">
                    <span>Введите количество минут рабочей сессии</span>
                    <input type="number" placeholder="30 минут" id="workInterval" name="workInterval">
                </label>
                <label for="shortInterval">
                    <span>Введите количесво минут перерыва между сессиями</span>
                    <input type="number" placeholder="5 минут" id="shortInterval" name="shortInterval">
                </label>
                <label for="longInterval">
                    <span>Введите количесво минут перерыва между блоками</span>
                    <input type="number" placeholder="5 минут" id="longInterval" name="longInterval">
                </label>
                <label for="sessionCount">
                    <span>Введите количество сессий в блоке</span>
                    <input type="number" placeholder="5 сессий" id="sessionCount" name="sessionCount">
                </label>
                <button id="save" class="btn">Сохранить</button>
            </div>
            <p>
                Сессий за день
            </p>
            <p>
                Сессий с последнего долгого отдыха
            </p>
            <button id="tune" class="btn">Настроить</button>
        </divc>
    </div>
</div>
`
const modal = shadow.querySelector('.modal')
const closeButton = shadow.querySelector('#close');
closeButton.addEventListener('click', () => {
    host.style.display = 'none';
});
const startButton = shadow.querySelector('#start');
startButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({action: 'start-timer'})
})
const tuneButton = shadow.querySelector('#tune');
tuneButton.addEventListener('click', () => {
    modal.style.display = 'block';
})
const saveButton = shadow.querySelector('#save');


const workIntervalInput = shadow.querySelector('#workInterval');
const shortIntervalInput = shadow.querySelector('#shortInterval');
const longIntervalInput = shadow.querySelector('#longInterval');
const sessionCountInput = shadow.querySelector('#sessionCount');
saveButton.addEventListener('click', () => {
    chrome.storage.local.set({
        workInterval: workIntervalInput.value,
        shortInterval: shortIntervalInput.value,
        longInterval: longIntervalInput.value,
        sessionCount: sessionCountInput.value,
    })
    modal.style.display = 'none';
})

const info = shadow.querySelector('#info');
const timer = shadow.querySelector('#timer');

chrome.storage.local.onChanged.addListener((change) => {
    timer.textContent = change.workInterval.newValue;
    if (change.workInterval?.newValue <= 0) {
        info.textContent = 'Время закончилось'
    }
})

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'activate-widget') {
        host.style.display = 'block';
    }
})