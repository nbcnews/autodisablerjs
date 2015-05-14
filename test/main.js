var assert = require('assert');
var AutoDisabler = require('../');

function listenToEvents(emitter) {
  emitter.on('opened', function(key){console.log('opened  %j', key);});
  emitter.on('reopened', function(key){console.log('reopened %j', key);});
  emitter.on('closed', function(key){console.log('closed  %j', key);});
  emitter.on('testing', function(key){console.log('testing %j', key);});
}

describe('autodisabler', function () {
  var autodisabler = new AutoDisabler();

  it('supports separate scopes', function () {
    var fooScope = autodisabler.getScope('foo');
    var barScope = autodisabler.getScope('bar');
    if (!fooScope || !barScope) {
      assert.fail('Scope not created');
    } else if (fooScope === barScope) {
      assert.fail('Distinct scopes were the same');
    }
  });

  it('creates singleton scopes', function () {
    var expectedScope = autodisabler.getScope('foo');
    var actualScope = autodisabler.getScope('foo');
    if (expectedScope != actualScope) {
      assert.fail('get on same scope returned different objects');
    }
  });

  it('should execute callback', function (done) {
    var scope = autodisabler.getScope('foo', {});

    var testComponent = function (key, cb) {
      cb(new Error('intentional error'));
    };
    var testCallback = function (err, data) {
      done();
    };
    var wrapped = scope.proxy('test_key', testComponent);
    wrapped('foo', testCallback);
  });

  it('does nothing if called without arguments', function (done) {
    var scope = autodisabler.getScope('foo');

    var testComponent = function (key, cb) {
      cb();
    };
    var testCallback = function (err, data) {
      done();
    };
    var wrapped = scope.proxy('test_key', testComponent);
    wrapped('foo', testCallback);
  });

  it('allows soft error handling', function (done) {
    var scope = autodisabler.getScope('test_with_override', {
      handlers: [
        function handleNonErrFailure(err, fail) {
          if (fail) {
            return true;
          }
        }
      ]
    });

    var testComponent = function (key, cb) {
      cb(null, true);
    };
    var testCallback = function (err, data) {
      assert.ok(err, 'Expected error');
      assert.equal(err.message, 'Disabler handled soft error.');
      done();
    };
    var wrapped = scope.proxy('soft_error', testComponent);
    wrapped('foo', testCallback);
  });


  it('disables even with soft error handling', function (done) {
    var scope = autodisabler.getScope('test_with_override', {
      handlers: [
        function handleNonErrFailure(err, fail) {
          if (fail) {
            return true;
          }
        }
      ]
    });

    var testComponent = function (key, cb) {
      cb(new Error('Intentional Error'));
    };
    var testCallback = function (err, data) {
      assert.ok(err, 'Expected error');
      assert.equal(err.message, 'Intentional Error');
      done();
    };
    var wrapped = scope.proxy('soft_error', testComponent);
    wrapped('foo', testCallback);
  });

  it('disables after threshold', function (done) {
    var scope = autodisabler.getScope('threshold_test', {
      maxFailures: 2
    });

    var fn = scope.proxy('foo', function (cb) {
      cb(new Error('intentional error'));
    });

    var expectErrorWhileEnabled = function (err) {
      assert.ok(err, 'Expected error');
      assert.equal(err.message, 'intentional error');
    };

    fn(expectErrorWhileEnabled);
    fn(expectErrorWhileEnabled);
    fn(function expectErrorWhileDisabled(err) {
      assert.ok(err, 'Expected disabler error');
      assert.equal(err.message, 'Disabled');
    });
    fn(function expectErrorWhileDisabled(err) {
      assert.ok(err, 'Expected disabler error');
      assert.equal(err.message, 'Disabled');
      done();
    });
  });

  it('enables after disabled', function (done) {
    var scope = autodisabler.getScope('threshold_test_2', {
      maxFailures: 2,
      minSuccesses: 1,
      disableDuration: 1
    });

    var intentionalError = new Error('intentional error');

    var fn = scope.proxy('foo', function (key, cb) {
      process.nextTick(function () {
        cb(intentionalError || null, !intentionalError);
      });
    });

    var expectErrorWhileEnabled = function (err) {
      assert.ok(err, 'Expected error');
      assert.equal(err.message, 'intentional error');
    };

    fn('bar', expectErrorWhileEnabled);
    fn('bar', expectErrorWhileEnabled);
    setTimeout(function() {
      fn('bar', function expectErrorWhileDisabled(err) {
        assert.ok(err, 'Expected disabler error');
        assert.equal(err.message, 'Disabled');

        intentionalError = null;

        fn('bar', function expectSuccessWhileEnabled(err, pass) {
          assert.ifError(err);
          assert.ok(pass, 'Still disabled');
          done();
        });
      });
    }, 0);
  });

  it('moves from half_open to open on failure', function (done) {
    var scope = autodisabler.getScope('reopen_test', {
      maxFailures: 2,
      minSuccesses: 1,
      disableDuration: 1
    });

    var intentionalError = new Error('intentional error');

    var fn = scope.proxy('foo', function (key, cb) {
      process.nextTick(function () {
        cb(intentionalError || null, !intentionalError);
      });
    });

    var expectErrorWhileEnabled = function (err) {
      assert.ok(err, 'Expected error');
      assert.equal(err.message, 'intentional error');
    };

    fn('bar', expectErrorWhileEnabled);
    fn('bar', expectErrorWhileEnabled);
    setTimeout(function() {
      fn('bar', function expectErrorWhileDisabled(err) {
        assert.ok(err, 'Expected disabler error');
        assert.equal(err.message, 'Disabled');

        setTimeout(function () {
          fn('bar', expectErrorWhileEnabled);

          setTimeout(function () {
            fn('bar', function expectSuccessWhileEnabled(err, pass) {
              assert.ok(err, 'Expected disabler error');
              assert.equal(err.message, 'Disabled');
              done();
            });
          }, 0);
        }, 0);
      });
    }, 1);
  });
});
