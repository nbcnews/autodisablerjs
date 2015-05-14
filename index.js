var util = require('util');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');

var getMd5 = function (input) {
  return crypto.createHash('md5').update(input).digest('hex');
};

var STATES = {
  CLOSED: 0,
  HALF_OPEN: 1,
  OPEN: 2
};

function defaults(options) {
  if (!options.maxFailures) {
    options.maxFailures = 5;
  }
  if (!options.disableDuration) {
    options.disableDuration = 5 * 60 * 1000; // milliseconds
  }
  if (!options.minSuccesses) {
    options.minSuccesses = 5;
  }
  if (!options.varyByParameter) {
    options.varyByParameter = true;
  }
  return options;
}

function convertToArray(args) {
  var newArgs = [];
  for (var i = 0; i < args.length; i++) {
    newArgs.push(args[i.toString()]);
  }
  return newArgs;
}

function DisablerScope(name, options, disabler) {
  this.name = name;
  this.keys = {};
  this.options = defaults(options || {});
  this.disabler = disabler;
  this.resources = {};

  EventEmitter.call(this);
}

util.inherits(DisablerScope, EventEmitter);

DisablerScope.prototype.deriveKey = function deriveKey(args, proxyName) {
  var argKey = '';
  var parts = [this.name, proxyName];

  if (this.options.varyByParameter) {
    for (var i = 0; i < args.length; i++) {
      if (typeof(args[i]) === 'string') {
        argKey += args[i];
      }
    }
    if (argKey) {
      parts.push(argKey);
    }
  }
  return parts.join(':');
}

DisablerScope.prototype.updateState = function (key, success) {
  var resource = this.resources[key];
  var disabler = this.disabler;
  switch (resource.state) {
    case STATES.CLOSED:
      if (success) {
        resource.errorCount = 0;
        if (resource.timer) {
          clearTimeout(resource.timer);
        }
      } else if (resource.errorCount >= this.options.maxFailures) {
        disabler.emit('opened', {key:key});
        resource.state = STATES.OPEN;
        resource.errorCount = 0;
        if (!resource.timer) {
          resource.timer = setTimeout(function () {
            resource.state = STATES.HALF_OPEN;
            resource.successCount = 0;
            disabler.emit('testing', {key:key});
          }, this.options.disableDuration);
        }
      }
      break;
    case STATES.HALF_OPEN:
      if (success) {
        disabler.emit('closed', {key:key});
        if (resource.successCount >= this.options.minSuccesses) {
          resource.state = STATES.CLOSED;
          if (resource.timer) {
            clearTimeout(resource.timer);
          }
        }
      } else {
        disabler.emit('reopened', {key:key});
        resource.state = STATES.OPEN;
        resource.errorCount = 0;
        if (!resource.timer) {
          resource.timer = setTimeout(function () {
            resource.state = STATES.HALF_OPEN;
            resource.successCount = 0;
            disabler.emit('testing', {key:key});
          }, this.options.disableDuration);
        }
      }
      break;
    case STATES.OPEN:
      // shouldn't be doing anything here
      break;
  }
};

DisablerScope.prototype.tally = function (key, success) {
  if (!this.resources.hasOwnProperty(key)) {
    this.resources[key] = {
      disabled: false,
      errorCount: 0,
      successCount: 0,
      state: STATES.CLOSED
    };
  }

  if (!success) {
    this.resources[key].errorCount++;
  } else {
    this.resources[key].successCount++;
  }

  this.resources[key].lastTally = new Date();

  this.updateState(key, success);
};

DisablerScope.prototype.isDisabled = function (key) {
  if (this.resources.hasOwnProperty(key) && this.resources[key].state === STATES.OPEN) {
    return true;
  }

  return false;
};

DisablerScope.prototype.createShim = function (key, callback) {
  var self = this;

  if (self.isDisabled(key)) {
    return function disabled() {
      callback(new Error('Disabled'));
    };
  }

  return function (err) {
    var newArguments = convertToArray(arguments);
    if (err) {
      self.tally(key, false);
      callback(err);
      return;
    }
    if (callback) {
      if (self.options.handlers) {
        for (var i = 0; i < self.options.handlers.length; i++) {
          if (!self.options.handlers[i](newArguments)) {
            self.tally(key, false);
            callback(new Error('Disabler handled soft error.'));
            return;
          }
        }
      }
      self.tally(key, true);
      callback.apply(callback, newArguments);
    }
  };
};

DisablerScope.prototype.proxy = function disablerScopeProxy(key, action) {
  var self = this;

  function proxy() {
    var fn = action;

    var newArguments = convertToArray(arguments);
    var derivedKey = self.deriveKey(newArguments, key);

    if (arguments.length === 0) {
      return action.apply(action);
    }

    var callback = arguments[arguments.length - 1];
    if (callback instanceof Function) {
      var shim = self.createShim(derivedKey, callback);
      newArguments[newArguments.length - 1] = shim;
    }

    return action.apply(action, newArguments);
  }

  return proxy;
};

function AutoDisabler() {
  this.STATES = STATES;
  this.scopes = {};
  EventEmitter.call(this);
}

util.inherits(AutoDisabler, EventEmitter);

AutoDisabler.prototype.getScope = function autoDisablerGetOrCreateScope(name, options) {
  if (this.scopes.hasOwnProperty(name)) {
    return this.scopes[name];
  }

  return (this.scopes[name] = new DisablerScope(name, options, this));
};

AutoDisabler.prototype.removeScope = function autoDisablerRemoveScope(name) {
  if (this.scopes.hasOwnProperty(name)) {
    delete this.scopes[name];
  }
};

module.exports = AutoDisabler;
