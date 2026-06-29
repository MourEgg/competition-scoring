var counter = 0;
var resetCounter = 0;
const cButton = document.getElementById("counterButton");
cButton.addEventListener("click", function (event) {
    event.preventDefault()
    counter++;
    cButton.innerHTML = counter;
    resetCounter = 0;
});

const rButton = document.getElementById("resetButton");
rButton.addEventListener("click", function (event) {
    event.preventDefault()
    resetCounter++;
    if (resetCounter == 3) {
        counter = 0
        resetCounter = 0;
        cButton.innerHTML = counter;
    }
});