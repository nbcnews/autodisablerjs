## Auto Disabler

This is an implementation of the circuit breaker pattern for Node.js.

**Note: this module is stil unstable.**

Example usage:

```js
var AutoDisabler = require('autodisablerjs');
var autodisabler = new AutoDisabler();
var request = require('request');

var scope = autodisabler.getScope('main', {
  maxFailures: 10,
  minSuccesses: 5,
  varyByParams: true,
  disableDuration: 15 * 60 * 1000 // 15 minutes
});

var requestProxy = scope.proxy('request', request);

// disabler identifies this as "main:request:http://google.com"
requestProxy('http://google.com/', function requestCompleted(err, response, body) {
  if (err) {
    // when disabled, err.message === 'Disabled'
    return;
  }
});
```
