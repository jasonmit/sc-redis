'use strict';

var redis = require('redis');

var INSTANCE_ID_REGEX = /^[^\/]*\//;

module.exports.attach = function (broker) {
  var brokerOptions = Object.assign({}, broker.options.brokerOptions, {
    retry_strategy: function(options) {
      if (options.max_attempts && options.attempts > options.max_attempts) {
        broker.emit('error', 'maximum redis reconnect attempts: ' + options.attempts);

        return undefined;
      }

      if (options && options.error) {
        broker.emit('error', options.error);
      }

      return options.connect_timeout || 1000;
    }
  });

  var instanceId = broker.instanceId;
  var subClient = redis.createClient(brokerOptions.uri, brokerOptions);
  var pubClient = redis.createClient(brokerOptions.uri, brokerOptions);

  broker.on('subscribe', subClient.subscribe.bind(subClient));
  broker.on('unsubscribe', subClient.unsubscribe.bind(subClient));
  broker.on('publish', function(channel, data) {
    if (data && data instanceof Object) {
      try {
        data = '/o:' + JSON.stringify(data);
      } catch (e) {
        data = '/s:' + data;
      }
    } else {
      data = '/s:' + data;
    }

    if (instanceId != null) {
      data = instanceId + data;
    }

    pubClient.publish(channel, data);
  });

  subClient.on('message', function(channel, message) {
    var sender = null;

    message = message.replace(INSTANCE_ID_REGEX, function(match) {
      sender = match.slice(0, -1);
      return '';
    });

    // Do not publish if this message was published by
    // the current SC instance since it has already been
    // handled internally
    if (sender == null || sender != instanceId) {
      var type = message.charAt(0);
      var data;

      if (type === 'o') {
        try {
          data = JSON.parse(message.slice(2));
        } catch (e) {
          data = message.slice(2);
        }
      } else {
        data = message.slice(2);
      }

      broker.publish(channel, data);
    }
  });
};
