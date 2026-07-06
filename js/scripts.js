var counter = 0;
var resetCounter = 0;

var duration = 150 * 1000; // 90 seconds
let endTime;
let timeLeft = duration / 1000;

let timerInterval = null;
const timerDisplay = document.getElementById("button-timer");

const btnNumberElement = document.getElementById("button-number")
const cButton = document.getElementById("counterButton");
cButton.addEventListener("click", function (event) {
    event.preventDefault()
    if (timerInterval == null) {
        startTimer();
        return;
    }
    counter++;
    btnNumberElement.innerHTML = counter;
    resetCounter = 0;
});

const rButton = document.getElementById("resetButton");
rButton.addEventListener("click", function (event) {
    event.preventDefault()
    resetCounter++;
    if (resetCounter == 3) {
        counter = 0
        resetCounter = 0;
        btnNumberElement.innerHTML = counter;
        clearInterval(timerInterval);
        timerInterval = null;
        timeLeft = duration / 1000;
        updateDisplay();
        cButton.classList.remove("btn-danger");
    }
});

function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = Math.floor(timeLeft % 60);
    const tenths = Math.floor((timeLeft * 10) % 10);

    timerDisplay.textContent =
        `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function startTimer() {
    if (timerInterval) return;

    endTime = Date.now() + duration;

    timerInterval = setInterval(() => {
        timeLeft = Math.max(0, (endTime - Date.now()) / 1000);
        updateDisplay();

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            cButton.classList.add("btn-danger");
            timerInterval = null;
        }
    }, 100);
};

const timerInput = document.getElementById("timerInput");

timerInput.addEventListener("input", function (event) {
    event.preventDefault();
    duration = Number(timerInput.value) * 1000;
    timeLeft =  duration / 1000;
    updateDisplay();
});