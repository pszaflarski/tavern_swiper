// Simple busy-wait sleep utility for Maestro tests
function sleep(milliseconds) {
  var start = new Date().getTime();
  while (new Date().getTime() - start < milliseconds) {
    // Busy loop
  }
}

sleep(2000);
